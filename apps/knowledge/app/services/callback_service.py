import sys
import time
from typing import Any

import httpx
from loguru import logger
from rq import Queue, Retry

from app.core.config import Config
from app.core.constants import QUEUE_CALLBACK
from app.services.redis_client import get_redis_client


def send_chat_status_sync(
    callback_url: str, status: str, payload: dict[str, Any] | None = None, retries: int = 1
) -> None:
    """Send a chat status callback synchronously. Fire-and-forget for intermediary
    statuses (failures are logged but never block the pipeline)."""
    if not callback_url:
        return

    body = {"status": status, "payload": payload}
    timeout = 30.0 if status == "complete" else 5.0

    for attempt in range(retries):
        try:
            response = httpx.post(callback_url, json=body, timeout=timeout)
            if response.status_code == 200:
                logger.info(f"Chat status callback '{status}' sent successfully")
            else:
                logger.warning(f"Chat status callback '{status}' returned status {response.status_code}")
            return
        except Exception as e:
            logger.warning(f"Chat status callback '{status}' failed (attempt {attempt + 1}/{retries}): {e}")
            if attempt < retries - 1:
                time.sleep(min(2**attempt, 4))


def enqueue_callback(callback_url: str, body: dict[str, Any]) -> None:
    """Enqueue a callback via the dedicated RQ callback queue."""
    if not callback_url:
        return
    from app.tasks.callback import dispatch_callback

    try:
        config = Config()
        queue = Queue(name=QUEUE_CALLBACK, connection=get_redis_client(), default_timeout=60)
        queue.enqueue(
            dispatch_callback,
            callback_url,
            body,
            retry=Retry(max=config.rq_retry_max) if config.rq_retry_max > 0 else None,
        )
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Failed to enqueue callback to {callback_url}: {e}")
