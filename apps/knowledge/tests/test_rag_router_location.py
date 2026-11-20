"""A location-dependent question is refused without retrieval when the hub has the location gate on and the
conversation notes hold no location."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.errors import LOCATION_REQUIRED_DESCRIPTION, LOCATION_REQUIRED_FALLBACK
from app.models.chat import (
    AddContextNote,
    ChatRequest,
    ChatResponse,
    ContextNote,
    ContextUpdate,
    ErrorType,
    ExternalResource,
    Message,
    Metadata,
    PersonalizationSettings,
    RemoveContextNote,
    Role,
)
from app.services.context_extractor import ContextExtraction
from app.services.router.models import (
    ClassificationResult,
    HandlerResult,
    KnowledgeSource,
    QueryIntent,
    RouteDecision,
)
from app.services.router.question_type import classification_metadata_fields
from app.services.router.rag_router import (
    RAGRouter,
    _boost_places,
    _notes_after_updates,
    _pending_location_question,
    _places_without_note_containers,
    _refusal_is_latest_assistant_turn,
    _repeats_note_place,
    _user_location_missing,
)

_QUESTION = ExternalResource(
    title="What's your state?",
    resource_type="question",
    description="Asks where the user lives",
    scenarios=["unanswerable_question"],
)
_HELPLINE = ExternalResource(title="+1 555 0100", resource_type="phone", scenarios=["unanswerable_question"])


def _classification(needs_user_location: bool, location_only: bool = False) -> ClassificationResult:
    return ClassificationResult(
        intent=QueryIntent.QUESTION,
        routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
        used_llm=True,
        needs_user_location=needs_user_location,
        location_only=location_only,
    )


def _chat(conversation_context: list[ContextNote] | None, location_gate_enabled: bool | None = True) -> ChatRequest:
    return ChatRequest(
        hub_id=1,
        message_id=1,
        message="When are the local elections?",
        personalization=PersonalizationSettings(external_resources=[_QUESTION, _HELPLINE]),
        conversation_context=conversation_context,
        location_gate_enabled=location_gate_enabled,
    )


@pytest.mark.parametrize(
    ("conversation_context", "location_gate_enabled", "needs_user_location", "expected"),
    [
        ([], True, True, True),
        # the cms always sends the notes; a hub without the gate searches the question as written
        ([], False, True, False),
        ([], None, True, False),
        # the gate without notes to hold a location still refuses: a note is the only way through
        (None, True, True, True),
        # the only note kept is the location, and the rewriter already folded it into the question
        ([ContextNote(id="n1", text="Lives in Nairobi, Kenya")], True, True, False),
        ([], True, False, False),
    ],
)
def test_user_location_missing(
    conversation_context: list[ContextNote] | None,
    location_gate_enabled: bool | None,
    needs_user_location: bool,
    expected: bool,
) -> None:
    chat = _chat(conversation_context, location_gate_enabled)
    assert _user_location_missing(chat, _classification(needs_user_location)) is expected


def _slow_extraction(extraction: ContextExtraction, seconds: float) -> AsyncMock:
    async def _extract(*_args: object) -> ContextExtraction:
        await asyncio.sleep(seconds)
        return extraction

    return AsyncMock(side_effect=_extract)


def _rewrites(mock_to_thread: MagicMock) -> list[ChatRequest]:
    """Record every request the rewriter sees, so the test can tell what was routed."""
    rewritten: list[ChatRequest] = []

    def _to_thread(func: object, *args: object) -> object:
        chat, _pipeline, metadata = args
        assert isinstance(chat, ChatRequest) and isinstance(metadata, Metadata)
        rewritten.append(chat)
        metadata.rewritten_question = chat.message
        return chat

    mock_to_thread.side_effect = _to_thread
    return rewritten


def _to_thread_side_effect(func: object, *args: object) -> object:
    if len(args) == 3:
        chat, _pipeline, metadata = args
        assert isinstance(chat, ChatRequest)
        assert isinstance(metadata, Metadata)
        metadata.rewritten_question = chat.message
        return chat
    return func(*args)  # type: ignore[operator]


def _mock_config() -> MagicMock:
    cfg = MagicMock()
    cfg.router_enable_internal_kb = True
    cfg.router_enable_yago = False
    cfg.router_use_llm_classifier = True
    cfg.router_parallel_execution = False
    cfg.router_enable_decomposition = False
    cfg.router_unified_classifier_decomposer = False
    cfg.topic_extraction_enabled = False
    return cfg


def _router(
    mock_config: MagicMock, mock_classifier_cls: MagicMock, mock_language: MagicMock
) -> tuple[RAGRouter, AsyncMock]:
    """A router whose internal kb answers every question; returns it with the retrieval mock to assert on."""
    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("en", 0.99))

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier.classify = AsyncMock(return_value=_classification(needs_user_location=True))
    mock_classifier_cls.return_value = mock_classifier

    retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=True,
            answer="The elections are on 12 March [1].",
            confidence=0.8,
            metadata={"documents_count": 1, "document_ids_used": ["doc-1"]},
        )
    )
    internal_handler = MagicMock()
    internal_handler.is_enabled.return_value = True
    internal_handler.retrieve = retrieve

    router = RAGRouter(hub_id=1)
    router.internal_handler = internal_handler
    return router, retrieve


@patch("app.services.router.rag_router.errors.get_error_message")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_location_dependent_question_without_a_note_is_unanswered_without_retrieval(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_get_error_message: MagicMock,
) -> None:
    mock_get_error_message.return_value = "This is a location-based question. What's your state?"
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction())):
        response = await router.route(_chat([]))

    assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE
    assert response.answer == "This is a location-based question. What's your state?"
    retrieve.assert_not_awaited()

    assert response.metadata is not None
    # counted as unanswered by the cms, and told apart from a content gap when triaging
    assert response.metadata.answerable is True
    assert response.metadata.user_location_missing is True
    assert response.metadata.router_intent == "question"
    assert response.metadata.language == "en"
    assert response.metadata.documents_count is None

    # the reply asks for the state itself, so only the support resources travel along
    mock_get_error_message.assert_called_once_with(
        ErrorType.NO_ANSWER_AVAILABLE,
        "en",
        external_resources=[_HELPLINE],
        question="When are the local elections?",
        notes=[],
        force_all_resources=False,
        error_description=LOCATION_REQUIRED_DESCRIPTION,
        fallback_message=LOCATION_REQUIRED_FALLBACK,
    )


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.errors.get_error_message")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_location_dependent_question_with_a_note_is_searched(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_get_error_message: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    mock_to_thread.side_effect = _to_thread_side_effect
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction())):
        response = await router.route(_chat([ContextNote(id="n1", text="Lives in Nairobi, Kenya")]))

    assert response.error_type is None
    assert response.answer == "The elections are on 12 March [1]."
    retrieve.assert_awaited_once()
    mock_get_error_message.assert_not_called()
    assert response.metadata is not None
    assert response.metadata.user_location_missing is None


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.errors.get_error_message")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_question_naming_the_place_is_searched_with_the_note_its_own_turn_produced(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_get_error_message: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # no note yet and the classifier still asks for a location, but the message says where the user is:
    # the extractor running alongside produces the note, and the gate waits for it instead of refusing
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    updates = [AddContextNote(text="Lives in Zagreb")]
    chat = _chat([]).model_copy(update={"message": "I live in Zagreb, where can I vote?"})

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction(updates=updates))):
        response = await router.route(chat)

    # routed once as written, then again with the note, where the gate lets it through
    assert [c.conversation_context for c in rewritten] == [[], [ContextNote(id="pending-0", text="Lives in Zagreb")]]
    retrieve.assert_awaited_once()
    mock_get_error_message.assert_not_called()
    assert response.error_type is None
    assert response.answer == "The elections are on 12 March [1]."
    assert response.context_updates == updates
    assert response.metadata is not None
    assert response.metadata.user_location_missing is None


@patch("app.services.router.rag_router.CONVERSATION_CONTEXT_WAIT_SECONDS", 0.05)
@patch("app.services.router.rag_router.errors.get_error_message")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_gate_refuses_when_extraction_outlasts_its_wait(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_get_error_message: MagicMock,
) -> None:
    mock_get_error_message.return_value = "This is a location-based question. What's your state?"
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    extraction = ContextExtraction(updates=[AddContextNote(text="Lives in Zagreb")])

    # far past the wait, so a loaded runner can't finish it before the gate looks; route() cancels it at the end
    with patch.object(router, "_extract_context", new=_slow_extraction(extraction, 5.0)):
        response = await router.route(_chat([]))

    retrieve.assert_not_awaited()
    assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE
    assert response.metadata is not None
    assert response.metadata.user_location_missing is True


@patch("app.services.router.rag_router.errors.get_error_message")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_location_dependent_question_is_searched_when_the_gate_is_off(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_get_error_message: MagicMock,
) -> None:
    # the notes still arrive and the extractor still runs; only the refusal is the hub's choice
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction())):
        response = await router.route(_chat([], location_gate_enabled=False))

    assert response.error_type is None
    retrieve.assert_awaited_once()
    mock_get_error_message.assert_not_called()
    assert response.metadata is not None
    assert response.metadata.user_location_missing is None


# the history as the cms sends it once a location-dependent question was refused: the refusal is flagged,
# and the welcome message created alongside the first user message sits between the question and the refusal
_WELCOME = Message(role=Role.ASSISTANT, content="Welcome! Where are you living?")
_REFUSAL = Message(role=Role.ASSISTANT, content="I need to know where you are first.", user_location_missing=True)
_REFUSED_HISTORY = [Message(role=Role.USER, content="where can i vote"), _WELCOME, _REFUSAL]
_EARLIER = [Message(role=Role.USER, content="hello"), Message(role=Role.ASSISTANT, content="Hello! How can I help?")]
_SMALL_TALK = ChatResponse(
    answer="It seems like you're mentioning Zagreb.",
    metadata=Metadata(**classification_metadata_fields(intent=QueryIntent.NON_QUESTION)),
)


@pytest.mark.parametrize(
    ("places", "notes", "expected"),
    [
        # the rewriter copied the note into the question: the country would boost every chunk naming it
        (["Georgia", "United States"], ["Lives in Georgia, United States"], ["Georgia"]),
        # a city that shares its name with its state keeps the place, drops only the country
        (["New York", "United States"], ["Lives in New York, New York, United States"], ["New York"]),
        # the user's place is not in the question: a question about the country alone keeps it
        (["United States"], ["Lives in Georgia, United States"], ["United States"]),
        # another place's country is not a container of the asked place
        (["Ohio", "Canada"], ["Lives in Georgia, United States"], ["Ohio", "Canada"]),
        # "US" sits inside "Austin": a substring match would drop Texas and keep the country
        (["Texas", "US"], ["Lives in Austin, Texas, United States"], ["Texas", "US"]),
        # the question names the state the note holds as a container: the country goes, the state stays
        (["Texas", "United States"], ["Lives in Austin, Texas, United States"], ["Texas"]),
        (["Georgia"], ["Lives in Georgia"], ["Georgia"]),
        (["Georgia", "United States"], None, ["Georgia", "United States"]),
        ([], ["Lives in Georgia, United States"], []),
    ],
)
def test_places_without_note_containers(places: list[str], notes: list[str] | None, expected: list[str]) -> None:
    context_notes = [ContextNote(id=str(i), text=text) for i, text in enumerate(notes)] if notes is not None else None
    assert _places_without_note_containers(places, context_notes) == expected


@pytest.mark.parametrize(
    ("question_places", "note_places", "notes", "expected"),
    [
        # the question names no place: the note's place boosts, as a tie-breaker among same-named measures
        ([], ["Georgia"], ["Lives in Georgia"], ["Georgia"]),
        # the note's containers never boost: the country would lift every chunk naming it
        ([], ["Austin", "Texas", "United States"], ["Lives in Austin, Texas, United States"], ["Austin"]),
        # the question names its own place: the note does not redirect it
        (["Texas"], ["Georgia"], ["Lives in Georgia"], ["Texas"]),
        # the rewriter copied the note into the question: the usual container drop still applies
        (["Georgia", "United States"], [], ["Lives in Georgia, United States"], ["Georgia"]),
        ([], [], None, []),
        ([" "], ["Georgia"], ["Lives in Georgia"], ["Georgia"]),
    ],
)
def test_boost_places(
    question_places: list[str], note_places: list[str], notes: list[str] | None, expected: list[str]
) -> None:
    context_notes = [ContextNote(id=str(i), text=text) for i, text in enumerate(notes)] if notes is not None else None
    assert _boost_places(question_places, note_places, context_notes) == expected


def _reply(message: str, history: list[Message]) -> ChatRequest:
    return ChatRequest(hub_id=1, message_id=2, message=message, history=history, conversation_context=[])


@pytest.mark.parametrize(
    ("history", "expected"),
    [
        (_REFUSED_HISTORY, ("where can i vote", [])),
        # a question later in the conversation: the welcome is long gone, the earlier turns stay as history
        (_EARLIER + [Message(role=Role.USER, content="where can i vote"), _REFUSAL], ("where can i vote", _EARLIER)),
        # the user tried something else before answering where they are: the refused question is still pending
        (
            _REFUSED_HISTORY
            + [
                Message(role=Role.USER, content="id like to register"),
                Message(role=Role.ASSISTANT, content="I couldn't find an answer to that."),
            ],
            ("where can i vote", []),
        ),
        # two refusals: the most recent one is the pending question
        (
            _EARLIER
            + [Message(role=Role.USER, content="where can i vote"), _REFUSAL]
            + [Message(role=Role.USER, content="when are the elections"), _REFUSAL],
            ("when are the elections", _EARLIER + [Message(role=Role.USER, content="where can i vote"), _REFUSAL]),
        ),
        # an unflagged assistant turn is any other answer
        (_REFUSED_HISTORY[:-1] + [Message(role=Role.ASSISTANT, content="I need to know where you are first.")], None),
        # a flagged turn with no user question before it
        ([_WELCOME, _REFUSAL], None),
        ([], None),
    ],
)
def test_pending_location_question(history: list[Message], expected: tuple[str, list[Message]] | None) -> None:
    assert _pending_location_question(_reply("zagreb", history)) == expected


def test_notes_after_updates_mirror_what_the_cms_will_store() -> None:
    notes = [ContextNote(id="n1", text="Lives in Nairobi, Kenya")]
    updates: list[ContextUpdate] = [RemoveContextNote(id="n1"), AddContextNote(text="Lives in Zagreb")]
    assert _notes_after_updates(notes, updates) == [ContextNote(id="pending-0", text="Lives in Zagreb")]
    assert _notes_after_updates([], []) == []


@pytest.mark.parametrize(
    ("history", "expected"),
    [
        (_REFUSED_HISTORY, True),
        # the refusal was followed by an answer: whatever the user says now is not a reply to it
        (
            _REFUSED_HISTORY + [Message(role=Role.USER, content="ok"), Message(role=Role.ASSISTANT, content="Sure.")],
            False,
        ),
        ([_WELCOME], False),
        ([], False),
    ],
)
def test_refusal_is_latest_assistant_turn(history: list[Message], expected: bool) -> None:
    assert _refusal_is_latest_assistant_turn(_reply("zagreb", history)) is expected


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_bare_location_after_a_refusal_resumes_the_refused_question(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    updates = [AddContextNote(text="Lives in Zagreb")]
    extraction = ContextExtraction(updates=updates, location_only=True)

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)):
        response = await router.route(_reply("zagreb", _REFUSED_HISTORY))

    # the bare reply itself is never routed: the classifier is not consulted on it at all
    classify = mock_classifier_cls.return_value.classify
    assert [call.args[0] for call in classify.await_args_list] == ["where can i vote"]
    assert [c.message for c in rewritten] == ["where can i vote"]
    resumed = rewritten[0]
    assert resumed.conversation_context == [ContextNote(id="pending-0", text="Lives in Zagreb")]
    assert resumed.history == []

    # the refused question ran with the note, so the gate let it through and the kb answered it
    retrieve.assert_awaited_once()
    assert response.error_type is None
    assert response.answer == "The elections are on 12 March [1]."
    assert response.context_updates == updates
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is True
    assert response.metadata.user_location_missing is None
    assert response.metadata.router_intent == "question"


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_bare_location_resumes_a_refusal_whose_own_turn_stored_the_note(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # the refused question named the place, so its turn stored the note while the gate refused it; the reply
    # repeats a location the note already holds, so the extractor adds nothing, and the question still resumes
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    note = ContextNote(id="n1", text="Lives in Zagreb")
    history = [Message(role=Role.USER, content="I live in Zagreb, where can I vote?"), _WELCOME, _REFUSAL]
    chat = _reply("zagreb", history).model_copy(update={"conversation_context": [note]})

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction(location_only=True))):
        response = await router.route(chat)

    assert [c.message for c in rewritten] == ["I live in Zagreb, where can I vote?"]
    assert rewritten[0].conversation_context == [note]
    retrieve.assert_awaited_once()
    assert response.answer == "The elections are on 12 March [1]."
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is True


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_new_question_after_a_refusal_is_routed_as_written(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    # names its place, so it is a complete question of its own; the extractor still records the location
    mock_classifier_cls.return_value.classify = AsyncMock(return_value=_classification(needs_user_location=False))
    updates = [AddContextNote(text="Lives in Zagreb")]
    extraction = ContextExtraction(updates=updates, location_only=False)

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)):
        response = await router.route(_reply("Zagreb, when are the elections?", _REFUSED_HISTORY))

    assert [c.message for c in rewritten] == ["Zagreb, when are the elections?"]
    retrieve.assert_awaited_once()
    assert response.context_updates == updates
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is None


@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_bare_location_without_a_refusal_stays_small_talk(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=ClassificationResult(intent=QueryIntent.NON_QUESTION, routes=[], used_llm=True)
    )
    updates = [AddContextNote(text="Lives in Zagreb")]
    # the welcome asked for the location; there is no refused question to go back to
    history = [_WELCOME]

    with (
        patch.object(
            router,
            "_extract_context",
            new=AsyncMock(return_value=ContextExtraction(updates=updates, location_only=True)),
        ),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_SMALL_TALK)) as acknowledge,
    ):
        response = await router.route(_reply("zagreb", history))

    retrieve.assert_not_awaited()
    # the classifier called it small talk, but it is still an answer to the welcome, not a topic
    assert acknowledge.await_args is not None
    assert acknowledge.await_args.kwargs == {"located": True}
    # the acknowledgment sees the note this turn adds, the only thing it may repeat back
    assert acknowledge.await_args.args[0].conversation_context == [ContextNote(id="pending-0", text="Lives in Zagreb")]
    assert response.answer == _SMALL_TALK.answer
    assert response.context_updates == updates
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is None


@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_small_talk_after_a_refusal_without_a_location_is_not_resumed(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=ClassificationResult(intent=QueryIntent.NON_QUESTION, routes=[], used_llm=True)
    )

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction())),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_SMALL_TALK)) as acknowledge,
    ):
        response = await router.route(_reply("ok thanks", _REFUSED_HISTORY))

    retrieve.assert_not_awaited()
    assert acknowledge.await_args is not None
    assert acknowledge.await_args.kwargs == {}
    assert response.answer == _SMALL_TALK.answer
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is None


@patch("app.services.router.rag_router.CONVERSATION_CONTEXT_WAIT_SECONDS", 0.05)
@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_resume_outwaits_the_end_of_answer_extraction_budget(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # extraction has only just started when the reply arrives, so the end-of-answer wait is far too short for it
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    extraction = ContextExtraction(updates=[AddContextNote(text="Lives in Zagreb")], location_only=True)

    with patch.object(router, "_extract_context", new=_slow_extraction(extraction, 0.2)):
        response = await router.route(_reply("zagreb", _REFUSED_HISTORY))

    assert [c.message for c in rewritten] == ["where can i vote"]
    retrieve.assert_awaited_once()
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is True


@patch("app.services.router.rag_router.CONVERSATION_CONTEXT_RESUME_WAIT_SECONDS", 0.05)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_extraction_slower_than_the_resume_budget_routes_the_reply_as_written(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=ClassificationResult(intent=QueryIntent.NON_QUESTION, routes=[], used_llm=True)
    )
    updates = [AddContextNote(text="Lives in Zagreb")]
    extraction = ContextExtraction(updates=updates, location_only=True)

    with (
        patch.object(router, "_extract_context", new=_slow_extraction(extraction, 0.2)),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_SMALL_TALK)),
    ):
        response = await router.route(_reply("zagreb", _REFUSED_HISTORY))

    retrieve.assert_not_awaited()
    assert response.answer == _SMALL_TALK.answer
    # the location still reaches the cms, and preflight reused the detection the resume step already paid for
    assert response.context_updates == updates
    mock_language.detect_message.assert_awaited_once()
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is None


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_refusal_already_resolved_by_a_note_is_not_resumed(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # the refusal is still in the history window, but it was answered once the user said where they are:
    # a new location only moves the note, and the old question is not answered a second time
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=_classification(needs_user_location=False, location_only=True)
    )
    answered = [
        Message(role=Role.USER, content="zagreb"),
        Message(role=Role.ASSISTANT, content="The elections are on 12 March."),
    ]
    chat = _reply("I'm in Split now", _REFUSED_HISTORY + answered).model_copy(
        update={"conversation_context": [ContextNote(id="n1", text="Lives in Zagreb")]}
    )
    updates: list[ContextUpdate] = [RemoveContextNote(id="n1"), AddContextNote(text="Lives in Split")]
    extraction = ContextExtraction(updates=updates, location_only=True)

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_SMALL_TALK)),
    ):
        response = await router.route(chat)

    # the move is routed as written, and being only a location it is acknowledged rather than searched
    assert [c.message for c in rewritten] == ["I'm in Split now"]
    retrieve.assert_not_awaited()
    assert response.answer == _SMALL_TALK.answer
    assert response.context_updates == updates
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is None


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_bare_location_the_classifier_calls_a_question_is_acknowledged_not_searched(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # the welcome asked for the location; "zagreb" is a question to the classifier, and the corpus has plenty on zagreb
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=_classification(needs_user_location=False, location_only=True)
    )
    updates = [AddContextNote(text="Lives in Zagreb")]
    extraction = ContextExtraction(updates=updates, location_only=True)

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_SMALL_TALK)) as acknowledge,
    ):
        response = await router.route(_reply("zagreb", [_WELCOME]))

    assert [c.message for c in rewritten] == ["zagreb"]
    retrieve.assert_not_awaited()
    acknowledge.assert_awaited_once()
    assert acknowledge.await_args is not None
    assert acknowledge.await_args.kwargs == {"located": True}
    assert response.answer == _SMALL_TALK.answer
    assert response.context_updates == updates
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is None


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_location_that_also_asks_something_is_searched(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(return_value=_classification(needs_user_location=False))
    updates = [AddContextNote(text="Lives in Zagreb")]
    extraction = ContextExtraction(updates=updates, location_only=False)

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)):
        response = await router.route(_reply("zagreb, where can i vote", [_WELCOME]))

    assert [c.message for c in rewritten] == ["zagreb, where can i vote"]
    retrieve.assert_awaited_once()
    assert response.answer == "The elections are on 12 March [1]."
    assert response.context_updates == updates


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_question_the_extractor_calls_location_only_is_still_searched(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # the note already holds the place and the extractor misread the question as a repeat of it;
    # the classifier sees a question that is more than a location, so it is searched, not acknowledged
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(return_value=_classification(needs_user_location=False))
    message = "I'm in Zagreb and I don't know how to vote... where do I go"
    chat = _reply(message, [_WELCOME]).model_copy(
        update={"conversation_context": [ContextNote(id="n1", text="Lives in Zagreb")]}
    )

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction(location_only=True))),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_SMALL_TALK)) as acknowledge,
    ):
        response = await router.route(chat)

    assert [c.message for c in rewritten] == [message]
    acknowledge.assert_not_awaited()
    retrieve.assert_awaited_once()
    assert response.answer == "The elections are on 12 March [1]."


# a refused message that only announced a question: resuming it must not search on it
_OPENER = "hi, i have a question about permits"
_REFUSED_OPENER = [Message(role=Role.USER, content=_OPENER), _WELCOME, _REFUSAL]


def _small_talk() -> ChatResponse:
    # route() writes into the response metadata, so each test gets its own copy
    return _SMALL_TALK.model_copy(deep=True)


@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_resumed_opener_caught_early_acknowledges_the_location(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.is_non_question.side_effect = lambda message: message == _OPENER
    updates = [AddContextNote(text="Lives in Zagreb")]
    extraction = ContextExtraction(updates=updates, location_only=True)

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_small_talk())) as acknowledge,
    ):
        response = await router.route(_reply("zagreb", _REFUSED_OPENER))

    retrieve.assert_not_awaited()
    assert acknowledge.await_args is not None
    assert acknowledge.await_args.kwargs == {"located": True}
    assert acknowledge.await_args.args[0].conversation_context == [ContextNote(id="pending-0", text="Lives in Zagreb")]
    assert response.context_updates == updates
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is True


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_resumed_opener_the_classifier_calls_small_talk_acknowledges_the_location(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=ClassificationResult(intent=QueryIntent.NON_QUESTION, routes=[], used_llm=True)
    )
    extraction = ContextExtraction(updates=[AddContextNote(text="Lives in Zagreb")], location_only=True)

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_small_talk())) as acknowledge,
    ):
        response = await router.route(_reply("zagreb", _REFUSED_OPENER))

    assert [c.message for c in rewritten] == [_OPENER]
    retrieve.assert_not_awaited()
    assert acknowledge.await_args is not None
    assert acknowledge.await_args.kwargs == {"located": True}
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is True


@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_an_acknowledgment_that_may_abbreviate_a_place_is_confirmed_not_guessed(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    # "ok" is small talk to the regex, so this is settled in preflight, before the classifier
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.is_non_question.return_value = True
    extraction = ContextExtraction(possible_place="Sotheria")

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)),
        patch.object(
            router, "_generate_conversational_reply", new=AsyncMock(return_value="Did you mean Sotheria?")
        ) as reply,
    ):
        response = await router.route(_reply("ok", _REFUSED_HISTORY))

    # neither guess is taken: nothing is searched or classified, and no note is stored
    retrieve.assert_not_awaited()
    mock_classifier_cls.return_value.classify.assert_not_awaited()
    assert reply.await_args is not None
    assert reply.await_args.kwargs == {"confirm_place": "Sotheria"}
    assert response.answer == "Did you mean Sotheria?"
    assert response.context_updates == []
    assert response.metadata is not None
    assert response.metadata.router_intent == "non_question"
    # unflagged, so the refused question stays the pending one for the user's answer
    assert response.metadata.user_location_missing is None
    assert response.metadata.location_question_resumed is None


@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_place_abbreviation_is_confirmed_in_the_language_of_the_conversation(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    # "il" is Illinois to the extractor and the Italian article to the detector
    router, _retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_language.detect_message = AsyncMock(return_value=("it", 0.95))
    mock_language.detect_from_history = AsyncMock(return_value=("en", 0.9))
    mock_classifier_cls.return_value.is_non_question.return_value = True

    with (
        patch.object(
            router, "_extract_context", new=AsyncMock(return_value=ContextExtraction(possible_place="Illinois"))
        ),
        patch.object(
            router, "_generate_conversational_reply", new=AsyncMock(return_value="Did you mean Illinois?")
        ) as reply,
    ):
        response = await router.route(_reply("il", _REFUSED_HISTORY))

    assert reply.await_args is not None
    assert reply.await_args.args[1] == "en"
    assert response.metadata is not None
    assert response.metadata.language == "en"


@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_bare_location_is_acknowledged_in_the_language_of_the_conversation(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    router, _retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_language.detect_message = AsyncMock(return_value=("hr", 0.95))
    mock_language.detect_from_history = AsyncMock(return_value=("en", 0.9))
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=ClassificationResult(intent=QueryIntent.NON_QUESTION, routes=[], used_llm=True)
    )
    extraction = ContextExtraction(updates=[AddContextNote(text="Lives in Zagreb")], location_only=True)

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)),
        patch.object(router, "_generate_conversational_reply", new=AsyncMock(return_value="Noted.")) as reply,
    ):
        response = await router.route(_reply("zagreb", [_WELCOME]))

    assert reply.await_args is not None
    assert reply.await_args.args[1] == "en"
    assert reply.await_args.kwargs == {"located": True}
    assert response.metadata is not None
    assert response.metadata.language == "en"


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_possible_place_after_the_welcome_is_confirmed_without_a_refusal(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # the welcome asked where the user is; no refusal is stored, and the regex knows nothing of this word
    mock_to_thread.side_effect = _to_thread_side_effect
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(return_value=_classification(needs_user_location=False))

    with (
        patch.object(
            router, "_extract_context", new=AsyncMock(return_value=ContextExtraction(possible_place="Sotheria"))
        ),
        patch.object(router, "_generate_conversational_reply", new=AsyncMock(return_value="Sotheria?")) as reply,
    ):
        response = await router.route(_reply("so", [_WELCOME]))

    retrieve.assert_not_awaited()
    assert reply.await_args is not None
    assert reply.await_args.kwargs == {"confirm_place": "Sotheria"}
    assert response.answer == "Sotheria?"
    assert response.context_updates == []


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_possible_place_is_ignored_once_a_location_is_known(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    mock_to_thread.side_effect = _to_thread_side_effect
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(
        return_value=ClassificationResult(intent=QueryIntent.NON_QUESTION, routes=[], used_llm=True)
    )
    chat = _reply("so", [_WELCOME]).model_copy(
        update={"conversation_context": [ContextNote(id="n1", text="Lives in Zagreb")]}
    )

    with (
        patch.object(
            router, "_extract_context", new=AsyncMock(return_value=ContextExtraction(possible_place="Sotheria"))
        ),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_small_talk())) as small_talk,
    ):
        await router.route(chat)

    retrieve.assert_not_awaited()
    assert small_talk.await_args is not None
    assert small_talk.await_args.kwargs == {}


@patch("app.services.router.rag_router.CONVERSATION_CONTEXT_WAIT_SECONDS", 0.05)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_small_talk_does_not_outwait_a_slow_extraction_to_be_confirmed(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
) -> None:
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.is_non_question.return_value = True

    with (
        patch.object(
            router, "_extract_context", new=_slow_extraction(ContextExtraction(possible_place="Sotheria"), 0.2)
        ),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_small_talk())) as small_talk,
    ):
        response = await router.route(_reply("ok", [_WELCOME]))

    retrieve.assert_not_awaited()
    assert small_talk.await_args is not None
    assert small_talk.await_args.kwargs == {}
    assert response.answer == _SMALL_TALK.answer


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_confirming_the_place_resumes_the_refused_question(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    rewritten = _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    confirmation = [
        Message(role=Role.USER, content="so"),
        Message(role=Role.ASSISTANT, content="Did you mean Sotheria?"),
    ]
    extraction = ContextExtraction(updates=[AddContextNote(text="Lives in Sotheria")], location_only=True)

    with patch.object(router, "_extract_context", new=AsyncMock(return_value=extraction)):
        response = await router.route(_reply("yes", _REFUSED_HISTORY + confirmation))

    assert [c.message for c in rewritten] == ["where can i vote"]
    retrieve.assert_awaited_once()
    assert response.answer == "The elections are on 12 March [1]."
    assert response.metadata is not None
    assert response.metadata.location_question_resumed is True


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
async def test_a_misspelled_repeat_of_the_noted_place_is_acknowledged_not_searched(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_language: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    # both llm verdicts missed the typo: a question to the classifier, nothing to the extractor
    _rewrites(mock_to_thread)
    router, retrieve = _router(mock_config, mock_classifier_cls, mock_language)
    mock_classifier_cls.return_value.classify = AsyncMock(return_value=_classification(needs_user_location=False))
    note = ContextNote(id="n1", text="Lives in Zagreb, Croatia")
    chat = _reply("zagrebb", [_WELCOME]).model_copy(update={"conversation_context": [note]})

    with (
        patch.object(router, "_extract_context", new=AsyncMock(return_value=ContextExtraction())),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=_small_talk())) as acknowledge,
    ):
        await router.route(chat)

    retrieve.assert_not_awaited()
    assert acknowledge.await_args is not None
    assert acknowledge.await_args.kwargs == {"located": True}
    assert acknowledge.await_args.args[0].conversation_context == [note]


@pytest.mark.parametrize(
    ("message", "notes", "expected"),
    [
        ("Zagreb", ["Lives in Zagreb, Croatia"], True),
        ("zagrebb", ["Lives in Zagreb, Croatia"], True),
        ("croatia", ["Lives in Zagreb, Croatia"], True),
        ("sao paulo", ["Mora em São Paulo, São Paulo, Brasil"], True),
        ("split", ["Lives in Zagreb, Croatia"], False),
        # one wrong letter in a five-letter name is as often a real word as a typo, so short names are not matched
        ("parks", ["Lives in Paris, France"], False),
        ("mains", ["Lives in Maine, United States"], False),
        ("pariz", ["Lives in Paris, France"], False),
        # the verb phrase is not the place
        ("lives", ["Lives in Zagreb, Croatia"], False),
        # a question about the place, and a reply that says more than the place
        ("zagreb?", ["Lives in Zagreb, Croatia"], False),
        ("zagreb how do i register", ["Lives in Zagreb, Croatia"], False),
        # too short to tell an abbreviation from a typo
        ("zgb", ["Lives in Zagreb, Croatia"], False),
        ("zagreb", [], False),
        ("zagreb", None, False),
    ],
)
def test_repeats_note_place(message: str, notes: list[str] | None, expected: bool) -> None:
    context_notes = [ContextNote(id=str(i), text=text) for i, text in enumerate(notes)] if notes is not None else None
    assert _repeats_note_place(message, context_notes) is expected
