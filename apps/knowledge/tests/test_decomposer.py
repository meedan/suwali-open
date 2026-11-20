from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.router.decomposer import LLMDecompositionOutput, QueryDecomposer
from app.services.router.models import (
    ClassificationResult,
    KnowledgeSource,
    QueryContext,
    QueryIntent,
    RouteDecision,
)


def _configure_pipeline_mocks(
    prompt_template_patch: MagicMock,
    create_chat_model_patch: MagicMock,
    parser_patch: MagicMock,
) -> tuple[MagicMock, MagicMock, MagicMock, MagicMock]:
    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model

    # prompt_chain.ainvoke() returns an AIMessage-like object with content
    mock_ai_message = MagicMock()
    mock_ai_message.content = '{"should_decompose": false}'
    mock_ai_message.response_metadata = {"token_usage": {"completion_tokens": 50}}
    mock_prompt_model.ainvoke = AsyncMock(return_value=mock_ai_message)

    prompt_template_patch.return_value = mock_prompt

    mock_model_instance = MagicMock()
    create_chat_model_patch.return_value = mock_model_instance

    mock_parser_instance = MagicMock()
    mock_parser_instance.get_format_instructions.return_value = "mock-format"
    parser_patch.return_value = mock_parser_instance

    return mock_prompt, mock_prompt_model, mock_ai_message, mock_parser_instance


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
def mock_classification() -> ClassificationResult:
    return ClassificationResult(
        routes=[
            RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.8, priority=0),
            RouteDecision(source=KnowledgeSource.YAGO, confidence=0.6, priority=1),
        ],
        used_llm=True,
        reasoning="Test classification",
    )


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
async def test_non_question_intent_skips_decomposition_llm(
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True

    classification = ClassificationResult(
        intent=QueryIntent.SPEAK_TO_PERSON,
        routes=[],
        reasoning="Scenario intent",
    )

    decomposer = QueryDecomposer()
    result = await decomposer.analyze("Can I talk to a real person?", mock_context, classification)

    assert not result.should_decompose
    assert "speak_to_person" in result.reasoning


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
async def test_decomposition_disabled_via_config(
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    """When decomposition is disabled in config, should not decompose."""
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = False

    decomposer = QueryDecomposer()
    result = await decomposer.analyze("Test query", mock_context, mock_classification)

    assert not result.should_decompose
    assert result.reasoning == "Decomposition disabled in configuration"
    assert len(result.sub_queries) == 0


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
async def test_short_query_not_decomposed(
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True

    decomposer = QueryDecomposer()
    result = await decomposer.analyze("Short query", mock_context, mock_classification)

    assert not result.should_decompose
    assert "too short" in result.reasoning.lower()
    assert len(result.sub_queries) == 0


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
@patch("app.services.router.decomposer.create_chat_model")
@patch("app.services.router.decomposer.PydanticOutputParser")
@patch("app.services.router.decomposer.PromptTemplate.from_template")
async def test_decompose_multi_intent_query(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    """Multi-intent queries should be decomposed into sub-queries."""
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True
    mock_config.router_decomposition_max_subqueries = 5

    (
        mock_prompt,
        mock_prompt_model,
        mock_ai_message,
        mock_parser_instance,
    ) = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    expected_output = LLMDecompositionOutput(
        should_decompose=True,
        sub_queries=[
            {"query": "Who founded Wikipedia?", "reasoning": "First identify founder", "dependencies": []},
            {
                "query": "Where was the founder of Wikipedia born?",
                "reasoning": "Find birthplace",
                "dependencies": [0],
            },
        ],
        reasoning="Multi-intent query requiring separate lookups",
    )
    mock_parser_instance.invoke.return_value = expected_output

    decomposer = QueryDecomposer()
    result = await decomposer.analyze(
        "Who founded Wikipedia and where were they born?",
        mock_context,
        mock_classification,
    )

    assert result.should_decompose
    assert len(result.sub_queries) == 2
    assert result.sub_queries[0].query == "Who founded Wikipedia?"
    assert result.sub_queries[0].dependencies == []
    assert result.sub_queries[1].query == "Where was the founder of Wikipedia born?"
    assert result.sub_queries[1].dependencies == [0]
    assert result.reasoning == "Multi-intent query requiring separate lookups"


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
@patch("app.services.router.decomposer.create_chat_model")
@patch("app.services.router.decomposer.PydanticOutputParser")
@patch("app.services.router.decomposer.PromptTemplate.from_template")
async def test_simple_query_not_decomposed(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    """Simple queries should not be decomposed."""
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True

    (
        mock_prompt,
        mock_prompt_model,
        mock_ai_message,
        mock_parser_instance,
    ) = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    expected_output = LLMDecompositionOutput(
        should_decompose=False,
        sub_queries=[],
        reasoning="Simple single-intent query, no decomposition needed",
    )
    mock_parser_instance.invoke.return_value = expected_output

    decomposer = QueryDecomposer()
    result = await decomposer.analyze(
        "What is our refund policy for products and services we offer?",
        mock_context,
        mock_classification,
    )

    assert not result.should_decompose
    assert len(result.sub_queries) == 0
    assert "single-intent" in result.reasoning.lower()


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
@patch("app.services.router.decomposer.create_chat_model")
@patch("app.services.router.decomposer.PydanticOutputParser")
@patch("app.services.router.decomposer.PromptTemplate.from_template")
async def test_max_subqueries_limit_enforced(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    """Should limit sub-queries to configured maximum."""
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True
    mock_config.router_decomposition_max_subqueries = 3

    (
        mock_prompt,
        mock_prompt_model,
        mock_ai_message,
        mock_parser_instance,
    ) = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    expected_output = LLMDecompositionOutput(
        should_decompose=True,
        sub_queries=[
            {"query": "Query 1", "reasoning": "Reason 1", "dependencies": []},
            {"query": "Query 2", "reasoning": "Reason 2", "dependencies": []},
            {"query": "Query 3", "reasoning": "Reason 3", "dependencies": []},
            {"query": "Query 4", "reasoning": "Reason 4", "dependencies": []},
            {"query": "Query 5", "reasoning": "Reason 5", "dependencies": []},
        ],
        reasoning="Complex query with many parts",
    )
    mock_parser_instance.invoke.return_value = expected_output

    decomposer = QueryDecomposer()
    result = await decomposer.analyze(
        "Very complex query with many parts that should be limited",
        mock_context,
        mock_classification,
    )

    assert result.should_decompose
    assert len(result.sub_queries) == 3


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
@patch("app.services.router.decomposer.create_chat_model")
@patch("app.services.router.decomposer.PydanticOutputParser")
@patch("app.services.router.decomposer.PromptTemplate.from_template")
async def test_llm_failure_returns_no_decomposition(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    """LLM failures should result in no decomposition."""
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True

    (
        mock_prompt,
        mock_prompt_model,
        mock_ai_message,
        mock_parser_instance,
    ) = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_prompt_model.ainvoke = AsyncMock(side_effect=RuntimeError("LLM failure"))

    decomposer = QueryDecomposer()
    result = await decomposer.analyze(
        "Who founded Wikipedia and where were they born?",
        mock_context,
        mock_classification,
    )

    assert not result.should_decompose
    assert "failed" in result.reasoning.lower()
    assert len(result.sub_queries) == 0


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
@patch("app.services.router.decomposer.create_chat_model")
@patch("app.services.router.decomposer.PydanticOutputParser")
@patch("app.services.router.decomposer.PromptTemplate.from_template")
async def test_decomposer_retries_once_when_first_llm_response_empty(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True

    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model

    empty_msg = MagicMock()
    empty_msg.content = ""
    empty_msg.response_metadata = {"token_usage": {"completion_tokens": 0}}

    good_msg = MagicMock()
    good_msg.content = '{"should_decompose": false}'
    good_msg.response_metadata = {"token_usage": {"completion_tokens": 12}}

    mock_prompt_model.ainvoke = AsyncMock(side_effect=[empty_msg, good_msg])

    mock_prompt_from_template.return_value = mock_prompt

    mock_model_instance = MagicMock()
    mock_create.return_value = mock_model_instance

    mock_parser_instance = MagicMock()
    mock_parser_instance.get_format_instructions.return_value = "mock-format"
    mock_parser_factory.return_value = mock_parser_instance

    expected_output = LLMDecompositionOutput(
        should_decompose=False,
        sub_queries=[],
        reasoning="ok",
    )
    mock_parser_instance.invoke.return_value = expected_output

    decomposer = QueryDecomposer()
    result = await decomposer.analyze(
        "Who founded Wikipedia and where were they born?",
        mock_context,
        mock_classification,
    )

    assert mock_prompt_model.ainvoke.call_count == 2
    assert not result.should_decompose


@patch("app.services.router.decomposer.Config")
@patch("app.services.router.decomposer.LLMConfig")
@patch("app.services.router.decomposer.create_chat_model")
@patch("app.services.router.decomposer.PydanticOutputParser")
@patch("app.services.router.decomposer.PromptTemplate.from_template")
async def test_decomposer_two_empty_llm_responses_skip_decomposition(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
    mock_config_class: MagicMock,
    mock_context: QueryContext,
    mock_classification: ClassificationResult,
) -> None:
    mock_config = mock_config_class.return_value
    mock_config.router_enable_decomposition = True

    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model

    empty_msg = MagicMock()
    empty_msg.content = ""
    empty_msg.response_metadata = {"token_usage": {"completion_tokens": 99}}
    mock_prompt_model.ainvoke = AsyncMock(return_value=empty_msg)

    mock_prompt_from_template.return_value = mock_prompt
    mock_create.return_value = MagicMock()
    mock_parser_instance = MagicMock()
    mock_parser_instance.get_format_instructions.return_value = "mock-format"
    mock_parser_factory.return_value = mock_parser_instance

    decomposer = QueryDecomposer()
    result = await decomposer.analyze(
        "Who founded Wikipedia and where were they born?",
        mock_context,
        mock_classification,
    )

    assert mock_prompt_model.ainvoke.call_count == 2
    assert not result.should_decompose
    assert "empty content" in result.reasoning.lower()
