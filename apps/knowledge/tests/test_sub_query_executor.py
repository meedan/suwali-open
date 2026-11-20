import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.router.models import (
    HandlerResult,
    KnowledgeSource,
    QueryContext,
    RouteDecision,
    SubQuery,
)
from app.services.router.sub_query_executor import SubQueryExecutor


@pytest.fixture
def mock_context() -> QueryContext:
    return QueryContext(
        hub_id=1,
        message_id=123,
        original_query="Test query",
        rewritten_query="Test query",
        detected_language="en",
    )


@pytest.fixture
def mock_routes() -> list[RouteDecision]:
    return [
        RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.8, priority=0),
        RouteDecision(source=KnowledgeSource.YAGO, confidence=0.6, priority=1),
    ]


@pytest.fixture
def mock_enricher() -> MagicMock:
    enricher = MagicMock()
    enricher.source = KnowledgeSource.YAGO
    enricher.is_enabled.return_value = True
    return enricher


@pytest.fixture
def mock_internal_handler() -> MagicMock:
    """Create a mock internal KB handler."""
    handler = MagicMock()
    handler.is_enabled.return_value = True
    return handler


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_execute_single_subquery(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_routes: list[RouteDecision],
    mock_enricher: MagicMock,
    mock_internal_handler: MagicMock,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_parallel_execution = False

    mock_aggregator = mock_aggregator_class.return_value
    mock_aggregator.aggregate = AsyncMock(
        return_value=MagicMock(
            results=[
                HandlerResult(
                    source=KnowledgeSource.YAGO,
                    success=True,
                    answer="Marie Curie",
                    confidence=0.9,
                    context_snippets=["Marie Curie founded the Radium Institute"],
                )
            ]
        )
    )

    mock_internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=True,
            answer="Marie Curie founded the Radium Institute",
            confidence=0.8,
        )
    )

    sub_queries = [SubQuery(query="Who founded the Radium Institute?", reasoning="Identify founder", dependencies=[])]

    executor = SubQueryExecutor(enrichers=[mock_enricher], internal_handler=mock_internal_handler)

    result = await executor.execute_sequential(sub_queries, mock_context, mock_routes)

    assert len(result.results) == 1
    assert result.results[0].sub_query.query == "Who founded the Radium Institute?"
    assert result.results[0].answer is not None
    assert result.total_latency_ms > 0


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
@patch("app.services.router.sub_query_executor.create_chat_model")
async def test_execute_sequential_with_dependencies(
    mock_create: MagicMock,
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_routes: list[RouteDecision],
    mock_enricher: MagicMock,
    mock_internal_handler: MagicMock,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_parallel_execution = False

    mock_aggregator = mock_aggregator_class.return_value
    mock_aggregator.aggregate = AsyncMock(return_value=MagicMock(results=[]))

    mock_internal_handler.retrieve = AsyncMock(
        side_effect=[
            HandlerResult(
                source=KnowledgeSource.INTERNAL_KB,
                success=True,
                answer="Marie Curie",
                confidence=0.8,
            ),
            HandlerResult(
                source=KnowledgeSource.INTERNAL_KB,
                success=True,
                answer="Warsaw",
                confidence=0.8,
            ),
        ]
    )

    sub_queries = [
        SubQuery(query="Who founded the Radium Institute?", reasoning="Identify founder", dependencies=[]),
        SubQuery(
            query="Where was the founder born?",
            reasoning="Find birthplace",
            dependencies=[0],
        ),
    ]

    executor = SubQueryExecutor(enrichers=[mock_enricher], internal_handler=mock_internal_handler)

    result = await executor.execute_sequential(sub_queries, mock_context, mock_routes)

    assert len(result.results) == 2
    assert result.results[0].answer == "Marie Curie"
    assert result.results[1].answer == "Warsaw"
    assert mock_internal_handler.retrieve.call_count == 2


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_execute_with_no_successful_results(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_routes: list[RouteDecision],
    mock_enricher: MagicMock,
    mock_internal_handler: MagicMock,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_parallel_execution = False

    mock_aggregator = mock_aggregator_class.return_value
    mock_aggregator.aggregate = AsyncMock(
        return_value=MagicMock(
            results=[
                HandlerResult(
                    source=KnowledgeSource.YAGO,
                    success=False,
                    error="Query failed",
                )
            ]
        )
    )

    mock_internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=False,
            error="No results",
        )
    )

    sub_queries = [SubQuery(query="Who founded XYZ?", reasoning="Identify founder", dependencies=[])]

    executor = SubQueryExecutor(enrichers=[mock_enricher], internal_handler=mock_internal_handler)

    result = await executor.execute_sequential(sub_queries, mock_context, mock_routes)

    assert len(result.results) == 1
    assert result.results[0].answer is None


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
@patch("app.services.router.sub_query_executor.create_chat_model")
async def test_synthesize_multiple_sources(
    mock_create: MagicMock,
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_routes: list[RouteDecision],
    mock_enricher: MagicMock,
    mock_internal_handler: MagicMock,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_parallel_execution = False

    mock_aggregator = mock_aggregator_class.return_value
    mock_aggregator.aggregate = AsyncMock(
        return_value=MagicMock(
            results=[
                HandlerResult(
                    source=KnowledgeSource.YAGO,
                    success=True,
                    answer="Answer from YAGO",
                    confidence=0.7,
                )
            ]
        )
    )

    mock_internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=True,
            answer="Answer from Internal KB",
            confidence=0.8,
        )
    )

    mock_llm = MagicMock()
    mock_response = MagicMock()
    mock_response.content = "Synthesized answer from both sources"
    mock_llm.ainvoke = AsyncMock(return_value=mock_response)
    mock_create.return_value = mock_llm

    sub_queries = [SubQuery(query="Test query?", reasoning="Test", dependencies=[])]

    executor = SubQueryExecutor(enrichers=[mock_enricher], internal_handler=mock_internal_handler)

    result = await executor.execute_sequential(sub_queries, mock_context, mock_routes)

    assert len(result.results) == 1
    assert result.results[0].answer is not None
    assert "Synthesized answer" in result.results[0].answer
    mock_llm.ainvoke.assert_called_once()


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_accumulated_facts_passed_to_later_queries(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_routes: list[RouteDecision],
    mock_enricher: MagicMock,
    mock_internal_handler: MagicMock,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_parallel_execution = False

    mock_aggregator = mock_aggregator_class.return_value
    mock_aggregator.aggregate = AsyncMock(
        return_value=MagicMock(
            results=[
                HandlerResult(
                    source=KnowledgeSource.YAGO,
                    success=True,
                    answer=None,
                    confidence=0.8,
                    context_snippets=["Enrichment fact"],
                )
            ]
        )
    )

    first_answer = "First answer"
    first_query = "First query?"
    mock_internal_handler.retrieve = AsyncMock(
        side_effect=[
            HandlerResult(
                source=KnowledgeSource.INTERNAL_KB,
                success=True,
                answer=first_answer,
                confidence=0.8,
            ),
            HandlerResult(
                source=KnowledgeSource.INTERNAL_KB,
                success=True,
                answer="Second answer",
                confidence=0.8,
            ),
        ]
    )

    sub_queries = [
        SubQuery(query=first_query, reasoning="First", dependencies=[]),
        SubQuery(query="Second query?", reasoning="Second", dependencies=[0]),
    ]

    executor = SubQueryExecutor(enrichers=[mock_enricher], internal_handler=mock_internal_handler)

    result = await executor.execute_sequential(sub_queries, mock_context, mock_routes)

    assert len(result.results) == 2

    second_call_args = mock_internal_handler.retrieve.call_args_list[1]
    enrichment_facts = second_call_args[1]["enrichment_facts"]

    assert any(first_query in fact and first_answer in fact for fact in enrichment_facts)
    assert any("Enrichment fact" in fact for fact in enrichment_facts)


# --- _build_execution_layers tests ---


def test_build_layers_all_independent() -> None:
    sub_queries = [
        SubQuery(query="Q1", reasoning="r", dependencies=[]),
        SubQuery(query="Q2", reasoning="r", dependencies=[]),
        SubQuery(query="Q3", reasoning="r", dependencies=[]),
    ]
    layers = SubQueryExecutor._build_execution_layers(sub_queries)
    assert layers == [[0, 1, 2]]


def test_build_layers_linear_chain() -> None:
    sub_queries = [
        SubQuery(query="Q1", reasoning="r", dependencies=[]),
        SubQuery(query="Q2", reasoning="r", dependencies=[0]),
        SubQuery(query="Q3", reasoning="r", dependencies=[1]),
    ]
    layers = SubQueryExecutor._build_execution_layers(sub_queries)
    assert layers == [[0], [1], [2]]


def test_build_layers_diamond() -> None:
    """Q0 has no deps; Q1 and Q2 depend on Q0; Q3 depends on Q1 and Q2."""
    sub_queries = [
        SubQuery(query="Q0", reasoning="r", dependencies=[]),
        SubQuery(query="Q1", reasoning="r", dependencies=[0]),
        SubQuery(query="Q2", reasoning="r", dependencies=[0]),
        SubQuery(query="Q3", reasoning="r", dependencies=[1, 2]),
    ]
    layers = SubQueryExecutor._build_execution_layers(sub_queries)
    assert layers == [[0], [1, 2], [3]]


def test_build_layers_single() -> None:
    sub_queries = [SubQuery(query="Q1", reasoning="r", dependencies=[])]
    layers = SubQueryExecutor._build_execution_layers(sub_queries)
    assert layers == [[0]]


def test_build_layers_circular_deps_forced() -> None:
    """Circular dependencies should be forced into a single layer rather than looping forever."""
    sub_queries = [
        SubQuery(query="Q0", reasoning="r", dependencies=[1]),
        SubQuery(query="Q1", reasoning="r", dependencies=[0]),
    ]
    layers = SubQueryExecutor._build_execution_layers(sub_queries)
    assert len(layers) == 1
    assert set(layers[0]) == {0, 1}


# --- execute() tests ---


def _make_handler_result(answer: str) -> HandlerResult:
    return HandlerResult(
        source=KnowledgeSource.INTERNAL_KB,
        success=True,
        answer=answer,
        confidence=0.8,
    )


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_execute_independent_subqueries_run_in_parallel(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_internal_handler: MagicMock,
) -> None:
    """Three independent sub-queries should run in a single layer (parallel)."""
    mock_config_class.return_value.router_parallel_execution = False
    mock_aggregator_class.return_value.aggregate = AsyncMock(return_value=MagicMock(results=[]))

    async def slow_retrieve(query: str, context: QueryContext, **kwargs: object) -> HandlerResult:
        await asyncio.sleep(0.3)
        return _make_handler_result(f"Answer to {query}")

    mock_internal_handler.retrieve = AsyncMock(side_effect=slow_retrieve)

    sub_queries = [
        SubQuery(query="Q1", reasoning="r", dependencies=[]),
        SubQuery(query="Q2", reasoning="r", dependencies=[]),
        SubQuery(query="Q3", reasoning="r", dependencies=[]),
    ]
    routes = [RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.8)]

    executor = SubQueryExecutor(enrichers=[], internal_handler=mock_internal_handler)
    result = await executor.execute(sub_queries, mock_context, routes)

    assert len(result.results) == 3
    assert all(r.answer is not None for r in result.results)
    # 3 x 0.3s sequential would be ~900ms; asyncio.gather should be ~300ms + overhead
    assert result.total_latency_ms < 700


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_execute_dependent_subqueries_respect_ordering(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_internal_handler: MagicMock,
) -> None:
    """Q1 depends on Q0 — Q0 must complete before Q1 starts."""
    mock_config_class.return_value.router_parallel_execution = False
    mock_aggregator_class.return_value.aggregate = AsyncMock(return_value=MagicMock(results=[]))

    call_order: list[str] = []

    async def ordered_retrieve(query: str, context: QueryContext, **kwargs: object) -> HandlerResult:
        call_order.append(query)
        return _make_handler_result(f"Answer to {query}")

    mock_internal_handler.retrieve = AsyncMock(side_effect=ordered_retrieve)

    sub_queries = [
        SubQuery(query="Q0", reasoning="r", dependencies=[]),
        SubQuery(query="Q1", reasoning="r", dependencies=[0]),
    ]
    routes = [RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.8)]

    executor = SubQueryExecutor(enrichers=[], internal_handler=mock_internal_handler)
    result = await executor.execute(sub_queries, mock_context, routes)

    assert len(result.results) == 2
    assert call_order == ["Q0", "Q1"]
    assert result.results[0].answer == "Answer to Q0"
    assert result.results[1].answer == "Answer to Q1"


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_execute_error_in_one_does_not_block_others(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_internal_handler: MagicMock,
) -> None:
    """If one sub-query's handler fails, the others in the same layer still complete."""
    mock_config_class.return_value.router_parallel_execution = False
    mock_aggregator_class.return_value.aggregate = AsyncMock(return_value=MagicMock(results=[]))

    async def failing_retrieve(query: str, context: QueryContext, **kwargs: object) -> HandlerResult:
        if query == "Q_fail":
            return HandlerResult(source=KnowledgeSource.INTERNAL_KB, success=False, error="boom")
        return _make_handler_result(f"Answer to {query}")

    mock_internal_handler.retrieve = AsyncMock(side_effect=failing_retrieve)

    sub_queries = [
        SubQuery(query="Q_ok", reasoning="r", dependencies=[]),
        SubQuery(query="Q_fail", reasoning="r", dependencies=[]),
        SubQuery(query="Q_also_ok", reasoning="r", dependencies=[]),
    ]
    routes = [RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.8)]

    executor = SubQueryExecutor(enrichers=[], internal_handler=mock_internal_handler)
    result = await executor.execute(sub_queries, mock_context, routes)

    assert len(result.results) == 3
    answers = {r.sub_query.query: r.answer for r in result.results}
    assert answers["Q_ok"] == "Answer to Q_ok"
    assert answers["Q_fail"] is None
    assert answers["Q_also_ok"] == "Answer to Q_also_ok"


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_execute_single_subquery_fast_path(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_internal_handler: MagicMock,
) -> None:
    """Single sub-query takes the fast path (no asyncio.gather)."""
    mock_config_class.return_value.router_parallel_execution = False
    mock_aggregator_class.return_value.aggregate = AsyncMock(return_value=MagicMock(results=[]))
    mock_internal_handler.retrieve = AsyncMock(return_value=_make_handler_result("Only answer"))

    sub_queries = [SubQuery(query="Q1", reasoning="r", dependencies=[])]
    routes = [RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.8)]

    executor = SubQueryExecutor(enrichers=[], internal_handler=mock_internal_handler)
    result = await executor.execute(sub_queries, mock_context, routes)

    assert len(result.results) == 1
    assert result.results[0].answer == "Only answer"


@patch("app.services.router.sub_query_executor.Config")
@patch("app.services.router.sub_query_executor.LLMConfig")
@patch("app.services.router.sub_query_executor.ResultAggregator")
async def test_execute_clears_dependencies_and_runs_all_in_parallel(
    mock_aggregator_class: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_internal_handler: MagicMock,
) -> None:
    """Dependencies emitted by the LLM are cleared — all sub-queries run in one parallel layer."""
    mock_config_class.return_value.router_parallel_execution = False
    mock_aggregator_class.return_value.aggregate = AsyncMock(return_value=MagicMock(results=[]))

    mock_internal_handler.retrieve = AsyncMock(
        side_effect=[
            _make_handler_result("Marie Curie"),
            _make_handler_result("Warsaw"),
        ]
    )

    sub_queries = [
        SubQuery(query="Who founded it?", reasoning="r", dependencies=[]),
        SubQuery(query="Where were they born?", reasoning="r", dependencies=[0]),
    ]
    routes = [RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.8)]

    executor = SubQueryExecutor(enrichers=[], internal_handler=mock_internal_handler)
    result = await executor.execute(sub_queries, mock_context, routes)

    # dependencies were cleared, so both ran in parallel (single layer, no accumulated facts)
    assert len(result.results) == 2
    assert sub_queries[1].dependencies == []

    for call in mock_internal_handler.retrieve.call_args_list:
        facts = call[1]["enrichment_facts"]
        assert facts == []
