"""Abstract base class for knowledge handlers."""

import asyncio
import sys
import time
from abc import ABC, abstractmethod
from typing import Any

from loguru import logger

from app.core.context import pipeline_step
from app.services.router.models import HandlerResult, KnowledgeSource, QueryContext


class KnowledgeHandler(ABC):
    """Abstract base class defining the contract all knowledge handlers must implement."""

    @property
    @abstractmethod
    def source(self) -> KnowledgeSource:
        """Return the knowledge source this handler represents."""
        pass

    @abstractmethod
    def _retrieve(self, query: str, context: QueryContext, **kwargs: Any) -> HandlerResult:
        pass

    async def retrieve(self, query: str, context: QueryContext, **kwargs: Any) -> HandlerResult:
        start_time = time.perf_counter()

        try:
            with pipeline_step(self.source.value):
                result = await asyncio.to_thread(self._retrieve, query, context, **kwargs)
            result.latency_ms = (time.perf_counter() - start_time) * 1000
            return result

        except Exception as e:
            latency_ms = (time.perf_counter() - start_time) * 1000
            logger.opt(exception=sys.exc_info()).error(f"Handler {self.source} failed: {e}")
            return HandlerResult(
                source=self.source,
                success=False,
                error=str(e),
                latency_ms=latency_ms,
            )

    def is_enabled(self) -> bool:
        return True
