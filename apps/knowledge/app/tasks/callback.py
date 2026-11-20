import sys
from typing import Any

import httpx
from loguru import logger


def dispatch_callback(callback_url: str, body: dict[str, Any], timeout: float = 30.0) -> None:
    """Send an outbound HTTP callback. Intended to run as a dedicated RQ job so
    retries and failures are handled by the queue rather than blocking a
    business-logic worker."""
    if not callback_url:
        return

    try:
        logger.info(f"Dispatching callback to {callback_url} with body: {body}")
        response = httpx.post(callback_url, json=body, timeout=timeout)
        if response.status_code == 200:
            logger.info(f"Callback sent successfully to {callback_url}")
        else:
            logger.warning(f"Callback to {callback_url} returned status {response.status_code}: {response.text}")
            response.raise_for_status()
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Callback to {callback_url} failed: {e}")
        raise
