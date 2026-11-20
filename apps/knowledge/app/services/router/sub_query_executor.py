import asyncio
import sys
import time

from loguru import logger

from app.core.config import Config
from app.core.context import pipeline_step
from app.core.llm_config import LLMConfig, create_chat_model
from app.models.chat import DurationKey
from app.services import language as language_service
from app.services.router.aggregator import ResultAggregator
from app.services.router.handler import KnowledgeHandler
from app.services.router.internal_handler import InternalKBHandler
from app.services.router.models import (
    HandlerResult,
    QueryContext,
    RouteDecision,
    SequentialExecutionResult,
    SubQuery,
    SubQueryResult,
)


class SubQueryExecutor:
    def __init__(
        self,
        enrichers: list[KnowledgeHandler],
        internal_handler: InternalKBHandler | None,
    ) -> None:
        self.enrichers = enrichers
        self.internal_handler = internal_handler
        self.config = Config()
        self.llm_config = LLMConfig()

        parallel = getattr(self.config, "router_parallel_execution", True)
        self.enricher_aggregator = ResultAggregator(self.enrichers, parallel=parallel)

    @staticmethod
    def _build_execution_layers(sub_queries: list[SubQuery]) -> list[list[int]]:
        """Group sub-query indices into dependency layers for parallel execution.

        Layer 0 contains sub-queries with no dependencies.
        Layer N contains sub-queries whose dependencies are all in layers < N.
        """
        total = len(sub_queries)
        resolved: set[int] = set()
        layers: list[list[int]] = []
        remaining = set(range(total))

        while remaining:
            layer = [idx for idx in sorted(remaining) if all(dep in resolved for dep in sub_queries[idx].dependencies)]
            if not layer:
                # circular or invalid dependencies — dump everything remaining into one layer
                logger.warning(
                    f"Unresolvable dependencies for sub-queries {sorted(remaining)}, forcing into single layer"
                )
                layer = sorted(remaining)
            layers.append(layer)
            resolved.update(layer)
            remaining -= set(layer)

        return layers

    async def execute(
        self,
        sub_queries: list[SubQuery],
        context: QueryContext,
        routes: list[RouteDecision],
    ) -> SequentialExecutionResult:
        """Execute sub-queries respecting dependency layers, parallelizing within each layer."""
        # all sub-queries should be independent — if the LLM still emits dependencies, clear them
        for sq in sub_queries:
            if sq.dependencies:
                logger.warning(f"Clearing unexpected dependencies {sq.dependencies} on sub-query: {sq.query[:80]}")
                sq.dependencies = []
        start_time = time.perf_counter()
        layers = self._build_execution_layers(sub_queries)
        results: list[SubQueryResult | None] = [None] * len(sub_queries)
        accumulated_facts: list[str] = []

        logger.info(
            f"Executing {len(sub_queries)} sub-queries in {len(layers)} layer(s): {[layer for layer in layers]}"
        )

        for layer_idx, layer in enumerate(layers):
            logger.info(f"Layer {layer_idx}: executing sub-queries {layer}")

            # collect facts from all resolved dependencies for this layer
            layer_facts = list(accumulated_facts)

            if len(layer) == 1:
                idx = layer[0]
                result = await self._run_single(sub_queries[idx], idx, context, routes, layer_facts)
                results[idx] = result
            else:
                layer_results = await asyncio.gather(
                    *[self._run_single(sub_queries[idx], idx, context, routes, layer_facts) for idx in layer]
                )
                for idx, result in zip(layer, layer_results, strict=False):
                    results[idx] = result

            # accumulate facts from this layer's results for use by subsequent layers
            for idx in layer:
                r = results[idx]
                if r and r.answer:
                    accumulated_facts.append(f"Q: {sub_queries[idx].query}\nA: {r.answer}")

        total_latency = (time.perf_counter() - start_time) * 1000
        final_results = [r for r in results if r is not None]

        logger.info(f"Parallel execution completed in {total_latency:.0f}ms ({len(layers)} layers)")

        return SequentialExecutionResult(
            results=final_results,
            total_latency_ms=total_latency,
        )

    async def _run_single(
        self,
        sub_query: SubQuery,
        idx: int,
        context: QueryContext,
        routes: list[RouteDecision],
        accumulated_facts: list[str],
    ) -> SubQueryResult:
        logger.info(f"Processing sub-query {idx}: {sub_query.query}")
        sub_query_start = time.perf_counter()

        with pipeline_step(DurationKey.sub_query(idx)):
            handler_results = await self._execute_sub_query(
                sub_query=sub_query,
                context=context,
                routes=routes,
                accumulated_facts=list(accumulated_facts),
                previous_results=[],
            )

            answer = await self._generate_answer_from_results(
                handler_results=handler_results,
                query=sub_query.query,
                language=context.detected_language,
                script=context.detected_script,
            )

        latency_ms = (time.perf_counter() - sub_query_start) * 1000
        return SubQueryResult(
            sub_query=sub_query,
            handler_results=handler_results,
            answer=answer,
            latency_ms=latency_ms,
        )

    async def execute_sequential(
        self,
        sub_queries: list[SubQuery],
        context: QueryContext,
        routes: list[RouteDecision],
    ) -> SequentialExecutionResult:
        start_time = time.perf_counter()
        results: list[SubQueryResult] = []
        accumulated_facts: list[str] = []

        logger.info(f"Executing {len(sub_queries)} sub-queries sequentially")

        for idx, sub_query in enumerate(sub_queries):
            logger.info(f"Processing sub-query {idx + 1}/{len(sub_queries)}: {sub_query.query}")

            sub_query_start = time.perf_counter()

            with pipeline_step(DurationKey.sub_query(idx)):
                handler_results = await self._execute_sub_query(
                    sub_query=sub_query,
                    context=context,
                    routes=routes,
                    accumulated_facts=accumulated_facts,
                    previous_results=results,
                )

                answer = await self._generate_answer_from_results(
                    handler_results=handler_results,
                    query=sub_query.query,
                    language=context.detected_language,
                    script=context.detected_script,
                )

            sub_query_latency = (time.perf_counter() - sub_query_start) * 1000

            result = SubQueryResult(
                sub_query=sub_query,
                handler_results=handler_results,
                answer=answer,
                latency_ms=sub_query_latency,
            )
            results.append(result)

            if answer:
                accumulated_facts.append(f"Q: {sub_query.query}\nA: {answer}")
                logger.debug(f"Sub-query {idx + 1} answer added to accumulated facts")

        total_latency = (time.perf_counter() - start_time) * 1000

        logger.info(f"Sequential execution completed in {total_latency:.2f}ms")

        return SequentialExecutionResult(
            results=results,
            total_latency_ms=total_latency,
        )

    async def _execute_sub_query(
        self,
        sub_query: SubQuery,
        context: QueryContext,
        routes: list[RouteDecision],
        accumulated_facts: list[str],
        previous_results: list[SubQueryResult],
    ) -> list[HandlerResult]:
        handler_results: list[HandlerResult] = []

        enricher_routes = [r for r in routes if r.source.value != "internal_kb"]

        if enricher_routes and self.enrichers:
            logger.debug(f"Running enrichers for sub-query: {[r.source.value for r in enricher_routes]}")
            enricher_aggregated = await self.enricher_aggregator.aggregate(
                sub_query.query,
                context,
                enricher_routes,
            )

            for result in enricher_aggregated.results:
                handler_results.append(result)
                if result.success and result.context_snippets:
                    accumulated_facts.extend(result.context_snippets)

        if self.internal_handler and self.internal_handler.is_enabled():
            logger.debug(f"Running InternalKB with {len(accumulated_facts)} accumulated facts")
            internal_result = await self.internal_handler.retrieve(
                sub_query.query,
                context,
                enrichment_facts=accumulated_facts,
                enable_rephrasing=True,
                enable_hyde=True,
            )
            handler_results.append(internal_result)

        return handler_results

    async def _generate_answer_from_results(
        self,
        handler_results: list[HandlerResult],
        query: str,
        language: str | None,
        script: str | None = None,
    ) -> str | None:
        successful_results = [r for r in handler_results if r.success and r.answer]

        if not successful_results:
            logger.warning(f"No successful results for sub-query: {query}")
            return None

        if len(successful_results) == 1:
            answer = successful_results[0].answer
            # sub-answers feed the synthesizer unlogged otherwise.
            # a claim in the final answer that no logged branch produced is undiagnosable without this.
            logger.info(f"Sub-query answered: query={query[:100]!r}, answer_preview={(answer or '')[:200]}")
            return answer

        logger.debug(f"Synthesizing answer from {len(successful_results)} sources")
        answer = await self._synthesize_answer(successful_results, query, language, script)
        if answer:
            logger.info(f"Sub-query answered: query={query[:100]!r}, answer_preview={answer[:200]}")
        return answer

    async def _synthesize_answer(
        self,
        results: list[HandlerResult],
        query: str,
        language: str | None,
        script: str | None = None,
    ) -> str | None:
        lang_lines = language_service.reply_language_instructions(language, script)
        language_instruction = "\n\n" + "\n".join(lang_lines) if lang_lines else ""

        source_answers = []
        for result in results:
            source_answers.append(f"- {result.answer}")

        answers_text = "\n".join(source_answers)

        prompt = f"""Based on the following answers from different sources, provide a single, coherent answer to the question.

Question: {query}

Answers:
{answers_text}

Provide a concise, unified answer that incorporates the most relevant information.{language_instruction}"""

        try:
            llm = create_chat_model(self.llm_config.llm_sub_query_executor, self.llm_config)
            response = await llm.ainvoke(prompt)
            return str(response.content)

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Failed to synthesize answer: {e}")
            return results[0].answer
