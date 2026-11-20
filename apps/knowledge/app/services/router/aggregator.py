import asyncio
import sys
import time

from loguru import logger

from app.core.context import pipeline_step
from app.models.chat import DurationKey
from app.services.router.handler import KnowledgeHandler
from app.services.router.models import (
    AggregatedResult,
    HandlerResult,
    KnowledgeSource,
    QueryContext,
    RouteDecision,
)


class ResultAggregator:
    """
    Aggregates results from multiple knowledge handlers.
    """

    def __init__(self, handlers: list[KnowledgeHandler], parallel: bool = True, max_workers: int = 3) -> None:
        self.handlers = {h.source: h for h in handlers}
        self.parallel = parallel
        self.max_workers = max_workers

    async def aggregate(
        self,
        query: str,
        context: QueryContext,
        routes: list[RouteDecision],
    ) -> AggregatedResult:
        start_time = time.perf_counter()

        active_routes = [
            route for route in routes if route.source in self.handlers and self.handlers[route.source].is_enabled()
        ]

        if not active_routes:
            logger.warning("No active routes after filtering")
            return AggregatedResult(
                results=[],
                primary_source=None,
                total_latency_ms=0,
            )

        logger.info(f"Aggregating results from {len(active_routes)} sources: {[r.source for r in active_routes]}")

        with pipeline_step(DurationKey.ENRICHMENT_AGGREGATION):
            if self.parallel and len(active_routes) > 1:
                results = await self._execute_parallel(query, context, active_routes)
            else:
                results = await self._execute_sequential(query, context, active_routes)

        logger.debug(f"{len(results)} aggregated: {results}")

        primary_source = self._determine_primary_source(results, routes)

        total_latency_ms = (time.perf_counter() - start_time) * 1000

        return AggregatedResult(
            results=results,
            primary_source=primary_source,
            total_latency_ms=total_latency_ms,
        )

    async def _execute_parallel(
        self,
        query: str,
        context: QueryContext,
        routes: list[RouteDecision],
    ) -> list[HandlerResult]:
        tasks = [self.handlers[route.source].retrieve(query, context) for route in routes]
        raw_outcomes: list[HandlerResult | BaseException] = await asyncio.gather(*tasks, return_exceptions=True)

        results: list[HandlerResult] = []
        for route, outcome in zip(routes, raw_outcomes, strict=False):
            if isinstance(outcome, BaseException):
                logger.opt(exception=outcome).error(f"Handler {route.source} raised exception: {outcome}")
                results.append(HandlerResult(source=route.source, success=False, error=str(outcome)))
            else:
                logger.debug(f"Handler {route.source} completed: success={outcome.success}; error={outcome.error}")
                results.append(outcome)

        return results

    async def _execute_sequential(
        self,
        query: str,
        context: QueryContext,
        routes: list[RouteDecision],
    ) -> list[HandlerResult]:
        results: list[HandlerResult] = []

        for route in routes:
            handler = self.handlers[route.source]
            try:
                result = await handler.retrieve(query, context)
                results.append(result)
                logger.debug(f"Handler {route.source} completed: success={result.success}")
            except Exception as e:
                logger.opt(exception=sys.exc_info()).error(f"Handler {route.source} raised exception: {e}")
                results.append(
                    HandlerResult(
                        source=route.source,
                        success=False,
                        error=str(e),
                    )
                )

        return results

    def _determine_primary_source(
        self,
        results: list[HandlerResult],
        routes: list[RouteDecision],
    ) -> KnowledgeSource | None:
        if not results:
            return None

        priority_map = {route.source: route.priority for route in routes}
        route_confidence_map = {route.source: route.confidence for route in routes}

        scored_results: list[tuple[KnowledgeSource, float]] = []

        for result in results:
            if not result.success or not result.answer:
                continue

            score = result.confidence * 0.5

            route_conf = route_confidence_map.get(result.source, 0.5)
            score += route_conf * 0.3

            priority = priority_map.get(result.source, 10)
            priority_bonus = max(0, (10 - priority) / 10) * 0.2
            score += priority_bonus

            scored_results.append((result.source, score))

        if not scored_results:
            return None

        scored_results.sort(key=lambda x: x[1], reverse=True)
        return scored_results[0][0]

    def get_successful_results(self, aggregated: AggregatedResult) -> list[HandlerResult]:
        return [r for r in aggregated.results if r.success and r.answer]

    def get_result_by_source(self, aggregated: AggregatedResult, source: KnowledgeSource) -> HandlerResult | None:
        for result in aggregated.results:
            if result.source == source:
                return result
        return None
