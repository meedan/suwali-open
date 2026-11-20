import logging
import multiprocessing as mp
import os
import platform
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, List
from uuid import uuid4

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from loguru import logger
from pydantic import BaseModel, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from redis import Redis
from rq import Queue, SimpleWorker, Worker
from rq.job import Job
from rq.queue import Queue as RQQueue
from rq.registry import DeferredJobRegistry, FailedJobRegistry

from app.core.config import dotenv_files
from app.core.constants import QUEUE_CALLBACK, QUEUE_CHAT, QUEUE_INGESTION, QUEUE_REMOVAL
from app.core.logging import HealthCheckFilter, log_openai_retry_causes, setup_sentry
from app.core.logging import setup_logging as setup_app_logging
from app.services.embedder_factory import EmbedderFactory

# The task modules are imported here, not where they are used, so that this process (which every
# worker and every job fork inherits from) already holds them: RQ resolves the job function lazily
# inside the fork, and importing this chain costs ~6 seconds on every single job otherwise.
from app.tasks import callback, chat, document, ingestion  # noqa: F401

load_dotenv(override=True)
if deploy_env := os.getenv("DEPLOY_ENV"):
    load_dotenv(f".env.{deploy_env}", override=True)
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

########################################################################
# HEALTH CHECK
########################################################################


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=dotenv_files(), extra="ignore")

    redis_url: str
    rq_health_check_port: int
    rq_queues: str  # comma-separated, e.g. "chat,ingestion,removal"
    rq_worker_count: int = 1
    rq_job_timeout: int = 1800

    @field_validator("rq_queues")
    @classmethod
    def validate_rq_queues(cls, value: str) -> str:
        queues = [q.strip() for q in value.split(",") if q.strip()]
        for queue in queues:
            if queue not in {QUEUE_CALLBACK, QUEUE_CHAT, QUEUE_INGESTION, QUEUE_REMOVAL}:
                raise ValueError(
                    f"Invalid queue name: {queue}. Must be one of: {QUEUE_CALLBACK}, {QUEUE_CHAT}, {QUEUE_INGESTION}, {QUEUE_REMOVAL}"
                )
        return value


settings = Settings()
app = FastAPI(title="RQ Worker Health Service")


class HealthResponse(BaseModel):
    healthy: bool
    rq_processes: int
    enqueued_jobs: int
    failed_jobs: int
    deferred_jobs: int
    timestamp: datetime


@app.get("/health")
def health() -> HealthResponse:
    try:
        redis_conn = Redis.from_url(settings.redis_url)

        is_alive = redis_conn.ping()
        if not is_alive:
            raise Exception("Redis connection is not alive")

        # Aggregate stats from all queues
        callback_queue = Queue(name=QUEUE_CALLBACK, connection=redis_conn, default_timeout=60)
        chat_queue = Queue(name=QUEUE_CHAT, connection=redis_conn, default_timeout=settings.rq_job_timeout)
        ingestion_queue = Queue(name=QUEUE_INGESTION, connection=redis_conn, default_timeout=settings.rq_job_timeout)
        removal_queue = Queue(name=QUEUE_REMOVAL, connection=redis_conn, default_timeout=settings.rq_job_timeout)
        all_queues = [callback_queue, chat_queue, ingestion_queue, removal_queue]
        total_enqueued = sum(len(q) for q in all_queues)

        workers = Worker.all(connection=redis_conn)
        active_workers = len([w for w in workers if w.state != "suspended"]) if workers else 0

        # Aggregate failed/deferred counts from all queues
        failed_count = sum(len(FailedJobRegistry(queue=q)) for q in all_queues)
        deferred_count = sum(len(DeferredJobRegistry(queue=q)) for q in all_queues)

        return HealthResponse(
            healthy=True,
            rq_processes=active_workers,
            enqueued_jobs=total_enqueued,
            failed_jobs=failed_count,
            deferred_jobs=deferred_count,
            timestamp=datetime.now(timezone.utc),
        )
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Health check failed: {e}")
        model = HealthResponse(
            healthy=False,
            rq_processes=0,
            enqueued_jobs=0,
            failed_jobs=0,
            deferred_jobs=0,
            timestamp=datetime.now(timezone.utc),
        )
        raise HTTPException(status_code=500, detail=str(model))


########################################################################
# GRACEFUL SHUTDOWN
########################################################################


class GracefulShutdownHandler:
    shutdown_requested: bool
    worker_processes: List[mp.Process]

    def __init__(self) -> None:
        self.shutdown_requested = False
        self.worker_processes = []

    def register_signal_handlers(self) -> None:
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

    def _signal_handler(self, signum: Any, frame: Any) -> None:
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.shutdown_requested = True

    def shutdown(self) -> None:
        logger.info("Starting graceful shutdown...")

        if self.worker_processes:
            logger.info(f"Stopping {len(self.worker_processes)} RQ worker processes...")

            # Send SIGTERM to all worker processes
            for i, process in enumerate(self.worker_processes):
                if process.is_alive():
                    logger.info(f"Terminating worker process {i + 1} (PID: {process.pid})")
                    process.terminate()

            # Wait for all processes to finish (with timeout)
            timeout = 30
            start_time = time.time()

            while (time.time() - start_time) < timeout:
                alive_processes = [p for p in self.worker_processes if p.is_alive()]
                if not alive_processes:
                    break
                logger.info(f"Waiting for {len(alive_processes)} worker processes to finish...")
                time.sleep(1)

            # Force kill any remaining processes
            alive_processes = [p for p in self.worker_processes if p.is_alive()]
            if alive_processes:
                logger.warning(f"{len(alive_processes)} worker processes still alive after timeout, force killing...")
                for process in alive_processes:
                    logger.warning(f"Force killing worker process (PID: {process.pid})")
                    process.kill()
                    process.join()
            else:
                logger.info("All worker processes stopped gracefully")

        # The web server thread is daemon, so it will stop when main thread exits
        logger.info("Graceful shutdown completed")
        sys.exit(0)


########################################################################
# CORRELATION ID PROPAGATION
########################################################################


class _CorrelationIdMixin:
    def perform_job(self, job: Job, queue: RQQueue, **kwargs: Any) -> bool:
        # Runs inside the horse process (fork-based) or same process (SimpleWorker).
        # Re-initialize loguru here so sinks are fresh in this process.
        env = os.getenv("DEPLOY_ENV", "local")
        setup_sentry(env)
        setup_app_logging()
        cid: str = (job.meta or {}).get("correlation_id") or str(uuid4())
        with logger.contextualize(correlation_id=cid):
            return super().perform_job(job, queue, **kwargs)  # type: ignore[misc, no-any-return]


class CorrelationIdWorker(_CorrelationIdMixin, Worker):
    pass


class CorrelationIdSimpleWorker(_CorrelationIdMixin, SimpleWorker):
    pass


########################################################################
# ENTRY POINTS
########################################################################


def start_web_server() -> None:
    uvicorn.run(
        "rq_worker:app",
        host="0.0.0.0",
        port=settings.rq_health_check_port,
        reload=False,
    )


def start_worker(worker_id: int) -> None:
    env = os.getenv("DEPLOY_ENV", "local")
    setup_sentry(env)
    setup_app_logging()
    redis_conn = Redis.from_url(settings.redis_url)

    # Priority order: callback first (short HTTP dispatch), then chat, ingestion, removal
    enabled = {q.strip() for q in settings.rq_queues.split(",")}
    queues = []
    if QUEUE_CALLBACK in enabled:
        queues.append(Queue(name=QUEUE_CALLBACK, connection=redis_conn, default_timeout=60))
        logger.info(f"Worker {worker_id} will process {QUEUE_CALLBACK} queue")

    if QUEUE_CHAT in enabled:
        queues.append(Queue(name=QUEUE_CHAT, connection=redis_conn, default_timeout=settings.rq_job_timeout))
        logger.info(f"Worker {worker_id} will process {QUEUE_CHAT} queue")

    if QUEUE_INGESTION in enabled:
        queues.append(Queue(name=QUEUE_INGESTION, connection=redis_conn, default_timeout=settings.rq_job_timeout))
        logger.info(f"Worker {worker_id} will process {QUEUE_INGESTION} queue")

    if QUEUE_REMOVAL in enabled:
        queues.append(Queue(name=QUEUE_REMOVAL, connection=redis_conn, default_timeout=settings.rq_job_timeout))
        logger.info(f"Worker {worker_id} will process {QUEUE_REMOVAL} queue")

    worker: Worker
    if platform.system() == "Windows" or platform.system() == "Darwin":
        worker = CorrelationIdSimpleWorker(queues, connection=redis_conn)
    else:
        worker = CorrelationIdWorker(queues, connection=redis_conn)

    try:
        logger.info(f"Starting RQ worker {worker_id} (PID: {mp.current_process().pid})...")
        worker.work(with_scheduler=True)
    except KeyboardInterrupt:
        logger.info(f"Worker {worker_id} interrupted by KeyboardInterrupt")
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Worker {worker_id} error: {e}")
        raise


def setup_logging() -> None:
    log_level = logging.INFO
    logging.basicConfig(level=log_level)
    uvicorn_access = logging.getLogger("uvicorn.access")
    uvicorn_access.setLevel(log_level)
    uvicorn_access.addFilter(HealthCheckFilter())
    log_openai_retry_causes()


def main() -> None:
    setup_logging()

    if settings.rq_worker_count < 1:
        logger.error("RQ_WORKER_COUNT must be at least 1")
        sys.exit(1)

    if not settings.rq_queues.strip():
        logger.error("RQ_QUEUES must contain at least one queue")
        sys.exit(1)

    shutdown_handler = GracefulShutdownHandler()
    shutdown_handler.register_signal_handlers()

    # Preload embedder(s): Cohere-on-Bedrock uses separate index vs query semantics
    EmbedderFactory.get_embedder(purpose="index")
    EmbedderFactory.get_embedder(purpose="query")

    # Start web server in background thread
    web_server_thread = threading.Thread(target=start_web_server, daemon=True)
    web_server_thread.start()
    logger.info("Health check server started in background")

    # Start multiple worker processes
    worker_count = settings.rq_worker_count
    logger.info(f"Starting {worker_count} RQ worker processes...")

    for i in range(worker_count):
        worker_process = mp.Process(target=start_worker, args=(i + 1,), name=f"RQWorker-{i + 1}")
        worker_process.start()
        shutdown_handler.worker_processes.append(worker_process)
        logger.info(f"Started worker process {i + 1} (PID: {worker_process.pid})")

    try:
        # Wait for all worker processes to complete
        for process in shutdown_handler.worker_processes:
            process.join()
    except KeyboardInterrupt:
        logger.info("Received KeyboardInterrupt")
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Unexpected error: {e}")
    finally:
        if shutdown_handler.shutdown_requested:
            shutdown_handler.shutdown()
        else:
            logger.info("Shutting down...")
            EmbedderFactory.cleanup()
            shutdown_handler.shutdown()


if __name__ == "__main__":
    main()
