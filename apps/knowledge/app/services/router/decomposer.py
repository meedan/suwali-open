import sys
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.output_parsing import ainvoke_with_empty_content_retry, strict_format_instructions, strip_reasoning
from app.services.router.models import (
    ClassificationResult,
    DecompositionResult,
    QueryContext,
    QueryIntent,
    SubQuery,
)
from app.services.router.prompts import DECOMPOSITION_GUIDELINES, WHEN_TO_DECOMPOSE

MIN_WORDS_FOR_DECOMPOSITION = 8


class LLMDecompositionOutput(BaseModel):
    should_decompose: bool = Field(description="Whether the query needs to be decomposed")
    sub_queries: list[dict[str, Any]] = Field(
        default_factory=list,
        description="List of sub-queries with 'query' and 'dependencies' (list of indices)",
    )
    reasoning: str = Field(
        default="", description="Short phrase (max ~12 words) explaining the decomposition decision, for logging"
    )


class QueryDecomposer:
    """
    Analyzes queries to determine if they should be decomposed into simpler sub-queries.
    """

    DECOMPOSITION_PROMPT = (
        """
You are a query decomposition assistant. Your task is to analyze a user's question and determine if it should be broken down into simpler sub-queries.

"""
        + WHEN_TO_DECOMPOSE
        + """

## Query to Analyze

**Original Query**: {query}

**Context**:
- Hub ID: {hub_id}
- Language: {language}
- Knowledge Sources Available: {sources}

## Decomposition Guidelines

"""
        + DECOMPOSITION_GUIDELINES
        + """

## Output Format

{output_format}

## Examples

### Example 1: Multi-Intent (SHOULD DECOMPOSE)
Query: "Who founded Tesla and where were they born?"
Output:
- should_decompose: true
- sub_queries:
  1. {{"query": "Who founded Tesla?", "reasoning": "Identify the founder(s)", "dependencies": []}}
  2. {{"query": "Where was the founder of Tesla born?", "reasoning": "Find the birthplace of the founder — self-contained, no pronoun", "dependencies": []}}
- reasoning: "Multi-intent query requiring two separate lookups"

### Example 2: Temporal Comparison (SHOULD DECOMPOSE)
Query: "Compare our revenue in 2022 vs 2023"
Output:
- should_decompose: true
- sub_queries:
  1. {{"query": "What was our revenue in 2022?", "reasoning": "Get 2022 revenue", "dependencies": []}}
  2. {{"query": "What was our revenue in 2023?", "reasoning": "Get 2023 revenue", "dependencies": []}}
- reasoning: "Temporal comparison requiring separate lookups for each time period"

### Example 3: Simple Query (SHOULD NOT DECOMPOSE)
Query: "What is our refund policy?"
Output:
- should_decompose: false
- sub_queries: []
- reasoning: "Simple single-intent query, no decomposition needed"

### Example 4: Single Entity (SHOULD NOT DECOMPOSE)
Query: "Tell me about Albert Einstein's life"
Output:
- should_decompose: false
- sub_queries: []
- reasoning: "Single entity query, can be answered directly"
"""
    )

    def __init__(self) -> None:
        self.config = Config()
        self.llm_config = LLMConfig()

    @staticmethod
    def build_result_from_llm(
        query: str,
        out: LLMDecompositionOutput,
        *,
        enabled: bool,
        max_subqueries: int,
    ) -> DecompositionResult:
        """Translate an LLMDecompositionOutput into a DecompositionResult.

        Applies config gate, short-query gate, should_decompose gate, sub-query mapping
        and max-subqueries truncation. Shared by the standalone decomposer and the
        unified classifier-decomposer.
        """
        if not enabled:
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning="Decomposition disabled in configuration",
            )

        if len(query.split()) < MIN_WORDS_FOR_DECOMPOSITION:
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning="Query too short to benefit from decomposition",
            )

        if not out.should_decompose:
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning=out.reasoning or "LLM decided no decomposition needed",
            )

        sub_queries: list[SubQuery] = []
        for sq_dict in out.sub_queries:
            sub_queries.append(
                SubQuery(
                    query=sq_dict.get("query", ""),
                    reasoning=sq_dict.get("reasoning", ""),
                    dependencies=sq_dict.get("dependencies", []),
                )
            )

        if len(sub_queries) > max_subqueries:
            logger.warning(f"LLM proposed {len(sub_queries)} sub-queries, limiting to {max_subqueries}")
            sub_queries = sub_queries[:max_subqueries]

        return DecompositionResult(
            should_decompose=True,
            sub_queries=sub_queries,
            reasoning=out.reasoning,
        )

    async def analyze(
        self,
        query: str,
        context: QueryContext,
        classification: ClassificationResult,
    ) -> DecompositionResult:
        if classification.intent != QueryIntent.QUESTION:
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning=f"Intent is {classification.intent.value}; decomposition not applicable",
            )

        if not self.config.router_enable_decomposition:
            logger.debug("Query decomposition disabled via config")
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning="Decomposition disabled in configuration",
            )

        if len(query.split()) < MIN_WORDS_FOR_DECOMPOSITION:
            logger.debug(f"Query too short for decomposition: {len(query.split())} words")
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning="Query too short to benefit from decomposition",
            )

        try:
            llm_out = await self._analyze_with_llm(query, context, classification)
            if llm_out is None:
                return DecompositionResult(
                    should_decompose=False,
                    sub_queries=[],
                    reasoning="LLM returned empty content, skipping decomposition",
                )

            result = QueryDecomposer.build_result_from_llm(
                query,
                llm_out,
                enabled=self.config.router_enable_decomposition,
                max_subqueries=self.config.router_decomposition_max_subqueries,
            )

            if result.should_decompose:
                logger.info(f"Query will be decomposed into {len(result.sub_queries)} sub-queries")
            else:
                logger.debug("Query does not need decomposition")

            return result

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Query decomposition analysis failed: {e}")
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning=f"Decomposition analysis failed: {e}",
            )

    @LLMCircuitBreaker()
    async def _analyze_with_llm(
        self,
        query: str,
        context: QueryContext,
        classification: ClassificationResult,
    ) -> LLMDecompositionOutput | None:
        prompt = PromptTemplate.from_template(self.DECOMPOSITION_PROMPT)

        parser: PydanticOutputParser[LLMDecompositionOutput] = PydanticOutputParser(
            pydantic_object=LLMDecompositionOutput
        )
        output_format = strict_format_instructions(parser)

        model = create_chat_model(self.llm_config.llm_decomposer, self.llm_config)

        sources = [route.source.value for route in classification.routes]

        prompt_chain = prompt | model
        invoke_kw = {
            "query": query,
            "hub_id": context.hub_id,
            "language": context.detected_language or "unknown",
            "sources": ", ".join(sources),
            "output_format": output_format,
        }

        ai_message, content = await ainvoke_with_empty_content_retry(prompt_chain, invoke_kw, component="Decomposer")

        if not content.strip():
            logger.warning(
                "Decomposer LLM returned empty content after retry; skipping decomposition "
                f"(completion_tokens="
                f"{ai_message.response_metadata.get('token_usage', {}).get('completion_tokens', '?') if ai_message else '?'})"
            )
            return None

        result: LLMDecompositionOutput = parser.invoke(strip_reasoning.invoke(ai_message))
        return result
