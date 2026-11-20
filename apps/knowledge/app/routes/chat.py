import time

from asgi_correlation_id.context import correlation_id
from fastapi import APIRouter, Depends
from loguru import logger
from redis import Redis
from rq import Queue, Retry

from app.core.config import Config
from app.core.constants import QUEUE_CHAT
from app.core.debug_log import TRUNCATE, debug_log_capture
from app.core.logging import publish_chat_duration_details_metrics, publish_metric
from app.models.chat import ChatRequest, ChatResponse, Metadata
from app.models.document import JobStatusResponse
from app.services.neo4j_timing import neo4j_timing
from app.services.redis_client import get_redis_client
from app.services.router import RAGRouter
from app.tasks.chat import process_chat

router = APIRouter()


@router.post("/", response_model=ChatResponse | JobStatusResponse, status_code=200)
async def chat(
    payload: ChatRequest, redis_client: Redis = Depends(get_redis_client)
) -> ChatResponse | JobStatusResponse:
    logger.bind(**{TRUNCATE: True}).info(
        f"Chat request personalization for hub {payload.hub_id}, message_id {payload.message_id}: "
        f"{payload.personalization.model_dump() if payload.personalization else None}"
    )

    if payload.callback_url:
        config = Config()
        queue = Queue(name=QUEUE_CHAT, connection=redis_client, default_timeout=config.rq_job_timeout)
        job = queue.enqueue(
            process_chat,
            payload.hub_id,
            payload.message_id,
            payload.message,
            [m.model_dump() for m in payload.history] if payload.history else None,
            payload.personalization.model_dump() if payload.personalization else None,
            payload.callback_url,
            payload.recency_first_enabled,
            payload.existing_topics,
            [note.model_dump() for note in payload.conversation_context]
            if payload.conversation_context is not None
            else None,
            payload.location_gate_enabled,
            payload.debug,
            retry=Retry(max=config.rq_retry_max) if config.rq_retry_max > 0 else None,
            meta={"correlation_id": correlation_id.get()},
        )
        logger.info(
            f"Chat task scheduled for hub: {payload.hub_id}, message_id: {payload.message_id}, job_id: {job.id}, recency_first_enabled: {payload.recency_first_enabled}, "
            f"location_gate_enabled: {payload.location_gate_enabled}, "
            # only the count: the notes are personal data
            f"conversation_context_notes: {len(payload.conversation_context) if payload.conversation_context is not None else None}"
        )
        return JobStatusResponse(id=job.id, status=job.get_status())

    # Synchronous path (backward compatibility)
    start_time = time.perf_counter()
    with debug_log_capture(payload.debug, start_time) as debug_log:
        response = await _answer_chat(payload, start_time)
        if debug_log is not None:
            response.log = debug_log.lines
    return response


async def _answer_chat(payload: ChatRequest, start_time: float) -> ChatResponse:
    logger.bind(**{TRUNCATE: True}).info(
        f"Processing message, hub: {payload.hub_id}, id: {payload.message_id}, message: {payload.message}, history: {payload.history}"
    )

    rag_router = RAGRouter(payload.hub_id)
    with neo4j_timing() as neo4j_recorder:
        response = await rag_router.route(payload)

    duration_ms = (time.perf_counter() - start_time) * 1000
    if response.metadata is None:
        response.metadata = Metadata()
    response.metadata.total_duration_ms = duration_ms
    response.metadata.neo4j_duration_details = neo4j_recorder.summary() or None

    logger.info(f"Chat message processed in {duration_ms:.0f}ms")
    publish_metric("answer.generated", duration_ms, unit="Milliseconds", hub_id=payload.hub_id)
    question_type = response.metadata.question_type
    if question_type:
        publish_metric("answer.generated", duration_ms, unit="Milliseconds", question_type=question_type)
    duration_details = response.metadata.duration_details
    publish_chat_duration_details_metrics(duration_details, hub_id=payload.hub_id, question_type=question_type)

    return response
