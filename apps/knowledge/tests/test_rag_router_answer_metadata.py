from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.chat import ChatRequest, ErrorType, Metadata
from app.models.temporal import TemporalContext, TemporalType
from app.services.router.models import (
    ClassificationResult,
    HandlerResult,
    KnowledgeSource,
    QueryIntent,
    RouteDecision,
)


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


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_router_surfaces_answer_model_from_internal_kb(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_to_thread.side_effect = _to_thread_side_effect

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier.classify = AsyncMock(
        return_value=ClassificationResult(
            intent=QueryIntent.QUESTION,
            routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
            used_llm=True,
            temporal=TemporalContext(type=TemporalType.NONE),
        )
    )
    mock_classifier_cls.return_value = mock_classifier

    router = RAGRouter(hub_id=3)
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True
    router.internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=True,
            answer="News reports describe an active conflict.",
            confidence=0.8,
            metadata={
                "documents_count": 2,
                "document_ids_used": ["doc-1"],
                "answer_model": "gpt-test",
                "llm_fallback_used": False,
            },
        )
    )

    response = await router.route(ChatRequest(hub_id=3, message_id=0, message="What is the state of war in Iran?"))

    assert response.error_type is None
    assert response.answer == "News reports describe an active conflict."
    assert response.metadata is not None
    assert response.metadata.answer_model == "gpt-test"
    assert response.metadata.llm_fallback_used is False
    assert response.metadata.router_intent == "question"
    assert response.metadata.temporal_type == "none"
    assert response.metadata.synthesis_type is None
    assert response.metadata.question_type == "question"


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_router_surfaces_bedrock_fallback_from_internal_kb(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_to_thread.side_effect = _to_thread_side_effect

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier.classify = AsyncMock(
        return_value=ClassificationResult(
            intent=QueryIntent.QUESTION,
            routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
            used_llm=True,
            temporal=TemporalContext(type=TemporalType.NONE),
        )
    )
    mock_classifier_cls.return_value = mock_classifier

    router = RAGRouter(hub_id=3)
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True
    router.internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=True,
            answer="Conflict continues.",
            confidence=0.8,
            metadata={
                "answer_model": "bedrock-test",
                "llm_fallback_used": True,
            },
        )
    )

    response = await router.route(ChatRequest(hub_id=3, message_id=1, message="What is happening?"))

    assert response.error_type is None
    assert response.metadata is not None
    assert response.metadata.answer_model == "bedrock-test"
    assert response.metadata.llm_fallback_used is True


def test_fallback_metadata_keeps_answerable_and_strips_evidence() -> None:
    # answerable means "genuine question for the knowledge base", not "we produced an answer"
    # the cms maps answerable=true + error_type to answered=false, which feeds the unanswered questions ranking
    from app.services.router.rag_router import _fallback_metadata

    metadata = Metadata(
        answerable=True,
        documents_count=3,
        document_ids_used=["doc-1", "doc-2"],
        document_ids_cited=["doc-1"],
        retrieved_chunks=["chunk"],
        entities=["entity"],
        language="en",
    )

    fallback = _fallback_metadata(metadata)

    assert fallback.answerable is True
    assert fallback.documents_count is None
    assert fallback.document_ids_used is None
    assert fallback.document_ids_cited is None
    assert fallback.retrieved_chunks is None
    assert fallback.entities is None
    assert fallback.language == "en"


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_router_no_answer_response_is_answerable(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_errors.get_error_message.return_value = "I could not find an answer."
    mock_to_thread.side_effect = _to_thread_side_effect

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier.classify = AsyncMock(
        return_value=ClassificationResult(
            intent=QueryIntent.QUESTION,
            routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
            used_llm=True,
            temporal=TemporalContext(type=TemporalType.NONE),
        )
    )
    mock_classifier_cls.return_value = mock_classifier

    router = RAGRouter(hub_id=3)
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True
    router.internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=False,
            answer=None,
            confidence=0.0,
            metadata={
                "documents_count": 2,
                "document_ids_used": ["doc-1"],
                "retrieved_chunks": ["chunk"],
            },
            error=str(ErrorType.NO_ANSWER_AVAILABLE),
            error_type=ErrorType.NO_ANSWER_AVAILABLE,
        )
    )

    response = await router.route(ChatRequest(hub_id=3, message_id=2, message="What is the capital of Atlantis?"))

    assert response.error_type == ErrorType.NO_ANSWER_AVAILABLE
    assert response.answer == "I could not find an answer."
    assert response.metadata is not None
    assert response.metadata.answerable is True
    assert response.metadata.documents_count is None
    assert response.metadata.document_ids_used is None
    assert response.metadata.retrieved_chunks is None


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_router_infrastructure_failure_keeps_error_type_and_is_not_answerable(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    """An outage must not be reported as a question the corpus could not answer.

    answerable stays unset so the cms records answered as null instead of counting the message in the unanswered ranking.
    """
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_errors.get_error_message.return_value = "I could not find an answer."
    mock_to_thread.side_effect = _to_thread_side_effect

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier.classify = AsyncMock(
        return_value=ClassificationResult(
            intent=QueryIntent.QUESTION,
            routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
            used_llm=True,
            temporal=TemporalContext(type=TemporalType.NONE),
        )
    )
    mock_classifier_cls.return_value = mock_classifier

    router = RAGRouter(hub_id=3)
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True
    router.internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=False,
            answer=None,
            confidence=0.0,
            metadata={"documents_count": 2, "document_ids_used": ["doc-1"], "retrieved_chunks": ["chunk"]},
            error=str(ErrorType.SEARCH_ERROR),
            error_type=ErrorType.SEARCH_ERROR,
            error_message="Something went wrong on our side.",
        )
    )

    response = await router.route(ChatRequest(hub_id=3, message_id=2, message="What is the capital of Atlantis?"))

    assert response.error_type == ErrorType.SEARCH_ERROR
    # the retriever already localized this, so the router must not regenerate a no-answer message over it
    assert response.answer == "Something went wrong on our side."
    assert response.metadata is not None
    assert response.metadata.answerable is None
    assert response.metadata.documents_count is None
    assert response.metadata.document_ids_used is None
    assert response.metadata.retrieved_chunks is None


@patch("app.services.router.rag_router.asyncio.to_thread")
@patch("app.services.router.rag_router.resources_for_scenario", return_value=None)
@patch("app.services.router.rag_router.language")
@patch("app.services.router.rag_router.errors")
@patch("app.services.router.rag_router.QueryClassifier")
@patch("app.services.router.rag_router.Config")
@patch("app.services.router.rag_router.LLMConfig")
@pytest.mark.asyncio
async def test_router_handler_crash_without_error_type_is_internal_error(
    mock_llm_config: MagicMock,
    mock_config: MagicMock,
    mock_classifier_cls: MagicMock,
    mock_errors: MagicMock,
    mock_language: MagicMock,
    mock_resources: MagicMock,
    mock_to_thread: MagicMock,
) -> None:
    """A handler that raised carries an error but no error_type, and must still not read as a content gap.

    this is the shape KnowledgeHandler.retrieve builds when an exception escapes the handler.
    """
    from app.services.router.rag_router import RAGRouter

    mock_config.return_value = _mock_config()
    mock_language.detect = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_message = AsyncMock(return_value=("en", 0.99))
    mock_language.detect_from_history = AsyncMock(return_value=(None, 0.0))
    mock_language.detect_text = AsyncMock(return_value=("en", 0.99))
    mock_errors.validate_chat_message.return_value = None
    mock_errors.get_error_message.return_value = "Something went wrong on our side."
    mock_to_thread.side_effect = _to_thread_side_effect

    mock_classifier = MagicMock()
    mock_classifier.is_non_question.return_value = False
    mock_classifier.detect_scenario_intent.return_value = None
    mock_classifier.classify = AsyncMock(
        return_value=ClassificationResult(
            intent=QueryIntent.QUESTION,
            routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.9, priority=0)],
            used_llm=True,
            temporal=TemporalContext(type=TemporalType.NONE),
        )
    )
    mock_classifier_cls.return_value = mock_classifier

    router = RAGRouter(hub_id=3)
    router.internal_handler = MagicMock()
    router.internal_handler.is_enabled.return_value = True
    router.internal_handler.retrieve = AsyncMock(
        return_value=HandlerResult(
            source=KnowledgeSource.INTERNAL_KB,
            success=False,
            answer=None,
            error="Unable to connect to neo4j:7687",
        )
    )

    response = await router.route(ChatRequest(hub_id=3, message_id=2, message="What is the capital of Atlantis?"))

    assert response.error_type == ErrorType.INTERNAL_ERROR
    assert response.metadata is not None
    assert response.metadata.answerable is None
