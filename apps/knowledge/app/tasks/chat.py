import sys
import time
from datetime import datetime
from typing import Any

from loguru import logger
from rq.job import get_current_job

from app.core.debug_log import DebugLog, debug_log_capture
from app.core.logging import publish_chat_duration_details_metrics, publish_metric
from app.models.chat import ChatRequest, ChatStatus, ContextNote, Message, Metadata, PersonalizationSettings
from app.services.callback_service import enqueue_callback, send_chat_status_sync
from app.services.neo4j_timing import neo4j_timing
from app.services.router import RAGRouter


async def process_chat(
    hub_id: int,
    message_id: int,
    message: str,
    history: list[dict[str, str]] | None = None,
    personalization: dict[str, Any] | None = None,
    callback_url: str = "",
    recency_first_enabled: bool | None = None,
    existing_topics: list[str] | None = None,
    conversation_context: list[dict[str, str]] | None = None,
    location_gate_enabled: bool | None = None,
    debug: bool = False,
) -> None:
    start_time = time.perf_counter()
    with debug_log_capture(debug, start_time) as debug_log:
        await _process_chat(
            hub_id,
            message_id,
            message,
            history,
            personalization,
            callback_url,
            recency_first_enabled,
            existing_topics,
            conversation_context,
            location_gate_enabled,
            start_time,
            debug_log,
        )


async def _process_chat(
    hub_id: int,
    message_id: int,
    message: str,
    history: list[dict[str, str]] | None,
    personalization: dict[str, Any] | None,
    callback_url: str,
    recency_first_enabled: bool | None,
    existing_topics: list[str] | None,
    conversation_context: list[dict[str, str]] | None,
    location_gate_enabled: bool | None,
    start_time: float,
    debug_log: DebugLog | None,
) -> None:
    def notify(status: str, payload: dict[str, Any] | None = None) -> None:
        send_chat_status_sync(callback_url, status, payload=payload)

    try:
        logger.info(f"Chat task started for hub: {hub_id}, message_id: {message_id}")
        _log_queue_wait()

        parsed_history = [Message(**m) for m in history] if history else None
        parsed_personalization = PersonalizationSettings(**personalization) if personalization else None
        # None = context-extraction disabled
        # []   = no context yet, but context-extraction enabled
        parsed_context = (
            [ContextNote(**note) for note in conversation_context] if conversation_context is not None else None
        )

        chat_request = ChatRequest(
            hub_id=hub_id,
            message_id=message_id,
            message=message,
            history=parsed_history,
            personalization=parsed_personalization,
            recency_first_enabled=recency_first_enabled,
            existing_topics=existing_topics or [],
            conversation_context=parsed_context,
            location_gate_enabled=location_gate_enabled,
        )

        rag_router = RAGRouter(hub_id, status_callback=notify)
        with neo4j_timing() as neo4j_recorder:
            response = await rag_router.route(chat_request)

        duration_ms = (time.perf_counter() - start_time) * 1000
        if response.metadata is None:
            response.metadata = Metadata()
        response.metadata.total_duration_ms = duration_ms
        response.metadata.neo4j_duration_details = neo4j_recorder.summary() or None

        logger.info(f"Chat task completed in {duration_ms:.0f}ms for message_id: {message_id}")
        publish_metric("answer.generated", duration_ms, unit="Milliseconds", hub_id=hub_id)
        question_type = response.metadata.question_type
        if question_type:
            publish_metric("answer.generated", duration_ms, unit="Milliseconds", question_type=question_type)
        duration_details = response.metadata.duration_details
        publish_chat_duration_details_metrics(duration_details, hub_id=hub_id, question_type=question_type)

        payload: dict[str, Any] = {
            "answer": response.answer,
            "metadata": response.metadata.model_dump(mode="json"),
            "error_type": response.error_type.value if response.error_type else None,
            "topics": response.topics,
            "context_updates": [update.model_dump() for update in response.context_updates],
        }
        if debug_log is not None:
            payload["log"] = debug_log.lines
        enqueue_callback(callback_url, {"status": ChatStatus.COMPLETE, "payload": payload})
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Chat task failed for message_id {message_id}: {e}")
        # Report ERROR to the CMS only when no RQ retries remain: a failing attempt re-raises so
        # RQ can retry it, and sending ERROR earlier would let a successful retry follow up with
        # COMPLETE for a message the CMS already marked as failed.
        job = get_current_job()
        retries_left = job.retries_left if job is not None else None
        if not retries_left:
            enqueue_callback(callback_url, {"status": ChatStatus.ERROR, "payload": None})
        else:
            logger.info(
                f"Chat task for message_id {message_id} will be retried "
                f"({retries_left} attempts left), skipping ERROR callback"
            )
        raise


def _log_queue_wait() -> None:
    job = get_current_job()
    if job is None or not isinstance(job.enqueued_at, datetime) or not isinstance(job.started_at, datetime):
        return
    wait_ms = (job.started_at - job.enqueued_at).total_seconds() * 1000
    logger.info(f"Chat job {job.id} waited {wait_ms:.0f}ms in the queue")
