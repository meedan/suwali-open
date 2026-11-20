import sys

from fastapi import APIRouter, Depends
from loguru import logger
from redis import Redis
from rq import Queue, Worker
from rq.registry import DeferredJobRegistry, FailedJobRegistry

from app.core.config import Config
from app.core.constants import QUEUE_INGESTION, QUEUE_REMOVAL
from app.models.health import HealthResponse, HealthStatus
from app.services.redis_client import get_redis_client

router = APIRouter()
config = Config()


@router.get("/")
async def health(redis: Redis = Depends(get_redis_client)) -> HealthResponse:
    try:
        redis_ok = redis.ping()
        status = HealthStatus.OK if redis_ok else HealthStatus.ERROR

        failed_count = 0
        deferred_count = 0
        total_enqueued = 0
        active_workers = 0

        if redis_ok:
            try:
                ingestion_queue = Queue(name=QUEUE_INGESTION, connection=redis, default_timeout=config.rq_job_timeout)
                removal_queue = Queue(name=QUEUE_REMOVAL, connection=redis, default_timeout=config.rq_job_timeout)
                total_enqueued = len(ingestion_queue) + len(removal_queue)

                failed_count = len(FailedJobRegistry(queue=ingestion_queue)) + len(
                    FailedJobRegistry(queue=removal_queue)
                )
                deferred_count = len(DeferredJobRegistry(queue=ingestion_queue)) + len(
                    DeferredJobRegistry(queue=removal_queue)
                )

                workers = Worker.all(connection=redis)
                active_workers = len([w for w in workers if w.state != "suspended"]) if workers else 0
            except Exception as e:
                logger.opt(exception=sys.exc_info()).warning(f"Failed to get RQ queue metrics: {e}")

        return HealthResponse(
            status=status,
            enqueued_jobs=total_enqueued,
            failed_jobs=failed_count,
            deferred_jobs=deferred_count,
            active_workers=active_workers,
        )
    except Exception:
        logger.opt(exception=sys.exc_info()).error("Health check failed with exception")
        return HealthResponse(status=HealthStatus.ERROR)
