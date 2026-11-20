import re
import sys
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from loguru import logger
from neo4j import Driver

from app.core.neo4j_retry import is_missing_vector_index_error
from app.services.neo4j_pool_manager import neo4j_pool

T = TypeVar("T")


class Neo4jClient:
    def get_driver(self, hub_id: int) -> Driver:
        return neo4j_pool.get_driver(hub_id)

    def close(self, hub_id: int) -> None:
        neo4j_pool.close_hub_connection(hub_id)

    def invalidate(self, hub_id: int) -> None:
        neo4j_pool.invalidate_driver(hub_id)

    def ensure_indexes(self, hub_id: int) -> None:
        neo4j_pool.ensure_indexes_for_hub(hub_id)

    @staticmethod
    def parse_neo4j_record_str(record_str: str) -> dict[str, Any]:
        if not record_str.startswith("<Record"):
            raise ValueError("Not a valid Neo4j record string")

        # Remove leading/trailing <Record ... >
        inner = record_str.strip()[8:-1].strip()

        # Find all key=value pairs (numbers or quoted strings)
        pattern = re.compile(r"(\w+)=('(?:\\.|[^'])*'|\"(?:\\.|[^\"])*\"|\d+)", re.DOTALL)
        matches = pattern.findall(inner)

        data: dict[str, Any] = {}
        for key, value in matches:
            if value.startswith("'") and value.endswith("'"):
                data[key] = Neo4jClient._unescape_record_value(value[1:-1])
            elif value.startswith('"') and value.endswith('"'):
                data[key] = Neo4jClient._unescape_record_value(value[1:-1])
            elif value.isdigit():
                data[key] = int(value)
            else:
                data[key] = value
        return data

    @staticmethod
    def _unescape_record_value(value: str) -> str:
        value = (
            value.replace("\\\\", "\\")
            .replace("\\n", "\n")
            .replace("\\r", "\r")
            .replace("\\t", "\t")
            .replace('\\"', '"')
            .replace("\\'", "'")
        )
        value = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), value)
        return value


def recover_missing_vector_index(hub_id: int, error: Exception, context: str) -> None:
    """Recreate a hub's Neo4j indexes after an operation fails because one is missing.

    Shared by callers that build a retriever/pipeline against a driver cached before the hub's
    indexes existed (or after they were dropped) while the driver itself stayed alive — e.g.
    Retriever at query time and Ingestor at write time. Both recover from that failure the same
    way: recreate the indexes, then let the caller retry its operation once.
    """
    logger.opt(exception=sys.exc_info()).warning(
        f"Vector index missing for hub {hub_id} during {context}, recreating and retrying: {error}"
    )
    Neo4jClient().ensure_indexes(hub_id)


def run_with_index_recovery(func: Callable[[], T], hub_id: int, context: str) -> T:
    """Run func, recovering once from a missing vector/fulltext index and retrying.

    Shared retry shape for callers that build a retriever/pipeline against a driver
    cached before the hub's indexes existed (or after they were dropped): see
    recover_missing_vector_index for why this happens.
    """
    try:
        return func()
    except Exception as e:
        if not is_missing_vector_index_error(e):
            raise
        recover_missing_vector_index(hub_id, e, context)
        return func()


async def run_with_index_recovery_async(func: Callable[[], Awaitable[T]], hub_id: int, context: str) -> T:
    """Async counterpart of run_with_index_recovery."""
    try:
        return await func()
    except Exception as e:
        if not is_missing_vector_index_error(e):
            raise
        recover_missing_vector_index(hub_id, e, context)
        return await func()
