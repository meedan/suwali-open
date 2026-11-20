import asyncio
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest

from app.models.chat import AddContextNote, ChatRequest, ChatResponse, ContextNote, Message, Metadata, Role
from app.services.context_extractor import ContextExtraction
from app.services.router.rag_router import RAGRouter


@pytest.fixture
def router() -> RAGRouter:
    with (
        patch("app.services.router.rag_router.Config") as mock_config,
        patch("app.services.router.rag_router.LLMConfig"),
    ):
        mock_config.return_value.router_unified_classifier_decomposer = False
        mock_config.return_value.router_enable_internal_kb = False
        mock_config.return_value.router_enable_yago = False
        return RAGRouter(hub_id=1)


def _resolved(language: str | None) -> asyncio.Future[str | None]:
    future: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
    future.set_result(language)
    return future


def _chat(conversation_context: list[ContextNote] | None) -> ChatRequest:
    return ChatRequest(
        hub_id=1,
        message_id=1,
        message="btw I live in Lagos",
        history=[Message(role=Role.ASSISTANT, content="Hello!")],
        conversation_context=conversation_context,
    )


async def test_route_attaches_context_updates(router: RAGRouter) -> None:
    notes = [ContextNote(id="1", text="Is 34 years old")]
    chat = _chat(notes)
    answer = ChatResponse(answer="Got it.", metadata=Metadata())
    updates = [AddContextNote(text="Lives in Lagos")]

    with (
        patch.object(router, "_route", new=AsyncMock(return_value=answer)),
        patch.object(
            router, "_extract_context", new=AsyncMock(return_value=ContextExtraction(updates=updates))
        ) as mock_extract,
    ):
        response = await router.route(chat)

    assert response.context_updates == updates
    mock_extract.assert_awaited_once_with(
        "btw I live in Lagos", [Message(role=Role.ASSISTANT, content="Hello!")], notes, ANY
    )


async def test_route_extracts_context_on_early_response_paths(router: RAGRouter) -> None:
    # a preflight non-question reply is where a lot of context arrives ("btw I'm in Lagos")
    chat = _chat([])
    early = ChatResponse(answer="Thanks for letting me know!", metadata=Metadata())

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=MagicMock(early_response=early))),
        patch.object(router, "_rewrite", new=AsyncMock()) as mock_rewrite,
        patch.object(
            router,
            "_extract_context",
            new=AsyncMock(return_value=ContextExtraction(updates=[AddContextNote(text="Lives in Lagos")])),
        ),
    ):
        response = await router.route(chat)

    assert response is early
    assert response.context_updates == [AddContextNote(text="Lives in Lagos")]
    mock_rewrite.assert_not_awaited()


async def test_route_skips_extraction_when_context_is_none(router: RAGRouter) -> None:
    answer = ChatResponse(answer="Hi", metadata=Metadata())

    with (
        patch.object(router, "_route", new=AsyncMock(return_value=answer)),
        patch.object(router, "_extract_context", new=AsyncMock()) as mock_extract,
    ):
        response = await router.route(_chat(None))

    assert response.context_updates == []
    mock_extract.assert_not_called()


async def test_route_passes_pre_rewrite_message_and_history(router: RAGRouter) -> None:
    chat = _chat([])
    seen: dict[str, object] = {}

    async def mutating_route(c: ChatRequest) -> ChatResponse:
        # the rewriter overwrites chat in place
        c.message = "When are the elections in Lagos?"
        c.history = []
        return ChatResponse(answer="Answer", metadata=Metadata())

    async def capture(
        message: str, history: list[Message], notes: list[ContextNote], message_language: asyncio.Future[str | None]
    ) -> ContextExtraction:
        await asyncio.sleep(0)
        seen["message"] = message
        seen["history"] = history
        return ContextExtraction()

    with (
        patch.object(router, "_route", new=mutating_route),
        patch.object(router, "_extract_context", new=capture),
    ):
        await router.route(chat)

    assert seen["message"] == "btw I live in Lagos"
    assert seen["history"] == [Message(role=Role.ASSISTANT, content="Hello!")]


async def test_route_cancels_extraction_when_route_raises(router: RAGRouter) -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def slow_extract(
        message: str, history: list[Message], notes: list[ContextNote], message_language: asyncio.Future[str | None]
    ) -> ContextExtraction:
        started.set()
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return ContextExtraction()

    async def failing_route(c: ChatRequest) -> ChatResponse:
        await started.wait()
        raise RuntimeError("boom")

    with (
        patch.object(router, "_route", new=failing_route),
        patch.object(router, "_extract_context", new=slow_extract),
        pytest.raises(RuntimeError),
    ):
        await router.route(_chat([]))

    await asyncio.sleep(0)
    assert cancelled.is_set()


async def test_route_returns_the_answer_without_updates_when_extraction_times_out(router: RAGRouter) -> None:
    answer = ChatResponse(answer="Answer", metadata=Metadata())

    async def hanging_extract(
        message: str, history: list[Message], notes: list[ContextNote], message_language: asyncio.Future[str | None]
    ) -> ContextExtraction:
        await asyncio.sleep(10)
        return ContextExtraction(updates=[AddContextNote(text="Lives in Lagos")])

    with (
        patch("app.services.router.rag_router.CONVERSATION_CONTEXT_WAIT_SECONDS", 0.01),
        patch.object(router, "_route", new=AsyncMock(return_value=answer)),
        patch.object(router, "_extract_context", new=hanging_extract),
    ):
        response = await router.route(_chat([]))

    assert response is answer
    assert response.context_updates == []


async def test_extract_context_returns_empty_when_extractor_raises(router: RAGRouter) -> None:
    with patch("app.services.router.rag_router.ConversationContextExtractor") as mock_extractor_cls:
        mock_extractor = MagicMock()
        mock_extractor.extract = AsyncMock(side_effect=RuntimeError("boom"))
        mock_extractor_cls.return_value = mock_extractor

        result = await router._extract_context("I live in Lagos", [], [], _resolved(None))

    assert result == ContextExtraction()


async def test_extract_context_passes_the_awaited_language_to_the_extractor(router: RAGRouter) -> None:
    with patch("app.services.router.rag_router.ConversationContextExtractor") as mock_extractor_cls:
        mock_extractor = MagicMock()
        mock_extractor.extract = AsyncMock(return_value=ContextExtraction())
        mock_extractor_cls.return_value = mock_extractor

        await router._extract_context("Eu moro em São Paulo", [], [], _resolved("pt"))

    mock_extractor.extract.assert_awaited_once_with("Eu moro em São Paulo", [], [], content_language="pt")


async def test_route_shares_the_preflight_language_with_extraction(router: RAGRouter) -> None:
    seen: dict[str, object] = {}

    async def preflight_like_route(c: ChatRequest) -> ChatResponse:
        # stands in for _preflight resolving the language once it has detected it
        router._resolve_message_language("pt")
        return ChatResponse(answer="Resposta", metadata=Metadata())

    async def capture(
        message: str, history: list[Message], notes: list[ContextNote], message_language: asyncio.Future[str | None]
    ) -> ContextExtraction:
        seen["language"] = await message_language
        return ContextExtraction()

    with (
        patch.object(router, "_route", new=preflight_like_route),
        patch.object(router, "_extract_context", new=capture),
    ):
        await router.route(_chat([]))

    assert seen["language"] == "pt"


async def test_route_unblocks_extraction_when_preflight_never_detects(router: RAGRouter) -> None:
    seen: dict[str, object] = {}

    async def capture(
        message: str, history: list[Message], notes: list[ContextNote], message_language: asyncio.Future[str | None]
    ) -> ContextExtraction:
        seen["language"] = await message_language
        return ContextExtraction()

    with (
        patch.object(router, "_route", new=AsyncMock(return_value=ChatResponse(answer="Hi", metadata=Metadata()))),
        patch.object(router, "_extract_context", new=capture),
    ):
        await asyncio.wait_for(router.route(_chat([])), timeout=5)

    assert seen["language"] is None


async def test_preflight_resolves_the_message_language(router: RAGRouter) -> None:
    router._message_language = asyncio.get_running_loop().create_future()
    chat = ChatRequest(hub_id=1, message_id=1, message="Eu moro em São Paulo")

    with (
        patch("app.services.router.rag_router.language") as mock_language,
        patch.object(router, "_check_unsupported_language", new=AsyncMock(return_value=ChatResponse(answer="x"))),
    ):
        mock_language.detect_message = AsyncMock(return_value=("pt", 0.99))
        await router._preflight(chat, 0.0, {})

    assert router._message_language.result() == "pt"


async def test_preflight_resolves_the_history_language_when_the_message_has_none(router: RAGRouter) -> None:
    # a bare reply like "Nairobi" has no language of its own
    router._message_language = asyncio.get_running_loop().create_future()
    chat = ChatRequest(hub_id=1, message_id=1, message="Nairobi")

    with (
        patch("app.services.router.rag_router.language") as mock_language,
        patch.object(router, "_check_unsupported_language", new=AsyncMock(return_value=None)),
        patch.object(router.classifier, "is_non_question", return_value=True),
        patch.object(router, "_handle_non_question", new=AsyncMock(return_value=ChatResponse(answer="x"))),
    ):
        mock_language.detect_message = AsyncMock(return_value=None)
        mock_language.detect_from_history = AsyncMock(return_value=("pt", 0.9))
        await router._preflight(chat, 0.0, {})

    assert router._message_language.result() == "pt"


async def test_rewrite_runs_alongside_classification_when_notes_exist_without_history(router: RAGRouter) -> None:
    # notes make the rewriter run; it must not sit in front of classification on the critical path
    classification, decomposition = MagicMock(), MagicMock()
    router.unified_classifier_decomposer = MagicMock()
    router.unified_classifier_decomposer.analyze = AsyncMock(return_value=(classification, decomposition))
    chat = ChatRequest(
        hub_id=1,
        message_id=1,
        message="When are the local elections?",
        conversation_context=[ContextNote(id="n1", text="Lives in Nairobi, Kenya")],
    )

    with patch("app.services.router.rag_router.Rewriter.apply", side_effect=lambda c, p, m: c) as mock_apply:
        result = await router._rewrite(chat, "en", 0.99, {})

    mock_apply.assert_called_once()
    router.unified_classifier_decomposer.analyze.assert_awaited_once()
    assert result.classification is classification
    assert result.unified_decomposition_result is decomposition


async def test_rewrite_leaves_classification_for_later_without_notes_or_history(router: RAGRouter) -> None:
    router.unified_classifier_decomposer = MagicMock()
    router.unified_classifier_decomposer.analyze = AsyncMock()
    chat = ChatRequest(hub_id=1, message_id=1, message="When are the local elections?", conversation_context=[])

    with patch("app.services.router.rag_router.Rewriter.apply", side_effect=lambda c, p, m: c):
        result = await router._rewrite(chat, "en", 0.99, {})

    router.unified_classifier_decomposer.analyze.assert_not_awaited()
    assert result.classification is None


async def test_parallel_classification_sees_the_conversation_context(router: RAGRouter) -> None:
    # the classifier defers heuristic question verdicts while the gate is live, so it must know the feature state
    router.unified_classifier_decomposer = MagicMock()
    router.unified_classifier_decomposer.analyze = AsyncMock(return_value=(MagicMock(), MagicMock()))
    chat = ChatRequest(
        hub_id=1,
        message_id=1,
        message="What is the population of my city?",
        history=[Message(role=Role.ASSISTANT, content="Hello!")],
        conversation_context=[],
        location_gate_enabled=True,
    )

    with patch("app.services.router.rag_router.Rewriter.apply", side_effect=lambda c, p, m: c):
        await router._rewrite(chat, "en", 0.99, {})

    ctx = router.unified_classifier_decomposer.analyze.await_args.args[1]
    assert ctx.conversation_context == []
    assert ctx.location_gate_enabled is True
