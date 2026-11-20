from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.ingestion_validation import IngestionValidationError, ValidationCode
from app.tasks.ingestion import process_document


def _mock_redis_with_acquirable_lock() -> MagicMock:
    mock_redis = MagicMock()
    mock_lock = MagicMock()
    mock_lock.acquire.return_value = True
    mock_redis.lock.return_value = mock_lock
    return mock_redis


@pytest.mark.asyncio
@patch("app.tasks.ingestion.enqueue_callback")
@patch("app.tasks.ingestion.Ingestor")
@patch("app.tasks.ingestion.get_redis_client")
async def test_process_document_does_not_raise_on_validation_error(
    mock_get_redis: MagicMock,
    mock_ingestor_class: MagicMock,
    mock_enqueue_callback: MagicMock,
) -> None:
    mock_get_redis.return_value = _mock_redis_with_acquirable_lock()
    mock_ingestor_class.return_value.run = AsyncMock(
        side_effect=IngestionValidationError(ValidationCode.NO_TEXT_FOUND, "no extractable text")
    )

    # should not raise, so RQ won't schedule a retry for this deterministic failure
    await process_document(1, "doc1", "https://example.com/scanned.pdf", "", callback_url="http://cb")

    mock_enqueue_callback.assert_called_once_with(
        "http://cb", {"success": False, "topics": [], "error_code": "NO_TEXT_FOUND"}
    )


@pytest.mark.asyncio
@patch("app.tasks.ingestion.enqueue_callback")
@patch("app.tasks.ingestion.Ingestor")
@patch("app.tasks.ingestion.get_redis_client")
async def test_process_document_reraises_other_errors(
    mock_get_redis: MagicMock,
    mock_ingestor_class: MagicMock,
    mock_enqueue_callback: MagicMock,
) -> None:
    mock_get_redis.return_value = _mock_redis_with_acquirable_lock()
    mock_ingestor_class.return_value.run = AsyncMock(side_effect=RuntimeError("boom"))

    with pytest.raises(RuntimeError, match="boom"):
        await process_document(1, "doc1", "https://example.com/file.pdf", "", callback_url="http://cb")

    mock_enqueue_callback.assert_called_once_with("http://cb", {"success": False, "topics": []})


@pytest.mark.asyncio
@patch("app.tasks.ingestion.enqueue_callback")
@patch("app.tasks.ingestion.Ingestor")
@patch("app.tasks.ingestion.get_redis_client")
async def test_process_document_forwards_text_is_markdown(
    mock_get_redis: MagicMock,
    mock_ingestor_class: MagicMock,
    mock_enqueue_callback: MagicMock,
) -> None:
    mock_get_redis.return_value = _mock_redis_with_acquirable_lock()
    mock_ingestor_class.return_value.run = AsyncMock()
    mock_ingestor_class.return_value.topics = []

    await process_document(1, "doc1", "", "# Heading\n\nSome markdown", callback_url="http://cb", text_is_markdown=True)

    assert mock_ingestor_class.call_args[0][-2] is True


@pytest.mark.asyncio
@patch("app.tasks.ingestion.enqueue_callback")
@patch("app.tasks.ingestion.Ingestor")
@patch("app.tasks.ingestion.get_redis_client")
async def test_process_document_forwards_document_type(
    mock_get_redis: MagicMock,
    mock_ingestor_class: MagicMock,
    mock_enqueue_callback: MagicMock,
) -> None:
    mock_get_redis.return_value = _mock_redis_with_acquirable_lock()
    mock_ingestor_class.return_value.run = AsyncMock()
    mock_ingestor_class.return_value.topics = []

    await process_document(1, "doc1", "", "editorial content", callback_url="http://cb", document_type="contribution")

    assert mock_ingestor_class.call_args[0][-1] == "contribution"


@pytest.mark.asyncio
@patch("app.tasks.ingestion.enqueue_callback")
@patch("app.tasks.ingestion.Ingestor")
@patch("app.tasks.ingestion.get_redis_client")
async def test_process_document_forwards_summary(
    mock_get_redis: MagicMock,
    mock_ingestor_class: MagicMock,
    mock_enqueue_callback: MagicMock,
) -> None:
    mock_get_redis.return_value = _mock_redis_with_acquirable_lock()
    mock_ingestor_class.return_value.run = AsyncMock()
    mock_ingestor_class.return_value.topics = []

    await process_document(1, "doc1", "https://example.com/file.pdf", "", callback_url="http://cb", summary="Context")

    assert mock_ingestor_class.call_args.kwargs["summary"] == "Context"
