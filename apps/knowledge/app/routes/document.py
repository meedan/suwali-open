import sys

from asgi_correlation_id.context import correlation_id
from fastapi import APIRouter, Depends, HTTPException, Response, status
from loguru import logger
from redis import Redis
from rq import Queue, Retry

from app.core.config import Config
from app.core.constants import QUEUE_INGESTION, QUEUE_REMOVAL
from app.core.neo4j_retry import execute_with_retry
from app.models.document import (
    DeleteRequest,
    IndexDocumentRequest,
    JobStatusResponse,
    UpdateTopicsRequest,
    UpdateTopicsResponse,
)
from app.services.document import Document
from app.services.neo4j_client import Neo4jClient
from app.services.redis_client import get_redis_client
from app.tasks.document import remove_document
from app.tasks.ingestion import process_document

router = APIRouter()


@router.post("/")
async def index_document(
    payload: IndexDocumentRequest, redis_client: Redis = Depends(get_redis_client)
) -> JobStatusResponse:
    config = Config()
    queue = Queue(name=QUEUE_INGESTION, connection=redis_client, default_timeout=config.rq_job_timeout)
    job = queue.enqueue(
        process_document,
        payload.hub_id,
        payload.document_id,
        payload.file_url,
        payload.text,
        payload.original_url,
        payload.title,
        payload.published_at,
        payload.callback_url,
        payload.priority_tier,
        payload.existing_topics,
        payload.text_is_markdown,
        payload.document_type,
        payload.summary,
        retry=Retry(max=config.rq_retry_max, interval=config.rq_retry_interval) if config.rq_retry_max > 0 else None,
        meta={"correlation_id": correlation_id.get()},
    )
    logger.info(
        f"Ingestion scheduled for path: {payload.file_url}, hub: {payload.hub_id}, id: {payload.document_id}, title: {payload.title}, text: {payload.text[:50]}..."  # noqa
    )
    return JobStatusResponse(id=job.id, status=job.get_status())


@router.delete("/", response_model=None)
async def delete(
    payload: DeleteRequest, redis_client: Redis = Depends(get_redis_client)
) -> JobStatusResponse | Response:
    if not (isinstance(payload.hub_id, int) and payload.hub_id > 0):
        raise ValueError("hub_id must be a positive integer")
    try:
        driver = Neo4jClient().get_driver(payload.hub_id)
        with driver.session() as session:
            document_service = Document(session, payload.hub_id)
            if not document_service.exists(payload.document_id):
                logger.info(f"Document {payload.document_id} not found in hub {payload.hub_id}, skipping deletion")
                return Response(status_code=204)

        config = Config()
        queue = Queue(name=QUEUE_REMOVAL, connection=redis_client, default_timeout=config.rq_job_timeout)
        job = queue.enqueue(
            remove_document,
            payload.hub_id,
            payload.document_id,
            payload.callback_url,
            meta={"correlation_id": correlation_id.get()},
        )
        logger.info(f"Deletion scheduled for document_id: {payload.document_id}, hub: {payload.hub_id}")
        return JobStatusResponse(id=job.id, status=job.get_status())
    except HTTPException:
        raise
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Deletion for document_id {payload.document_id} failed: {e}")
        raise HTTPException(status_code=400, detail=f"Deletion for document_id {payload.document_id} failed: {e}")


@router.put("/topics/")
def update_topics(payload: UpdateTopicsRequest, response: Response) -> UpdateTopicsResponse:
    if payload.hub_id <= 0:
        response.status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
        return UpdateTopicsResponse(updated=False, error="hub_id must be a positive integer")

    def set_topics() -> bool:
        driver = Neo4jClient().get_driver(payload.hub_id)
        with driver.session() as session:
            return Document(session, payload.hub_id).set_topics(payload.document_id, payload.topics)

    try:
        updated = execute_with_retry(set_topics)
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(
            f"Updating topics for document_id {payload.document_id} in hub {payload.hub_id} failed: {e}"
        )
        response.status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
        return UpdateTopicsResponse(updated=False, error="Failed to update document topics")

    if not updated:
        response.status_code = status.HTTP_404_NOT_FOUND
        return UpdateTopicsResponse(updated=False, error="Document not found")
    logger.info(f"Updated topics for document_id: {payload.document_id}, hub: {payload.hub_id}")
    return UpdateTopicsResponse(updated=True)


@router.get("/{id}")
async def get_job_status(id: str, redis_client: Redis = Depends(get_redis_client)) -> JobStatusResponse:
    config = Config()
    for queue_name in [QUEUE_INGESTION, QUEUE_REMOVAL]:
        queue = Queue(name=queue_name, connection=redis_client, default_timeout=config.rq_job_timeout)
        job = queue.fetch_job(id)
        if job:
            return JobStatusResponse(id=job.id, status=job.get_status())

    raise HTTPException(status_code=404, detail="Job not found")
