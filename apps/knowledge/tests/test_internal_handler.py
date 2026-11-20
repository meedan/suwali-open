from unittest.mock import MagicMock, patch

from app.models.chat import ChatResponse, ErrorType, Metadata
from app.services.router.internal_handler import InternalKBHandler
from app.services.router.models import KnowledgeSource, QueryContext


@patch("app.services.router.internal_handler.Retriever")
@patch("app.services.router.internal_handler.Config")
def test_internal_handler_forwards_answer_model_metadata(
    mock_config: MagicMock,
    mock_retriever_cls: MagicMock,
) -> None:
    mock_config.return_value.router_enable_internal_kb = True
    mock_retriever_cls.return_value.run.return_value = ChatResponse(
        answer="Iran remains in a tense conflict.",
        metadata=Metadata(
            documents_count=2,
            document_ids_used=["doc-1"],
            answer_model="gpt-test",
            llm_fallback_used=False,
        ),
    )

    result = InternalKBHandler()._retrieve(
        "What is the state of war in Iran?",
        QueryContext(
            hub_id=3,
            message_id=0,
            original_query="What is the state of war in Iran?",
            detected_language="en",
        ),
    )

    assert result.source == KnowledgeSource.INTERNAL_KB
    assert result.success is True
    assert result.metadata["answer_model"] == "gpt-test"
    assert result.metadata["llm_fallback_used"] is False


@patch("app.services.router.internal_handler.Retriever")
@patch("app.services.router.internal_handler.Config")
def test_internal_handler_forwards_bedrock_fallback_metadata(
    mock_config: MagicMock,
    mock_retriever_cls: MagicMock,
) -> None:
    mock_config.return_value.router_enable_internal_kb = True
    mock_retriever_cls.return_value.run.return_value = ChatResponse(
        answer="Conflict continues.",
        metadata=Metadata(
            answer_model="bedrock-test",
            llm_fallback_used=True,
        ),
    )

    result = InternalKBHandler()._retrieve(
        "What is happening?",
        QueryContext(hub_id=3, message_id=1, original_query="What is happening?", detected_language="en"),
    )

    assert result.success is True
    assert result.metadata["answer_model"] == "bedrock-test"
    assert result.metadata["llm_fallback_used"] is True


@patch("app.services.router.internal_handler.Retriever")
@patch("app.services.router.internal_handler.Config")
def test_internal_handler_forwards_retriever_error_type_and_message(
    mock_config: MagicMock,
    mock_retriever_cls: MagicMock,
) -> None:
    """The router tells an outage from an empty corpus by these two fields, so the handler must carry both."""
    mock_config.return_value.router_enable_internal_kb = True
    mock_retriever_cls.return_value.run.return_value = ChatResponse(
        error_type=ErrorType.SEARCH_ERROR,
        answer="We are having trouble reaching our sources right now.",
        metadata=Metadata(retriever_detected_lang="en", language="en"),
    )

    result = InternalKBHandler()._retrieve(
        "What is happening?",
        QueryContext(hub_id=3, message_id=2, original_query="What is happening?", detected_language="en"),
    )

    assert result.success is False
    # answer stays empty so the router cannot mistake an error message for a real answer
    assert result.answer is None
    assert result.error_type == ErrorType.SEARCH_ERROR
    assert result.error_message == "We are having trouble reaching our sources right now."


@patch("app.services.router.internal_handler.Retriever")
@patch("app.services.router.internal_handler.Config")
def test_internal_handler_crash_has_error_without_error_type(
    mock_config: MagicMock,
    mock_retriever_cls: MagicMock,
) -> None:
    """A crash never reaches the retriever's own error handling, so error_type is absent and the router assumes INTERNAL_ERROR."""
    mock_config.return_value.router_enable_internal_kb = True
    mock_retriever_cls.return_value.run.side_effect = RuntimeError("Unable to connect to neo4j:7687")

    result = InternalKBHandler()._retrieve(
        "What is happening?",
        QueryContext(hub_id=3, message_id=3, original_query="What is happening?", detected_language="en"),
    )

    assert result.success is False
    assert result.error_type is None
    assert result.error == "Unable to connect to neo4j:7687"
