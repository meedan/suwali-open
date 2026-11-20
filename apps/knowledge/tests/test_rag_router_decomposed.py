from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.chat import ChatRequest, ErrorType, ExternalResource, Metadata, PersonalizationSettings
from app.models.temporal import TemporalContext, TemporalType
from app.services.router.models import (
    ClassificationResult,
    DecompositionResult,
    KnowledgeSource,
    QueryIntent,
    RouteDecision,
    SequentialExecutionResult,
    SubQuery,
    SubQueryResult,
)


@pytest.fixture
def pt_chat_request() -> ChatRequest:
    return ChatRequest(
        hub_id=2,
        message_id=1,
        message=(
            "O que a imprensa britânica tem relatado sobre o programa nuclear do Irã "
            "e as relações internacionais no Oriente Médio?"
        ),
        history=None,
    )


@pytest.fixture
def decomposed_classification() -> ClassificationResult:
    return ClassificationResult(
        intent=QueryIntent.QUESTION,
        routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
        used_llm=True,
        temporal=TemporalContext(type=TemporalType.NONE),
    )


@pytest.fixture
def decomposed_plan() -> DecompositionResult:
    return DecompositionResult(
        should_decompose=True,
        sub_queries=[
            SubQuery(
                query="O que a imprensa britânica tem relatado sobre o programa nuclear do Irã?",
                reasoning="nuclear topic",
            ),
            SubQuery(
                query="O que a imprensa britânica tem relatado sobre as relações internacionais no Oriente Médio?",
                reasoning="middle east topic",
            ),
        ],
        reasoning="compound question",
    )


@pytest.fixture
def failed_subquery_execution(decomposed_plan: DecompositionResult) -> SequentialExecutionResult:
    return SequentialExecutionResult(
        results=[
            SubQueryResult(sub_query=decomposed_plan.sub_queries[0], answer=None, latency_ms=1.0),
            SubQueryResult(sub_query=decomposed_plan.sub_queries[1], answer=None, latency_ms=1.0),
        ],
        total_latency_ms=2.0,
    )


def _mock_config() -> MagicMock:
    cfg = MagicMock()
    cfg.router_enable_internal_kb = True
    cfg.router_enable_yago = False
    cfg.router_use_llm_classifier = True
    cfg.router_parallel_execution = False
    cfg.router_enable_decomposition = True
    cfg.router_unified_classifier_decomposer = True
    cfg.topic_extraction_enabled = True
    cfg.topic_extraction_max_count = 5
    return cfg


def _to_thread_side_effect(func: object, *args: object) -> object:
    if len(args) == 3:
        chat, _pipeline, metadata = args
        assert isinstance(chat, ChatRequest)
        assert isinstance(metadata, Metadata)
        metadata.rewritten_question = chat.message
        return chat
    return func(*args)  # type: ignore[operator]


@patch("app.services.router.synthesizer.get_error_message")
@patch("app.services.router.rag_router.SubQueryExecutor")
@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_decomposed_all_subqueries_fail_returns_localized_no_answer(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
    mock_executor_cls: MagicMock,
    mock_get_error_message: MagicMock,
    pt_chat_request: ChatRequest,
    decomposed_classification: ClassificationResult,
    decomposed_plan: DecompositionResult,
    failed_subquery_execution: SequentialExecutionResult,
) -> None:
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("pt", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_to_thread.side_effect = _to_thread_side_effect
    mock_errors.get_error_message.return_value = "Desculpe, não encontrei uma resposta."
    mock_get_error_message.return_value = "Sem resultados."

    mock_unified = MagicMock()
    mock_unified.analyze = AsyncMock(return_value=(decomposed_classification, decomposed_plan))

    mock_executor = mock_executor_cls.return_value
    mock_executor.execute = AsyncMock(return_value=failed_subquery_execution)

    router = RAGRouter(hub_id=2)
    router.unified_classifier_decomposer = mock_unified
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True

    response = await router.route(pt_chat_request)

    assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE
    assert response.answer == "Desculpe, não encontrei uma resposta."
    assert response.metadata is not None
    assert response.metadata.language == "pt"
    assert response.metadata.retriever_detected_lang == "pt"
    assert "I don't have enough information" not in response.answer
    # the router must build the fallback itself, offering the personalization
    # resources for the unanswerable_question scenario — not pass through the
    # synthesizer's bare no-answer string
    mock_resources.assert_any_call(pt_chat_request.personalization, "unanswerable_question")
    mock_errors.get_error_message.assert_called_once_with(
        ErrorType.NO_ANSWER_AVAILABLE,
        "pt",
        external_resources=None,
        question=pt_chat_request.message,
        notes=None,
        force_all_resources=False,
    )


@patch("app.services.router.synthesizer.get_error_message")
@patch("app.services.router.rag_router.SubQueryExecutor")
@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario")
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_decomposed_all_subqueries_fail_includes_unanswerable_resources(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
    mock_executor_cls: MagicMock,
    mock_get_error_message: MagicMock,
    pt_chat_request: ChatRequest,
    decomposed_classification: ClassificationResult,
    decomposed_plan: DecompositionResult,
    failed_subquery_execution: SequentialExecutionResult,
) -> None:
    from app.services.router.rag_router import RAGRouter

    resource = ExternalResource(
        title="https://help.example.org",
        description="Contact us when the bot cannot answer",
        scenarios=["unanswerable_question"],
    )
    pt_chat_request.personalization = PersonalizationSettings(
        external_resources=[resource],
    )

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("pt", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_to_thread.side_effect = _to_thread_side_effect
    mock_errors.get_error_message.return_value = "Desculpe. Visite https://help.example.org."
    mock_get_error_message.return_value = "Sem resultados."
    mock_resources.return_value = [resource]

    mock_unified = MagicMock()
    mock_unified.analyze = AsyncMock(return_value=(decomposed_classification, decomposed_plan))

    mock_executor = mock_executor_cls.return_value
    mock_executor.execute = AsyncMock(return_value=failed_subquery_execution)

    router = RAGRouter(hub_id=2)
    router.unified_classifier_decomposer = mock_unified
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True

    response = await router.route(pt_chat_request)

    assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE
    assert response.answer == "Desculpe. Visite https://help.example.org."
    mock_errors.get_error_message.assert_called_once_with(
        ErrorType.NO_ANSWER_AVAILABLE,
        "pt",
        external_resources=[resource],
        question=pt_chat_request.message,
        notes=None,
        force_all_resources=False,
    )


def _answered_subquery_execution(decomposed_plan: DecompositionResult) -> SequentialExecutionResult:
    return SequentialExecutionResult(
        results=[
            SubQueryResult(sub_query=decomposed_plan.sub_queries[0], answer="Iran nuclear coverage.", latency_ms=1.0),
            SubQueryResult(sub_query=decomposed_plan.sub_queries[1], answer="Middle East relations.", latency_ms=1.0),
        ],
        total_latency_ms=2.0,
    )


async def _topics_by_query(
    query: str,
    existing_topics: list[str],
    *,
    content_language: str | None = None,
) -> list[str]:
    if "programa nuclear" in query:
        return ["Iran", "Nuclear Program"]
    if "Oriente Médio" in query:
        return ["Middle East", "Diplomacy"]
    return ["Whole Question"]


@patch("app.services.router.rag_router.ResponseSynthesizer")
@patch("app.services.router.rag_router.SubQueryExecutor")
@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_decomposed_response_uses_merged_subquery_topics(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
    mock_executor_cls: MagicMock,
    mock_synth_cls: MagicMock,
    pt_chat_request: ChatRequest,
    decomposed_classification: ClassificationResult,
    decomposed_plan: DecompositionResult,
) -> None:
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("pt", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_to_thread.side_effect = _to_thread_side_effect

    mock_unified = MagicMock()
    mock_unified.analyze = AsyncMock(return_value=(decomposed_classification, decomposed_plan))
    mock_executor_cls.return_value.execute = AsyncMock(return_value=_answered_subquery_execution(decomposed_plan))
    mock_synth_cls.return_value.synthesize_from_subqueries = AsyncMock(
        return_value=("Combined answer.", {"synthesis_status": "multi_subquery", "subquery_answered_count": 2})
    )

    router = RAGRouter(hub_id=2)
    router.unified_classifier_decomposer = mock_unified
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True

    with patch.object(router, "_extract_topics", new=AsyncMock(side_effect=_topics_by_query)) as mock_extract:
        response = await router.route(pt_chat_request)

    assert response.error_type is None
    assert response.answer == "Combined answer."
    assert response.topics == ["Iran", "Middle East", "Nuclear Program", "Diplomacy"]
    queried = [call.args[0] for call in mock_extract.await_args_list]
    assert decomposed_plan.sub_queries[0].query in queried
    assert decomposed_plan.sub_queries[1].query in queried
    assert queried.count(decomposed_plan.sub_queries[0].query) == 1
    assert queried.count(decomposed_plan.sub_queries[1].query) == 1


@patch("app.services.router.rag_router.ResponseSynthesizer")
@patch("app.services.router.rag_router.SubQueryExecutor")
@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_decomposed_empty_subquery_topics_fall_back_to_whole_question(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
    mock_executor_cls: MagicMock,
    mock_synth_cls: MagicMock,
    pt_chat_request: ChatRequest,
    decomposed_classification: ClassificationResult,
    decomposed_plan: DecompositionResult,
) -> None:
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("pt", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_to_thread.side_effect = _to_thread_side_effect

    mock_unified = MagicMock()
    mock_unified.analyze = AsyncMock(return_value=(decomposed_classification, decomposed_plan))
    mock_executor_cls.return_value.execute = AsyncMock(return_value=_answered_subquery_execution(decomposed_plan))
    mock_synth_cls.return_value.synthesize_from_subqueries = AsyncMock(
        return_value=("Combined answer.", {"synthesis_status": "multi_subquery", "subquery_answered_count": 2})
    )

    router = RAGRouter(hub_id=2)
    router.unified_classifier_decomposer = mock_unified
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True

    async def empty_for_subqueries(
        query: str, existing_topics: list[str], *, content_language: str | None = None
    ) -> list[str]:
        if query in {sq.query for sq in decomposed_plan.sub_queries}:
            return []
        return ["Whole Question"]

    with patch.object(router, "_extract_topics", new=AsyncMock(side_effect=empty_for_subqueries)):
        response = await router.route(pt_chat_request)

    assert response.topics == ["Whole Question"]


@patch("app.services.router.synthesizer.get_error_message")
@patch("app.services.router.rag_router.SubQueryExecutor")
@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_decomposed_no_answer_still_attaches_subquery_topics(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
    mock_executor_cls: MagicMock,
    mock_get_error_message: MagicMock,
    pt_chat_request: ChatRequest,
    decomposed_classification: ClassificationResult,
    decomposed_plan: DecompositionResult,
    failed_subquery_execution: SequentialExecutionResult,
) -> None:
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("pt", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("pt", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_to_thread.side_effect = _to_thread_side_effect
    mock_errors.get_error_message.return_value = "Desculpe, não encontrei uma resposta."
    mock_get_error_message.return_value = "Sem resultados."

    mock_unified = MagicMock()
    mock_unified.analyze = AsyncMock(return_value=(decomposed_classification, decomposed_plan))
    mock_executor_cls.return_value.execute = AsyncMock(return_value=failed_subquery_execution)

    router = RAGRouter(hub_id=2)
    router.unified_classifier_decomposer = mock_unified
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True

    with patch.object(router, "_extract_topics", new=AsyncMock(side_effect=_topics_by_query)):
        response = await router.route(pt_chat_request)

    assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE
    assert response.topics == ["Iran", "Middle East", "Nuclear Program", "Diplomacy"]
