from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.constants import (
    ANSWER_TARGET_MAX_CHARS,
    CITED_SOURCES_CLOSE,
    CITED_SOURCES_OPEN,
    SOURCE_DOCUMENT_TAG,
)
from app.models.chat import ChatRequest, ErrorType
from app.services.router.models import (
    ClassificationResult,
    KnowledgeSource,
    QueryIntent,
    RouteDecision,
    SynthesisContext,
    SynthesisType,
    TemporalContext,
    TemporalType,
)


@pytest.fixture
def chat_request() -> ChatRequest:
    return ChatRequest(
        hub_id=1,
        message_id=1,
        message="What happened this week?",
    )


@pytest.fixture
def synthesis_classification() -> ClassificationResult:
    return ClassificationResult(
        intent=QueryIntent.SYNTHESIS,
        routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
        used_llm=True,
        reasoning="User wants a weekly digest",
        temporal=TemporalContext(type=TemporalType.RECENCY, confidence=0.8),
        synthesis=SynthesisContext(time_window_days=7),
    )


@pytest.fixture
def topical_chat_request() -> ChatRequest:
    return ChatRequest(
        hub_id=1,
        message_id=1,
        message="Tell me all you know about Iran.",
    )


@pytest.fixture
def topical_classification() -> ClassificationResult:
    return ClassificationResult(
        intent=QueryIntent.SYNTHESIS,
        routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
        used_llm=True,
        reasoning="User wants a topical overview of Iran",
        temporal=TemporalContext(type=TemporalType.NONE),
        synthesis=SynthesisContext(type=SynthesisType.TOPICAL, topic="Iran"),
    )


class TestHandleSynthesis:
    """Test the synthesis/digest pipeline in RAGRouter."""

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_happy_path(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        chat_request: ChatRequest,
        synthesis_classification: ClassificationResult,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        # Mock Retriever
        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = [
            "Ice storm hit Mississippi on Monday.",
            "Power outages affected 50,000 homes.",
            "Recovery efforts underway in Jackson.",
        ]
        mock_retriever_cls.return_value = mock_retriever

        # Mock Summarizer
        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = "Mississippi experienced a major ice storm this week affecting 50,000 homes. Recovery efforts are underway in Jackson."
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        router = RAGRouter(hub_id=1)
        response = await router.route(chat_request)

        assert response.error_type is None
        assert "ice storm" in response.answer.lower() or "mississippi" in response.answer.lower()
        mock_retriever.retrieve_for_synthesis.assert_called_once()
        mock_retriever.retrieve_for_topical_summary.assert_not_called()
        mock_summarizer_cls.assert_called_once_with(
            [
                "Ice storm hit Mississippi on Monday.",
                "Power outages affected 50,000 homes.",
                "Recovery efforts underway in Jackson.",
            ],
            request_sources=True,
            target_max_chars=ANSWER_TARGET_MAX_CHARS,
            topical=False,
            language="en",
            request="What happened this week?",
        )

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_summarizer_falls_back_to_hub_default_language(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        synthesis_classification: ClassificationResult,
    ) -> None:
        """When detection can't identify the message language, the summarizer must use the hub default, not the chunk language."""
        from app.models.chat import PersonalizationSettings
        from app.services.router.rag_router import RAGRouter

        chat_request = ChatRequest(
            hub_id=1,
            message_id=1,
            message="What happened this week?",
            personalization=PersonalizationSettings(
                default_language="pt",
                supported_languages=["pt", "en"],
            ),
        )

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config_instance.topic_extraction_enabled = False
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_message = AsyncMock(return_value=None)
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("pt", 0.99))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = ["Tempestade atingiu o Mississippi na segunda-feira."]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = "O Mississippi enfrentou uma grande tempestade esta semana."
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        router = RAGRouter(hub_id=1)
        response = await router.route(chat_request)

        assert response.error_type is None
        _, summarizer_kwargs = mock_summarizer_cls.call_args
        assert summarizer_kwargs.get("language") == "pt"

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_emits_status_stream_updates(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        chat_request: ChatRequest,
        synthesis_classification: ClassificationResult,
    ) -> None:
        """The synthesis path reports progress on the status stream like the QA path does."""
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config_instance.topic_extraction_enabled = False
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = ["Ice storm hit Mississippi on Monday."]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = "Mississippi experienced a major ice storm this week."
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        statuses: list[str] = []

        def record_status(status: str, payload: dict[str, Any] | None = None) -> None:
            statuses.append(status)

        router = RAGRouter(hub_id=1, status_callback=record_status)
        response = await router.route(chat_request)

        assert response.error_type is None
        assert "searching_sources" in statuses
        assert "evaluating_results" in statuses

    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_no_chunks_returns_no_answer(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        chat_request: ChatRequest,
        synthesis_classification: ClassificationResult,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None
        mock_errors.get_error_message.return_value = "No answer available."

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        # Retriever returns no chunks
        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = []
        mock_retriever_cls.return_value = mock_retriever

        router = RAGRouter(hub_id=1)
        response = await router.route(chat_request)

        assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_metadata_populated(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        chat_request: ChatRequest,
        synthesis_classification: ClassificationResult,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = ["Chunk 1", "Chunk 2"]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = "Summary of events."
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        router = RAGRouter(hub_id=1)
        response = await router.route(chat_request)

        assert response.metadata is not None
        assert response.metadata.router_intent == "synthesis"
        assert response.metadata.synthesis_type == "temporal"
        assert response.metadata.temporal_type == "recency"
        assert response.metadata.question_type == "synthesis:temporal"
        assert response.metadata.synthesis_time_window_days == 7
        assert response.metadata.synthesis_chunks_used == 2

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_populates_document_ids_cited(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        chat_request: ChatRequest,
        synthesis_classification: ClassificationResult,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = [
            f'<{SOURCE_DOCUMENT_TAG} ref="doc-a.txt">\nIce storm hit Mississippi.\n</{SOURCE_DOCUMENT_TAG}>',
            f'<{SOURCE_DOCUMENT_TAG} ref="doc-b.txt">\nPower outages affected 50,000 homes.\n</{SOURCE_DOCUMENT_TAG}>',
        ]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = (
            f"Mississippi experienced a major ice storm.\n{CITED_SOURCES_OPEN}doc-a.txt, doc-b.txt{CITED_SOURCES_CLOSE}"
        )
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        router = RAGRouter(hub_id=1)
        response = await router.route(chat_request)

        assert response.error_type is None
        assert CITED_SOURCES_OPEN not in response.answer
        assert response.metadata is not None
        assert response.metadata.document_ids_cited == ["doc-a.txt", "doc-b.txt"]

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_rejects_markup_leakage_with_no_answer(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        chat_request: ChatRequest,
        synthesis_classification: ClassificationResult,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None
        mock_errors.get_error_message.return_value = "No answer available."

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = ["Chunk 1", "Chunk 2"]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = "The page includes <div class='menu'> and CSS stylesheet rules."
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = False
        mock_answer_judge_cls.return_value = mock_answer_judge

        router = RAGRouter(hub_id=1)
        response = await router.route(chat_request)

        assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_allows_markup_when_context_is_about_markup(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        synthesis_classification: ClassificationResult,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        chat_request = ChatRequest(
            hub_id=1,
            message_id=1,
            message="Summarize this HTML and CSS tutorial.",
        )

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = [
            "This tutorial explains HTML tags, semantic structure, and CSS selectors.",
            "It covers stylesheet organization and responsive layout techniques.",
        ]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = (
            "The tutorial introduces core HTML structure and CSS selectors, then explains responsive styling."
        )
        mock_summarizer_cls.return_value = mock_summarizer

        # judge: ok to mention html/css (tutorial context)
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        router = RAGRouter(hub_id=1)
        response = await router.route(chat_request)

        assert response.error_type is None
        assert response.answer is not None
        assert "html" in response.answer.lower()
        assert "css" in response.answer.lower()
        mock_answer_judge.evaluate.assert_called_once()

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_topical_summary_routes_through_topical_retriever(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
        topical_chat_request: ChatRequest,
        topical_classification: ClassificationResult,
    ) -> None:
        """A topical summary retrieves on the rewritten message, not the bare topic, and scopes the Summarizer to it."""
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=topical_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_topical_summary.return_value = [
            "Iran is a country in Western Asia.",
            "Its capital is Tehran.",
            "It has a long history dating back to ancient Persia.",
        ]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = (
            "Iran is a country in Western Asia with Tehran as its capital and a history rooted in ancient Persia."
        )
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        router = RAGRouter(hub_id=1)
        response = await router.route(topical_chat_request)

        assert response.error_type is None
        assert "iran" in response.answer.lower()

        mock_retriever.retrieve_for_topical_summary.assert_called_once()
        topic_arg = mock_retriever.retrieve_for_topical_summary.call_args[0][0]
        assert topic_arg == topical_chat_request.message
        mock_retriever.retrieve_for_synthesis.assert_not_called()

        mock_summarizer_cls.assert_called_once()
        _, summarizer_kwargs = mock_summarizer_cls.call_args
        assert summarizer_kwargs.get("topical") is True
        assert summarizer_kwargs.get("request") == topical_chat_request.message

        assert response.metadata is not None
        assert response.metadata.router_intent == "synthesis"
        assert response.metadata.synthesis_type == "topical"
        assert response.metadata.temporal_type == "none"
        assert response.metadata.question_type == "synthesis:topical"
        assert response.metadata.synthesis_time_window_days is None
        assert response.metadata.synthesis_chunks_used == 3


class TestHandleNonQuestion:
    """Test the lightweight conversational reply for non-questions."""

    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_non_question_returns_conversational_reply(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
        mock_language.reply_language_violation = AsyncMock(return_value=None)

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = True
        mock_classifier_cls.return_value = mock_classifier

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(
            return_value=MagicMock(content="You're welcome! Let me know if you have any questions.")
        )
        mock_create_chat_model.return_value = mock_llm

        chat = ChatRequest(hub_id=1, message_id=1, message="Thank you!")
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert response.error_type is None
        assert response.answer == "You're welcome! Let me know if you have any questions."
        assert response.metadata is not None
        assert response.metadata.router_intent == "non_question"
        mock_classifier.classify.assert_not_called()

    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_non_question_llm_failure_returns_fallback(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("en", 0.99))

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = True
        mock_classifier_cls.return_value = mock_classifier

        mock_create_chat_model.side_effect = RuntimeError("LLM unavailable")

        chat = ChatRequest(hub_id=1, message_id=1, message="Thanks!")
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert response.error_type is None
        assert response.answer == "Hello! How can I help you?"

    @patch("app.services.router.rag_router.create_chat_model")
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_non_question_spanish_reply_does_not_overwrite_detected_language(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_language: MagicMock,
        mock_create_chat_model: MagicMock,
    ) -> None:
        """A short greeting detected as English keeps that language even if
        the LLM reply is Spanish. Answer-side detection must not overwrite."""
        from app.services.router.rag_router import RAGRouter

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.55))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.55))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("es", 0.97))
        mock_language.reply_language_violation = AsyncMock(return_value=None)

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = True
        mock_classifier_cls.return_value = mock_classifier

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(
            return_value=MagicMock(content="¡De nada! Si necesitas más información, estoy a tu disposición.")
        )
        mock_create_chat_model.return_value = mock_llm

        chat = ChatRequest(hub_id=1, message_id=1, message="Gracias")
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert response.error_type is None
        assert response.answer == "¡De nada! Si necesitas más información, estoy a tu disposición."
        assert response.metadata is not None
        assert response.metadata.language == "en"
        assert response.metadata.router_intent == "non_question"


class TestLanguageFillFromAnswer:
    """Question-language is authoritative; answer-side detection only fills gaps."""

    @patch("app.services.router.rag_router.AnswerJudge")
    @patch("app.services.router.rag_router.Summarizer")
    @patch("app.services.router.rag_router.Retriever")
    @patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
    @patch("app.services.router.rag_router.language")
    @patch("app.services.router.rag_router.errors")
    @patch("app.services.router.rag_router.QueryClassifier")
    @patch("app.services.router.rag_router.Config")
    @patch("app.services.router.rag_router.LLMConfig")
    async def test_synthesis_does_not_overwrite_detected_language_from_spanish_answer(
        self,
        mock_llm_config: MagicMock,
        mock_config: MagicMock,
        mock_classifier_cls: MagicMock,
        mock_errors: MagicMock,
        mock_language: MagicMock,
        mock_resources: MagicMock,
        mock_retriever_cls: MagicMock,
        mock_summarizer_cls: MagicMock,
        mock_answer_judge_cls: MagicMock,
    ) -> None:
        """A question detected as English keeps that language even if
        answer-side detection claims Spanish from the synthesized digest."""
        from app.services.router.rag_router import RAGRouter

        synthesis_classification = ClassificationResult(
            intent=QueryIntent.SYNTHESIS,
            routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
            used_llm=True,
            reasoning="User wants a weekly digest",
            temporal=TemporalContext(type=TemporalType.RECENCY, confidence=0.8),
            synthesis=SynthesisContext(time_window_days=7),
        )

        mock_config_instance = MagicMock()
        mock_config_instance.router_enable_internal_kb = False
        mock_config_instance.router_enable_yago = False
        mock_config_instance.router_use_llm_classifier = True
        mock_config_instance.router_parallel_execution = False
        mock_config_instance.router_unified_classifier_decomposer = False
        mock_config_instance.summarizer_max_input_chars = 50000
        mock_config.return_value = mock_config_instance

        mock_language.detect = AsyncMock(return_value=("en", 0.55))
        mock_language.detect_message = AsyncMock(return_value=("en", 0.55))
        mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
        mock_language.detect_text = AsyncMock(return_value=("es", 0.97))
        mock_errors.validate_chat_message.return_value = None

        mock_classifier = MagicMock()
        mock_classifier.is_non_question.return_value = False
        mock_classifier.classify = AsyncMock(return_value=synthesis_classification)
        mock_classifier_cls.return_value = mock_classifier

        mock_retriever = MagicMock()
        mock_retriever.retrieve_for_synthesis.return_value = [
            "Una tormenta de hielo golpeó Mississippi el lunes.",
            "Los cortes de energía afectaron a 50.000 hogares.",
        ]
        mock_retriever_cls.return_value = mock_retriever

        mock_summarizer = MagicMock()
        mock_summarizer.run.return_value = (
            "Mississippi experimentó una gran tormenta de hielo esta semana que afectó a 50.000 hogares."
        )
        mock_summarizer_cls.return_value = mock_summarizer
        mock_answer_judge = MagicMock()
        mock_answer_judge.evaluate.return_value = True
        mock_answer_judge_cls.return_value = mock_answer_judge

        chat = ChatRequest(hub_id=1, message_id=1, message="¿Qué pasó?")
        router = RAGRouter(hub_id=1)
        response = await router.route(chat)

        assert response.error_type is None
        assert response.metadata is not None
        assert response.metadata.language == "en"
        assert response.metadata.retriever_detected_lang == "en"
