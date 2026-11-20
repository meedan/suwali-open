from enum import Enum

from pydantic import BaseModel


class HealthStatus(Enum):
    OK = "ok"
    ERROR = "error"


class HealthResponse(BaseModel):
    status: HealthStatus
    enqueued_jobs: int = 0
    failed_jobs: int = 0
    deferred_jobs: int = 0
    active_workers: int = 0
