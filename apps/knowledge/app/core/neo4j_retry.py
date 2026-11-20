"""Retry utilities for Neo4j transient connection errors."""

import sys
import time
from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar

from loguru import logger
from neo4j.exceptions import (
    DatabaseUnavailable,
    ReadServiceUnavailable,
    RoutingServiceUnavailable,
    ServiceUnavailable,
    SessionExpired,
    TransientError,
    WriteServiceUnavailable,
)

from app.core.logging import publish_metric

# Exceptions that indicate a transient connection issue worth retrying
RETRYABLE_EXCEPTIONS = (
    ServiceUnavailable,
    SessionExpired,
    TransientError,
    ReadServiceUnavailable,
    WriteServiceUnavailable,
    RoutingServiceUnavailable,
    DatabaseUnavailable,
    ConnectionResetError,
    ConnectionError,
    OSError,  # Catches lower-level socket errors
)

T = TypeVar("T")

DEFAULT_MAX_RETRIES = 3
DEFAULT_BASE_DELAY = 0.5  # seconds
DEFAULT_MAX_DELAY = 10.0  # seconds
DEFAULT_EXPONENTIAL_BASE = 2.0


def is_connection_reset_error(exc: BaseException) -> bool:
    """Check if an exception is a connection reset error, including nested causes."""
    if isinstance(exc, RETRYABLE_EXCEPTIONS):
        return True

    # Check for connection reset in the exception message
    error_msg = str(exc).lower()
    if "connection reset" in error_msg or "broken pipe" in error_msg or "defunct" in error_msg:
        return True

    # Check the exception chain (__cause__ and __context__)
    if exc.__cause__ is not None and is_connection_reset_error(exc.__cause__):
        return True
    if exc.__context__ is not None and is_connection_reset_error(exc.__context__):
        return True

    return False


# Two distinct phrasings show up depending on where the failure occurs:
# - neo4j_graphrag raises this at retriever construction time (SHOW VECTOR INDEXES returns no rows).
# - Neo4j itself raises this at query time (db.index.vector/fulltext.queryNodes on a dropped index),
#   surfaced via a wrapped ClientError/GqlError whose str() embeds the driver-side message.
_MISSING_INDEX_PHRASES = (
    "no index with name",
    "no such vector schema index",
    "no such fulltext schema index",
)


def is_missing_vector_index_error(exc: BaseException) -> bool:
    """Check if an exception indicates a missing Neo4j vector/fulltext index, including nested causes."""
    error_msg = str(exc).lower()
    if any(phrase in error_msg for phrase in _MISSING_INDEX_PHRASES):
        return True

    if exc.__cause__ is not None and is_missing_vector_index_error(exc.__cause__):
        return True
    if exc.__context__ is not None and is_missing_vector_index_error(exc.__context__):
        return True

    return False


def neo4j_retry(
    max_retries: int = DEFAULT_MAX_RETRIES,
    base_delay: float = DEFAULT_BASE_DELAY,
    max_delay: float = DEFAULT_MAX_DELAY,
    exponential_base: float = DEFAULT_EXPONENTIAL_BASE,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """
    Decorator that retries a function on Neo4j transient connection errors.

    Uses exponential backoff with jitter between retries.

    Args:
        max_retries: Maximum number of retry attempts
        base_delay: Initial delay between retries in seconds
        max_delay: Maximum delay between retries in seconds
        exponential_base: Base for exponential backoff

    Example:
        @neo4j_retry(max_retries=3)
        def search_neo4j():
            return retriever.search(query_text="test")
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            last_exception: BaseException | None = None

            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if not is_connection_reset_error(e):
                        raise

                    last_exception = e

                    if attempt == max_retries:
                        logger.opt(exception=sys.exc_info()).error(
                            f"Neo4j operation failed after {max_retries + 1} attempts: {e}"
                        )
                        raise

                    # Calculate delay with exponential backoff
                    delay = min(base_delay * (exponential_base**attempt), max_delay)

                    logger.warning(
                        f"Neo4j transient error (attempt {attempt + 1}/{max_retries + 1}), "
                        f"retrying in {delay:.2f}s: {e}"
                    )
                    time.sleep(delay)

            # This should never be reached, but satisfy type checker
            if last_exception:
                raise last_exception
            raise RuntimeError("Unexpected state in neo4j_retry")

        return wrapper

    return decorator


def execute_with_retry(
    func: Callable[..., T],
    *args: Any,
    max_retries: int = DEFAULT_MAX_RETRIES,
    base_delay: float = DEFAULT_BASE_DELAY,
    max_delay: float = DEFAULT_MAX_DELAY,
    exponential_base: float = DEFAULT_EXPONENTIAL_BASE,
    **kwargs: Any,
) -> T:
    """
    Execute a function with retry logic for Neo4j transient errors.

    This is a functional alternative to the @neo4j_retry decorator.

    Args:
        func: The function to execute
        *args: Positional arguments to pass to the function
        max_retries: Maximum number of retry attempts
        base_delay: Initial delay between retries in seconds
        max_delay: Maximum delay between retries in seconds
        exponential_base: Base for exponential backoff
        **kwargs: Keyword arguments to pass to the function

    Returns:
        The return value of the function

    Raises:
        The last exception if all retries fail
    """
    last_exception: BaseException | None = None

    for attempt in range(max_retries + 1):
        try:
            time_start = time.perf_counter()
            result = func(*args, **kwargs)
            time_end = time.perf_counter()
            publish_metric(
                "neo4j.query.duration",
                (time_end - time_start) * 1000,
                unit="Milliseconds",
            )
            return result
        except Exception as e:
            if not is_connection_reset_error(e):
                raise

            last_exception = e

            if attempt == max_retries:
                raise

            delay = min(base_delay * (exponential_base**attempt), max_delay)

            logger.warning(
                f"Neo4j transient error (attempt {attempt + 1}/{max_retries + 1}), retrying in {delay:.2f}s: {e}"
            )
            time.sleep(delay)

    if last_exception:
        raise last_exception
    raise RuntimeError("Unexpected state in execute_with_retry")
