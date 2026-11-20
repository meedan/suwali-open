from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.chat import ChatRequest, ChatResponse, ErrorType, Metadata
from app.services.router.models import QueryIntent, SubQuery
from app.services.router.rag_router import RAGRouter, _PreflightResult, _RewriteResult


@pytest.fixture
def router() -> RAGRouter:
    with (
        patch("app.services.router.rag_router.Config") as mock_config,
        patch("app.services.router.rag_router.LLMConfig"),
    ):
        mock_config.return_value.topic_extraction_enabled = True
        mock_config.return_value.topic_extraction_max_count = 5
        mock_config.return_value.router_unified_classifier_decomposer = False
        mock_config.return_value.router_enable_internal_kb = False
        mock_config.return_value.router_enable_yago = False
        return RAGRouter(hub_id=1)


def _rewrite_result(rewritten_question: str | None = None) -> _RewriteResult:
    return _RewriteResult(
        chat=ChatRequest(hub_id=1, message_id=1, message="Original question?"),
        metadata=Metadata(rewritten_question=rewritten_question),
        lang="en",
        lang_confidence=0.99,
        duration_details={},
        classification=None,
        unified_decomposition_result=None,
    )


@pytest.mark.asyncio
async def test_extract_topics_returns_empty_when_disabled(router: RAGRouter) -> None:
    router.config.topic_extraction_enabled = False

    with patch("app.services.router.rag_router.TopicExtractor") as mock_extractor_cls:
        result = await router._extract_topics("What happened in the election?", [])

    assert result == []
    mock_extractor_cls.assert_not_called()


@pytest.mark.asyncio
async def test_extract_topics_returns_topics_and_passes_query_and_existing(router: RAGRouter) -> None:
    with patch("app.services.router.rag_router.TopicExtractor") as mock_extractor_cls:
        mock_extractor = MagicMock()
        mock_extractor.extract = AsyncMock(return_value=["Elections"])
        mock_extractor_cls.return_value = mock_extractor

        result = await router._extract_topics(
            "What were the 2024 election results?",
            ["Elections", "Climate Policy"],
            content_language="en",
        )

    assert result == ["Elections"]
    mock_extractor.extract.assert_called_once_with(
        "What were the 2024 election results?",
        ["Elections", "Climate Policy"],
        content_language="en",
    )


@pytest.mark.asyncio
async def test_extract_topics_swallows_errors(router: RAGRouter) -> None:
    with patch("app.services.router.rag_router.TopicExtractor") as mock_extractor_cls:
        mock_extractor = MagicMock()
        mock_extractor.extract = AsyncMock(side_effect=RuntimeError("boom"))
        mock_extractor_cls.return_value = mock_extractor

        result = await router._extract_topics("Who won the election?", [])

    assert result == []


@pytest.mark.parametrize(
    "response",
    [
        ChatResponse(
            answer="Here is the answer",
            metadata=Metadata(router_intent=QueryIntent.QUESTION.value),
        ),
        ChatResponse(
            answer="Topical summary",
            metadata=Metadata(router_intent=QueryIntent.SYNTHESIS.value),
        ),
        ChatResponse(
            answer="Sorry, no answer",
            error_type=ErrorType.NO_ANSWER_AVAILABLE,
            metadata=Metadata(router_intent=QueryIntent.QUESTION.value, answerable=False),
        ),
        ChatResponse(
            answer="Sorry, no answer",
            error_type=ErrorType.NO_ANSWER_AVAILABLE,
            metadata=Metadata(router_intent=QueryIntent.SYNTHESIS.value, answerable=False),
        ),
    ],
)
def test_should_extract_topics_for_real_questions(router: RAGRouter, response: ChatResponse) -> None:
    assert router._should_extract_topics(response) is True


@pytest.mark.parametrize(
    "response",
    [
        ChatResponse(answer="No metadata"),
        ChatResponse(answer="Hello!", metadata=Metadata(router_intent=QueryIntent.NON_QUESTION.value)),
        ChatResponse(
            answer="I can't discuss my sources",
            error_type=ErrorType.METAQUESTION,
            metadata=Metadata(router_intent=QueryIntent.METAQUESTION.value, answerable=False),
        ),
        ChatResponse(
            answer="I'm a bot that helps with...",
            metadata=Metadata(router_intent=QueryIntent.ROLE_DESCRIPTION.value),
        ),
        ChatResponse(
            answer="Something went wrong",
            error_type=ErrorType.INTERNAL_ERROR,
            metadata=Metadata(router_intent=QueryIntent.QUESTION.value),
        ),
    ],
)
def test_should_extract_topics_false_for_non_questions_and_errors(router: RAGRouter, response: ChatResponse) -> None:
    assert router._should_extract_topics(response) is False


@pytest.mark.asyncio
async def test_route_attaches_topics_for_answered_question(router: RAGRouter) -> None:
    chat = ChatRequest(
        hub_id=1,
        message_id=1,
        message="What about elections?",
        existing_topics=["Elections", "Climate Policy"],
    )
    answer = ChatResponse(
        answer="Policy summary",
        metadata=Metadata(router_intent=QueryIntent.QUESTION.value),
    )

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=_PreflightResult(None, "en", 0.99))),
        patch.object(router, "_rewrite", new=AsyncMock(return_value=_rewrite_result("Rewritten election question?"))),
        patch.object(router, "_answer", new=AsyncMock(return_value=answer)),
        patch.object(router, "_extract_topics", new=AsyncMock(return_value=["Elections"])) as mock_extract,
    ):
        response = await router.route(chat)

    assert response.topics == ["Elections"]
    mock_extract.assert_awaited_once_with(
        "Rewritten election question?", ["Elections", "Climate Policy"], content_language="en"
    )


@pytest.mark.asyncio
async def test_route_attaches_topics_for_unanswered_question(router: RAGRouter) -> None:
    chat = ChatRequest(hub_id=1, message_id=1, message="What about elections?")
    answer = ChatResponse(
        answer="Sorry, no answer",
        error_type=ErrorType.NO_ANSWER_AVAILABLE,
        metadata=Metadata(router_intent=QueryIntent.QUESTION.value, answerable=False),
    )

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=_PreflightResult(None, "en", 0.99))),
        patch.object(router, "_rewrite", new=AsyncMock(return_value=_rewrite_result("Rewritten?"))),
        patch.object(router, "_answer", new=AsyncMock(return_value=answer)),
        patch.object(router, "_extract_topics", new=AsyncMock(return_value=["Elections"])),
    ):
        response = await router.route(chat)

    assert response.topics == ["Elections"]


@pytest.mark.asyncio
async def test_route_uses_original_message_when_no_rewrite(router: RAGRouter) -> None:
    chat = ChatRequest(hub_id=1, message_id=1, message="What about elections?")
    answer = ChatResponse(
        answer="Summary",
        metadata=Metadata(router_intent=QueryIntent.QUESTION.value),
    )

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=_PreflightResult(None, "en", 0.99))),
        patch.object(router, "_rewrite", new=AsyncMock(return_value=_rewrite_result(None))),
        patch.object(router, "_answer", new=AsyncMock(return_value=answer)),
        patch.object(router, "_extract_topics", new=AsyncMock(return_value=["Elections"])) as mock_extract,
    ):
        await router.route(chat)

    mock_extract.assert_awaited_once_with("What about elections?", [], content_language="en")


@pytest.mark.asyncio
async def test_route_skips_topics_for_non_question_intent(router: RAGRouter) -> None:
    chat = ChatRequest(hub_id=1, message_id=1, message="Thanks!")
    answer = ChatResponse(
        answer="You're welcome!",
        metadata=Metadata(router_intent=QueryIntent.NON_QUESTION.value),
    )

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=_PreflightResult(None, "en", 0.99))),
        patch.object(router, "_rewrite", new=AsyncMock(return_value=_rewrite_result(None))),
        patch.object(router, "_answer", new=AsyncMock(return_value=answer)),
        patch.object(router, "_extract_topics", new=AsyncMock(return_value=["Elections"])),
    ):
        response = await router.route(chat)

    assert response.topics == []


@pytest.mark.asyncio
async def test_route_returns_preflight_early_response_without_topics(router: RAGRouter) -> None:
    chat = ChatRequest(hub_id=1, message_id=1, message="hi")
    early = ChatResponse(answer="Hello!", metadata=Metadata())

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=_PreflightResult(early, "en", 0.99))),
        patch.object(router, "_rewrite", new=AsyncMock()) as mock_rewrite,
        patch.object(router, "_answer", new=AsyncMock()) as mock_answer,
        patch.object(router, "_extract_topics", new=AsyncMock()) as mock_extract,
    ):
        response = await router.route(chat)

    assert response is early
    assert response.topics == []
    mock_rewrite.assert_not_awaited()
    mock_answer.assert_not_awaited()
    mock_extract.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_returns_internal_error_when_rewrite_fails(router: RAGRouter) -> None:
    chat = ChatRequest(hub_id=1, message_id=1, message="What about elections?")

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=_PreflightResult(None, "en", 0.99))),
        patch.object(router, "_rewrite", new=AsyncMock(side_effect=RuntimeError("boom"))),
        patch.object(router, "_extract_topics", new=AsyncMock()) as mock_extract,
        patch("app.services.router.rag_router.language") as mock_language,
        patch("app.services.router.rag_router.errors") as mock_errors,
        patch("app.services.router.rag_router.resources_for_scenario", return_value=None),
    ):
        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.get_error_message.return_value = "Something went wrong."

        response = await router.route(chat)

    assert response.error_type == ErrorType.INTERNAL_ERROR
    assert response.topics == []
    mock_extract.assert_not_awaited()


def test_merge_subquery_topics_round_robin() -> None:
    merged = RAGRouter._merge_subquery_topics(
        [["Iran", "Nuclear Program"], ["Middle East", "Diplomacy"]],
        limit=5,
    )
    assert merged == ["Iran", "Middle East", "Nuclear Program", "Diplomacy"]


def test_merge_subquery_topics_dedupes_case_insensitively() -> None:
    merged = RAGRouter._merge_subquery_topics(
        [["Elections", "Politics"], ["elections", "Voting"]],
        limit=5,
    )
    assert merged == ["Elections", "Politics", "Voting"]


def test_merge_subquery_topics_caps_at_limit() -> None:
    merged = RAGRouter._merge_subquery_topics(
        [["A", "C", "E"], ["B", "D", "F"]],
        limit=5,
    )
    assert merged == ["A", "B", "C", "D", "E"]


def test_merge_subquery_topics_skips_blanks_and_uneven_lists() -> None:
    merged = RAGRouter._merge_subquery_topics(
        [["Meedan", ""], ["Pasta", "Food", "Recipes"]],
        limit=5,
    )
    assert merged == ["Meedan", "Pasta", "Food", "Recipes"]


@pytest.mark.asyncio
async def test_extract_subquery_topics_calls_extract_once_per_query(router: RAGRouter) -> None:
    sub_queries = [
        SubQuery(query="Who is the CEO of Meedan?", reasoning="ceo"),
        SubQuery(query="What are the ingredients of pasta carbonara?", reasoning="carbonara"),
    ]

    async def extract(query: str, existing: list[str], *, content_language: str | None = None) -> list[str]:
        return {
            "Who is the CEO of Meedan?": ["Meedan", "Leadership"],
            "What are the ingredients of pasta carbonara?": ["Pasta", "Food"],
        }[query]

    with patch.object(router, "_extract_topics", new=AsyncMock(side_effect=extract)) as mock_extract:
        result = await router._extract_subquery_topics(sub_queries, ["Meedan"], content_language="en")

    assert result == ["Meedan", "Pasta", "Leadership", "Food"]
    assert mock_extract.await_count == 2
    mock_extract.assert_any_await("Who is the CEO of Meedan?", ["Meedan"], content_language="en")
    mock_extract.assert_any_await("What are the ingredients of pasta carbonara?", ["Meedan"], content_language="en")


@pytest.mark.asyncio
async def test_extract_subquery_topics_returns_empty_when_disabled(router: RAGRouter) -> None:
    router.config.topic_extraction_enabled = False
    sub_queries = [SubQuery(query="Who is the CEO of Meedan?", reasoning="ceo")]

    with patch.object(router, "_extract_topics", new=AsyncMock(return_value=["Meedan"])) as mock_extract:
        result = await router._extract_subquery_topics(sub_queries, [])

    assert result == []
    mock_extract.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_keeps_topics_already_set_by_answer(router: RAGRouter) -> None:
    chat = ChatRequest(hub_id=1, message_id=1, message="Who is the CEO of Meedan and who is the president of Croatia?")
    answer = ChatResponse(
        answer="Dima Saber is the CEO. I have no information about Croatia.",
        metadata=Metadata(router_intent=QueryIntent.QUESTION.value),
        topics=["Meedan", "Croatia"],
    )

    with (
        patch.object(router, "_preflight", new=AsyncMock(return_value=_PreflightResult(None, "en", 0.99))),
        patch.object(router, "_rewrite", new=AsyncMock(return_value=_rewrite_result("Rewritten?"))),
        patch.object(router, "_answer", new=AsyncMock(return_value=answer)),
        patch.object(router, "_extract_topics", new=AsyncMock(return_value=["Whole Question"])),
    ):
        response = await router.route(chat)

    assert response.topics == ["Meedan", "Croatia"]


def test_vote_recommendation_is_refused_without_retrieval(router: RAGRouter) -> None:
    """The refusal carries its own error type and intent, keeps answerable False like a
    metaquestion, and is not a question topics get extracted for."""
    from app.services.router.models import QueryContext

    chat = ChatRequest(hub_id=1, message_id=1, message="Who should I vote for?", history=[])
    context = QueryContext(hub_id=1, message_id=1, original_query=chat.message)

    with patch(
        "app.services.router.rag_router.errors.get_error_message", return_value="I can't advise on that."
    ) as msg:
        response = router._handle_vote_recommendation(chat, context, "en", Metadata(), 0.0, None)

    assert response.error_type == ErrorType.VOTE_RECOMMENDATION
    assert response.answer == "I can't advise on that."
    assert msg.call_args.args[0] == ErrorType.VOTE_RECOMMENDATION
    assert response.metadata is not None
    assert response.metadata.answerable is False
    assert response.metadata.router_intent == QueryIntent.VOTE_RECOMMENDATION.value
    assert response.metadata.question_type == "vote_recommendation"
    assert router._should_extract_topics(response) is False


def test_election_results_question_is_refused_without_retrieval(router: RAGRouter) -> None:
    from app.services.router.models import QueryContext

    chat = ChatRequest(hub_id=1, message_id=1, message="Who won the election?", history=[])
    context = QueryContext(hub_id=1, message_id=1, original_query=chat.message)

    with patch(
        "app.services.router.rag_router.errors.get_error_message", return_value="I can't share election results."
    ) as msg:
        response = router._handle_election_results(chat, context, "en", Metadata(), 0.0, None)

    assert response.error_type == ErrorType.ELECTION_RESULTS
    assert response.answer == "I can't share election results."
    assert msg.call_args.args[0] == ErrorType.ELECTION_RESULTS
    assert response.metadata is not None
    assert response.metadata.answerable is False
    assert response.metadata.router_intent == QueryIntent.ELECTION_RESULTS.value
    assert response.metadata.question_type == "election_results"
    assert router._should_extract_topics(response) is False
