from collections.abc import Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from app.models.chat import ContextNote
from app.services.router.classifier import LLMClassificationOutput
from app.services.router.classifier_decomposer import (
    LLMUnifiedClassificationDecompositionOutput,
    UnifiedClassifierDecomposer,
)
from app.services.router.decomposer import LLMDecompositionOutput
from app.services.router.models import (
    KnowledgeSource,
    QueryContext,
    QueryIntent,
    SynthesisType,
)
from app.services.router.prompts import LOCATION_ONLY_REPLY, USER_LOCATION_DEPENDENCE


def _configure_pipeline_mocks(
    prompt_template_patch: MagicMock,
    create_chat_model_patch: MagicMock,
    parser_patch: MagicMock,
) -> tuple[MagicMock, MagicMock, MagicMock, MagicMock]:
    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model

    mock_ai_message = MagicMock()
    mock_ai_message.content = '{"classification": {}, "decomposition": {}}'
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
def patched_config() -> Generator[MagicMock, None, None]:
    """Configure both Config patches needed because UnifiedClassifierDecomposer
    instantiates an inner QueryClassifier."""
    with (
        patch("app.services.router.classifier_decomposer.Config") as mock_cd_config,
        patch("app.services.router.classifier_decomposer.LLMConfig"),
        patch("app.services.router.classifier.Config") as mock_classifier_config,
        patch("app.services.router.classifier.LLMConfig"),
    ):
        cfg = mock_cd_config.return_value
        cfg.router_enable_decomposition = True
        cfg.router_decomposition_max_subqueries = 5
        mock_classifier_config.return_value = cfg
        yield cfg


async def test_heuristic_speak_to_person_short_circuits_without_llm(
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    with patch("app.services.router.classifier_decomposer.create_chat_model") as mock_create:
        ucd = UnifiedClassifierDecomposer()
        classification, decomposition = await ucd.analyze("Can I talk to a real person?", mock_context)

        mock_create.assert_not_called()

    assert classification.intent == QueryIntent.SPEAK_TO_PERSON
    assert classification.used_llm is False
    assert decomposition.should_decompose is False


async def test_heuristic_non_question_short_circuits_without_llm(
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """Greetings hit the classifier's heuristic gate; no LLM call should be made."""
    with patch("app.services.router.classifier_decomposer.create_chat_model") as mock_create:
        ucd = UnifiedClassifierDecomposer()
        classification, decomposition = await ucd.analyze("hi", mock_context)

        mock_create.assert_not_called()

    assert classification.intent == QueryIntent.NON_QUESTION
    assert classification.routes == []
    assert classification.used_llm is False
    assert decomposition.should_decompose is False
    assert decomposition.sub_queries == []
    assert "heuristic" in decomposition.reasoning.lower()


async def test_heuristic_structured_query_short_circuits_without_llm(
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """A structured fact query (matched by heuristics) shouldn't reach the LLM."""
    with patch("app.services.router.classifier_decomposer.create_chat_model") as mock_create:
        ucd = UnifiedClassifierDecomposer()
        classification, decomposition = await ucd.analyze("Who founded Tesla?", mock_context)

        mock_create.assert_not_called()

    assert classification.intent == QueryIntent.QUESTION
    assert any(r.source == KnowledgeSource.YAGO for r in classification.routes)
    assert decomposition.should_decompose is False


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_llm_question_with_decomposition(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """LLM returns both classification + decomposition sub-objects in one shot."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb", "yago"],
            confidences=[0.8, 0.6],
            reasoning="Multi-intent factual question",
            is_metaquestion=False,
            is_synthesis=False,
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[
                {"query": "Who founded Wikipedia?", "reasoning": "First identify founder", "dependencies": []},
                {
                    "query": "Where was the founder of Wikipedia born?",
                    "reasoning": "Find birthplace",
                    "dependencies": [0],
                },
            ],
            reasoning="Multi-intent compound query",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze(
        "Tell me about Wikipedia's origin story and the birthplace of its primary founder.",
        mock_context,
    )

    assert classification.intent == QueryIntent.QUESTION
    assert classification.used_llm is True
    assert classification.reasoning == "Multi-intent factual question"
    sources = {r.source for r in classification.routes}
    assert KnowledgeSource.INTERNAL_KB in sources
    assert KnowledgeSource.YAGO in sources

    assert decomposition.should_decompose is True
    assert len(decomposition.sub_queries) == 2
    assert decomposition.sub_queries[0].query == "Who founded Wikipedia?"
    assert decomposition.sub_queries[1].dependencies == [0]
    assert decomposition.reasoning == "Multi-intent compound query"


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_metaquestion_forces_no_decomposition(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """Even if the LLM erroneously sets should_decompose=true, metaquestions are not decomposed."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=[],
            confidences=[],
            reasoning="Asks about the system itself",
            is_metaquestion=True,
            is_synthesis=False,
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[{"query": "x", "reasoning": "y", "dependencies": []}],
            reasoning="should be ignored by metaquestion guard",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze(
        "How many articles do you actually have available in your knowledge base?",
        mock_context,
    )

    assert classification.intent == QueryIntent.METAQUESTION
    assert decomposition.should_decompose is False
    assert decomposition.sub_queries == []


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_synthesis_forces_no_decomposition(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """Synthesis intent must not trigger decomposition either."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.7],
            reasoning="Wants a digest",
            is_metaquestion=False,
            is_synthesis=True,
            synthesis_time_window_days=7,
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[{"query": "x", "reasoning": "y", "dependencies": []}],
            reasoning="should be ignored by synthesis guard",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze(
        "Please summarize the top stories from this past week for me",
        mock_context,
    )

    assert classification.intent == QueryIntent.SYNTHESIS
    assert classification.synthesis is not None
    assert classification.synthesis.type == SynthesisType.TEMPORAL
    assert decomposition.should_decompose is False


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_topical_summary_classifies_as_synthesis_with_topical_subtype(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """A topical-summary query routes through the unified path with SynthesisType.TOPICAL and the extracted topic."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.9],
            reasoning="User wants a topical overview of Iran",
            is_metaquestion=False,
            is_synthesis=True,
            synthesis_type="topical",
            synthesis_topic="Iran",
            synthesis_time_window_days=None,
            temporal_type="none",
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[{"query": "x", "reasoning": "y", "dependencies": []}],
            reasoning="should be ignored by synthesis guard",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze(
        "Tell me all you know about Iran.",
        mock_context,
    )

    assert classification.intent == QueryIntent.SYNTHESIS
    assert classification.synthesis is not None
    assert classification.synthesis.type == SynthesisType.TOPICAL
    assert classification.synthesis.topic == "Iran"
    assert classification.synthesis.time_window_days is None
    assert decomposition.should_decompose is False


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_decomposition_disabled_via_config_ignores_llm_subqueries(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    patched_config.router_enable_decomposition = False

    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.8],
            reasoning="Multi-intent",
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[{"query": "x", "reasoning": "y", "dependencies": []}],
            reasoning="should be ignored because decomposition disabled",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    _, decomposition = await ucd.analyze(
        "Tell me about Wikipedia's origin story and the birthplace of its primary founder.",
        mock_context,
    )

    assert decomposition.should_decompose is False
    assert decomposition.reasoning == "Decomposition disabled in configuration"


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_short_query_skips_decomposition(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """The < 8 word gate from the standalone decomposer is preserved."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.8],
            reasoning="Compound question",
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[{"query": "x", "reasoning": "y", "dependencies": []}],
            reasoning="should be ignored by short-query gate",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    # 7 words -> below the gate
    _, decomposition = await ucd.analyze("Compare revenue across years X Y Z", mock_context)

    assert decomposition.should_decompose is False
    assert "too short" in decomposition.reasoning.lower()


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_subquery_count_truncated_to_max(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    patched_config.router_decomposition_max_subqueries = 2

    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.8],
            reasoning="Multi-part",
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[
                {"query": "q1", "reasoning": "r1", "dependencies": []},
                {"query": "q2", "reasoning": "r2", "dependencies": []},
                {"query": "q3", "reasoning": "r3", "dependencies": []},
                {"query": "q4", "reasoning": "r4", "dependencies": []},
            ],
            reasoning="multi-step",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    _, decomposition = await ucd.analyze(
        "Compare revenue and headcount across the past four distinct fiscal years please",
        mock_context,
    )

    assert decomposition.should_decompose is True
    assert len(decomposition.sub_queries) == 2


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_empty_llm_content_falls_back(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """When the LLM returns empty content twice, default to internal_kb without crashing."""
    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model
    mock_prompt_from_template.return_value = mock_prompt

    blank_msg = MagicMock()
    blank_msg.content = ""
    blank_msg.response_metadata = {"token_usage": {"completion_tokens": 0}}
    mock_prompt_model.ainvoke = AsyncMock(return_value=blank_msg)

    mock_create.return_value = MagicMock()
    mock_parser_instance = MagicMock()
    mock_parser_instance.get_format_instructions.return_value = "mock-format"
    mock_parser_factory.return_value = mock_parser_instance

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze(
        "What does the policy in our internal documentation actually say about this topic exactly?",
        mock_context,
    )

    assert classification.intent == QueryIntent.QUESTION
    assert classification.used_llm is True
    assert any(r.source == KnowledgeSource.INTERNAL_KB for r in classification.routes)
    assert decomposition.should_decompose is False
    mock_parser_instance.invoke.assert_not_called()


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_message_language_flows_through_unified_analyze(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
) -> None:
    """The llm language verdict must reach ClassificationResult
    even when the provisional context language disagrees (the proper-noun misdetection this field exists to fix)."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.8],
            reasoning="travel safety question",
            message_language=" EN ",
        ),
        decomposition=LLMDecompositionOutput(should_decompose=False, sub_queries=[], reasoning="single question"),
    )

    # detector-style misfire: toponym pulled the provisional language to spanish
    context = QueryContext(
        hub_id=1,
        message_id=123,
        original_query="Is Nicaragua safe to travel to right now?",
        detected_language="es",
        language_confidence=0.97,
    )

    ucd = UnifiedClassifierDecomposer()
    classification, _ = await ucd.analyze(context.original_query, context)

    assert classification.intent == QueryIntent.QUESTION
    assert classification.message_language == "en"


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_invalid_message_language_is_dropped_by_unified_analyze(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.8],
            message_language="Latin script, probably Romanized Hindi",
        ),
        decomposition=LLMDecompositionOutput(should_decompose=False, sub_queries=[], reasoning="single question"),
    )

    ucd = UnifiedClassifierDecomposer()
    classification, _ = await ucd.analyze("kya aap mujhe mausam ke baare mein bata sakte hain", mock_context)

    assert classification.message_language is None


def test_sparse_classification_payload_validates_with_empty_routing() -> None:
    """Regression: the LLM may omit "not applicable" classification fields for synthesis/metaquestion intents.
    Every field must have a default so a sparse payload never raises a ValidationError (Sentry SUWALI prod, Aug 2026)."""
    payload = {
        "classification": {"message_language": "en"},
        "decomposition": {
            "should_decompose": False,
            "sub_queries": [],
            "reasoning": "Not applicable for synthesis intent",
        },
    }

    result = LLMUnifiedClassificationDecompositionOutput.model_validate(payload)

    assert result.classification.sources == []
    assert result.classification.confidences == []
    assert result.classification.message_language == "en"


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_sparse_llm_completion_parses_end_to_end_with_real_parser(
    mock_prompt_from_template: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """Same regression through the full analyze path with the real PydanticOutputParser
    (the other pipeline tests mock the parser, so they never exercise validation).
    The sparse completion must degrade to the internal_kb routing fallback, not the exception fallback."""
    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model
    mock_prompt_from_template.return_value = mock_prompt
    mock_create.return_value = MagicMock()

    sparse_completion = (
        '{"classification": {"message_language": "en"}, '
        '"decomposition": {"should_decompose": false, "sub_queries": [], '
        '"reasoning": "Not applicable for synthesis intent"}}'
    )
    mock_prompt_model.ainvoke = AsyncMock(return_value=AIMessage(content=sparse_completion))

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze("latest news", mock_context)

    assert classification.intent == QueryIntent.QUESTION
    assert classification.used_llm is True
    assert "error" not in (classification.reasoning or "").lower()
    # the empty-sources fallback route from build_result_from_llm, not the 0.5 exception fallback
    assert [(r.source, r.confidence) for r in classification.routes] == [(KnowledgeSource.INTERNAL_KB, 0.3)]
    assert classification.message_language == "en"
    assert decomposition.should_decompose is False


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_synthesis_completion_without_routing_fields_keeps_synthesis_intent(
    mock_prompt_from_template: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """A completion that sets is_synthesis but omits sources/confidences must still
    classify as SYNTHESIS with the internal_kb fallback route, not crash or degrade to QUESTION."""
    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model
    mock_prompt_from_template.return_value = mock_prompt
    mock_create.return_value = MagicMock()

    completion = (
        '{"classification": {"message_language": "en", "is_synthesis": true, '
        '"synthesis_type": "temporal", "synthesis_time_window_days": 7, "temporal_type": "recency"}, '
        '"decomposition": {"should_decompose": false, "sub_queries": [], '
        '"reasoning": "Not applicable for synthesis intent"}}'
    )
    mock_prompt_model.ainvoke = AsyncMock(return_value=AIMessage(content=completion))

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze("latest news", mock_context)

    assert classification.intent == QueryIntent.SYNTHESIS
    assert classification.synthesis is not None
    assert classification.synthesis.type == SynthesisType.TEMPORAL
    assert classification.synthesis.time_window_days == 7
    assert [(r.source, r.confidence) for r in classification.routes] == [(KnowledgeSource.INTERNAL_KB, 0.3)]
    assert decomposition.should_decompose is False


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_duplicate_classification_key_recovers_full_classification(
    mock_prompt_from_template: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """Regression: the model emitted the full classification, then re-emitted
    "classification" holding only message_language; last-wins JSON parsing clobbered the
    full object down to the sparse one, dropping the synthesis verdict (SUWALI prod, Aug 2026).
    The duplicate-key repair must recover the first, complete classification."""
    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model
    mock_prompt_from_template.return_value = mock_prompt
    mock_create.return_value = MagicMock()

    completion = (
        '{"classification": {"is_question": true, "is_speak_to_person": false, '
        '"is_purchase_subscribe": false, "is_role_description": false, "is_metaquestion": false, '
        '"is_synthesis": true, "synthesis_type": "temporal", "synthesis_time_window_days": 7, '
        '"sources": [], "confidences": [], "temporal_type": "recency", "reasoning": "weekly digest"}, '
        '"decomposition": {"should_decompose": false, "sub_queries": [], '
        '"reasoning": "Not applicable for synthesis intent"}, '
        '"classification": {"message_language": "en"}}'
    )
    mock_prompt_model.ainvoke = AsyncMock(return_value=AIMessage(content=completion))

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze("important political news from last week", mock_context)

    assert classification.intent == QueryIntent.SYNTHESIS
    assert classification.synthesis is not None
    assert classification.synthesis.type == SynthesisType.TEMPORAL
    assert classification.synthesis.time_window_days == 7
    assert classification.message_language == "en"
    assert decomposition.should_decompose is False
    # a recovered classification is not degenerate, so no retry
    assert mock_prompt_model.ainvoke.await_count == 1


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_degenerate_completion_retries_once_then_degrades(
    mock_prompt_from_template: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """A completion whose classification carries no intent/routing field at all is a failed
    answer, not a verdict: retry once, then degrade to the internal_kb fallback route."""
    mock_prompt = MagicMock()
    mock_prompt_model = MagicMock()
    mock_prompt.__or__.return_value = mock_prompt_model
    mock_prompt_from_template.return_value = mock_prompt
    mock_create.return_value = MagicMock()

    degenerate_completion = (
        '{"classification": {"message_language": "en"}, '
        '"decomposition": {"should_decompose": false, "sub_queries": [], "reasoning": "n/a"}}'
    )
    good_completion = (
        '{"classification": {"is_question": true, "sources": ["internal_kb"], "confidences": [0.8], '
        '"message_language": "en", "reasoning": "factual question"}, '
        '"decomposition": {"should_decompose": false, "sub_queries": [], "reasoning": "single question"}}'
    )
    mock_prompt_model.ainvoke = AsyncMock(
        side_effect=[AIMessage(content=degenerate_completion), AIMessage(content=good_completion)]
    )

    ucd = UnifiedClassifierDecomposer()
    classification, _ = await ucd.analyze("latest news", mock_context)

    assert mock_prompt_model.ainvoke.await_count == 2
    assert classification.intent == QueryIntent.QUESTION
    assert [(r.source, r.confidence) for r in classification.routes] == [(KnowledgeSource.INTERNAL_KB, 0.8)]


async def test_unified_fallback_after_llm_error_has_no_language(
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """A failed unified call must not fabricate a language verdict for the override."""
    with patch("app.services.router.classifier_decomposer.create_chat_model", side_effect=RuntimeError("llm down")):
        ucd = UnifiedClassifierDecomposer()
        classification, decomposition = await ucd.analyze("Is Nicaragua safe to travel to?", mock_context)

    assert classification.intent == QueryIntent.QUESTION
    assert classification.message_language is None
    assert decomposition.should_decompose is False


def test_unified_prompt_asks_for_the_location_verdict() -> None:
    assert USER_LOCATION_DEPENDENCE in UnifiedClassifierDecomposer.UNIFIED_PROMPT


def test_unified_prompt_asks_for_the_location_only_verdict() -> None:
    assert LOCATION_ONLY_REPLY in UnifiedClassifierDecomposer.UNIFIED_PROMPT


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_needs_user_location_flows_through_unified_analyze(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )
    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.9],
            reasoning="Local elections depend on where the user is",
            needs_user_location=True,
        ),
        decomposition=LLMDecompositionOutput(should_decompose=False, sub_queries=[], reasoning="Single lookup"),
    )

    classification, _ = await UnifiedClassifierDecomposer().analyze("When are the local elections?", mock_context)

    assert classification.intent == QueryIntent.QUESTION
    assert classification.needs_user_location is True


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_heuristic_question_goes_to_the_llm_while_no_location_note_exists(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """The structured-fact heuristic would answer this without a location verdict; the gate needs one."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )
    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=["internal_kb"],
            confidences=[0.9],
            reasoning="Depends on the user's city",
            needs_user_location=True,
        ),
        decomposition=LLMDecompositionOutput(should_decompose=False, sub_queries=[], reasoning="Single lookup"),
    )
    mock_context.location_gate_enabled = True
    mock_context.conversation_context = []

    classification, _ = await UnifiedClassifierDecomposer().analyze(
        "Who founded the fridge program in my city?", mock_context
    )

    mock_create.assert_called_once()
    assert classification.needs_user_location is True


@pytest.mark.parametrize(
    ("location_gate_enabled", "notes"),
    [(True, [ContextNote(id="n1", text="Lives in Zagreb")]), (False, []), (None, [])],
)
async def test_heuristic_question_short_circuits_once_the_gate_has_nothing_to_refuse(
    patched_config: MagicMock,
    mock_context: QueryContext,
    location_gate_enabled: bool | None,
    notes: list[ContextNote],
) -> None:
    mock_context.location_gate_enabled = location_gate_enabled
    mock_context.conversation_context = notes
    with patch("app.services.router.classifier_decomposer.create_chat_model") as mock_create:
        classification, decomposition = await UnifiedClassifierDecomposer().analyze("Who founded Tesla?", mock_context)

    mock_create.assert_not_called()
    assert classification.intent == QueryIntent.QUESTION
    assert decomposition.should_decompose is False


@patch("app.services.router.classifier_decomposer.create_chat_model")
@patch("app.services.router.classifier_decomposer.PydanticOutputParser")
@patch("app.services.router.classifier_decomposer.PromptTemplate.from_template")
async def test_vote_recommendation_forces_no_decomposition(
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    patched_config: MagicMock,
    mock_context: QueryContext,
) -> None:
    """A refused political-choice request is never split into sub-queries that would be answered."""
    _, _, _, mock_parser_instance = _configure_pipeline_mocks(
        prompt_template_patch=mock_prompt_from_template,
        create_chat_model_patch=mock_create,
        parser_patch=mock_parser_factory,
    )

    mock_parser_instance.invoke.return_value = LLMUnifiedClassificationDecompositionOutput(
        classification=LLMClassificationOutput(
            is_question=True,
            sources=[],
            confidences=[],
            reasoning="Asks which party to vote for",
            is_vote_recommendation=True,
            is_synthesis=False,
        ),
        decomposition=LLMDecompositionOutput(
            should_decompose=True,
            sub_queries=[{"query": "x", "reasoning": "y", "dependencies": []}],
            reasoning="should be ignored by the intent guard",
        ),
    )

    ucd = UnifiedClassifierDecomposer()
    classification, decomposition = await ucd.analyze(
        "I'm a farmer, which party should I vote for and what do they promise?",
        mock_context,
    )

    assert classification.intent == QueryIntent.VOTE_RECOMMENDATION
    assert decomposition.should_decompose is False
    assert decomposition.sub_queries == []
