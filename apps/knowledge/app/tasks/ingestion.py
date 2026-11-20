import sys
import time

from loguru import logger

from app.core.constants import DEFAULT_PRIORITY_TIER
from app.core.ingestion_validation import IngestionValidationError
from app.core.logging import publish_metric
from app.services.callback_service import enqueue_callback
from app.services.ingestor import Ingestor
from app.services.redis_client import get_redis_client


async def process_document(
    hub_id: int,
    document_id: str,
    file_url: str,
    text: str,
    original_url: str = "",
    title: str = "",
    published_at: str = "",
    callback_url: str = "",
    priority_tier: int = DEFAULT_PRIORITY_TIER,
    existing_topics: list[str] | None = None,
    text_is_markdown: bool = False,
    document_type: str = "",
    summary: str = "",
) -> None:
    redis = get_redis_client()
    lock_key = f"ingestion-lock:{document_id}"
    lock = redis.lock(lock_key, timeout=5 * 60, blocking=False)  # 5 minutes lock
    if not lock.acquire(blocking=False):
        raise RuntimeError(f"Ingestion lock held for document {document_id}, will retry later")

    success = False
    topics: list[str] = []
    validation_error_code: str | None = None
    try:
        start_time = time.perf_counter()
        logger.info(
            f"Ingestion started for path: {file_url}, hub: {hub_id}, id: {document_id}, title: {title}, text: {text[:50]}..."
        )  # noqa
        try:
            ingestor = Ingestor(
                hub_id,
                document_id,
                file_url,
                text,
                original_url,
                title,
                published_at,
                priority_tier,
                existing_topics,
                text_is_markdown,
                document_type,
                summary=summary,
            )
            await ingestor.run()
            topics = ingestor.topics
            success = True
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"Ingestion finished in {duration_ms} milliseconds")
            publish_metric("document.ingested", duration_ms, unit="Milliseconds", hub_id=hub_id)
        except IngestionValidationError as e:
            # Deterministic failure - retrying will not produce a different result, so finish the ingestion and log the error
            success = False
            validation_error_code = e.code.value
            logger.warning(f"Ingestion validation failed for document {document_id}: {e.code.value} - {e}")
        except Exception as e:
            success = False
            logger.opt(exception=sys.exc_info()).error(f"Ingestion failed: {e}")
            raise
        finally:
            body: dict[str, object] = {"success": success, "topics": topics}
            if validation_error_code is not None:
                body["error_code"] = validation_error_code
            enqueue_callback(callback_url, body)
    finally:
        try:
            lock.release()
        except Exception as lock_err:
            # lock may already have expired
            logger.debug(f"Failed to release ingestion lock: {lock_err}")
