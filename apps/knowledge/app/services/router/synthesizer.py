import sys
from typing import Any

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.constants import (
    ABBREVIATION_EXPANSION_RULE,
    ANSWER_TARGET_MAX_CHARS,
    ATTRIBUTED_CLAIMS_RULE,
    HINDI_SCRIPT_RULES,
    NO_PERSONAL_RECOMMENDATIONS_RULE,
    PLAIN_TEXT_ONLY_INSTRUCTION,
    WEB_BOILERPLATE_FILTER_INSTRUCTION,
)
from app.core.errors import get_error_message
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import ainvoke_with_output_retry
from app.core.output_parsing import repair_garbled_json, strict_format_instructions
from app.models.chat import ErrorType
from app.services.router.models import AggregatedResult, HandlerResult, KnowledgeSource, SubQueryResult

NO_ANSWER_SYNTHESIS_STATUSES = frozenset({"no_subquery_results", "no_results"})
SUBQUERY_NOT_FOUND = "NOT FOUND - the sources contain no information for this sub-question"


def _script_rule(script: str | None) -> str:
    """Reply-script clause for the synthesis prompts, empty when the script is unknown.

    Only a non-latin script ever arrives here: the router drops Latn as the default the
    prompts already assume, and romanized Hindi rides on the hindi/hinglish rules block.
    """
    if not script:
        return ""
    return (
        f"\nYou MUST write the response in the {script} script (ISO 15924 code), "
        "which is the script the question was written in. "
        "Do NOT transliterate into another script, even if the sub-answers use one."
    )


class SynthesizedOutput(BaseModel):
    # only answer reaches the user, the rest is metadata
    # keeping metadata optional lets a garbled tail salvaged by parse_partial_json still yield the answer
    answer: str = Field(description="The synthesized answer combining information from all sources")
    sources_used: list[str] = Field(default_factory=list, description="List of sources that contributed to the answer")
    confidence: float | None = Field(default=None, description="Overall confidence in the synthesized answer (0-1)")


class ResponseSynthesizer:
    SYNTHESIS_PROMPT = (
        """
You are a response synthesis assistant. Your task is to combine answers from multiple knowledge sources into a single, coherent response.

## Source Answers

{source_answers}

## Original Question
{question}

## Language
The response should be in: {language}{script_rule}

## Hindi / Hinglish Script Rules
- """
        + HINDI_SCRIPT_RULES
        + """

## Instructions
1. Synthesize a unified answer that incorporates information from all successful sources
2. Resolve any contradictions by preferring more specific/authoritative information
2a. """
        + ABBREVIATION_EXPANSION_RULE
        + """
   A source answer that uses a bare acronym is not licence to spell it out here: if none of them expands it, neither do you.
2b. In the two rules below, the source answers are the passages. NO PERSONAL RECOMMENDATIONS: """
        + NO_PERSONAL_RECOMMENDATIONS_RULE
        + """
2c. ATTRIBUTED CLAIMS, NEUTRAL VOICE: """
        + ATTRIBUTED_CLAIMS_RULE
        + """
   Keep any attribution a source answer already makes (the outlet, organisation, or date it names); never drop it.
3. Do NOT explicitly mention source names in the answer - write naturally
4. If sources provide complementary information, combine them smoothly
5. If one source is clearly more relevant/accurate, prioritize it
"""
        + f"6. Keep the response concise but comprehensive: 2-4 sentences for simple questions, up to a short paragraph or two for complex ones. Aim to stay under {ANSWER_TARGET_MAX_CHARS} characters; do not over-explain unless explicitly asked.\n"
        + "7. "
        + PLAIN_TEXT_ONLY_INSTRUCTION
        + "\n8. "
        + WEB_BOILERPLATE_FILTER_INSTRUCTION
        + """

## Output Format
{output_format}
"""
    )

    SOURCE_LABELS = {
        KnowledgeSource.INTERNAL_KB: "Internal Knowledge Base",
        KnowledgeSource.YAGO: "Structured Facts Database",
        KnowledgeSource.WIKIPEDIA: "Encyclopedia",
    }

    def __init__(self) -> None:
        self.config = Config()
        self.llm_config = LLMConfig()

    async def synthesize(
        self,
        aggregated: AggregatedResult,
        query: str,
        language: str | None = None,
        script: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        successful_results = [r for r in aggregated.results if r.success and r.answer]

        if not successful_results:
            logger.warning("No successful results to synthesize")
            return self._no_answer_response(language), {"synthesis_status": "no_results"}

        if len(successful_results) == 1:
            result = successful_results[0]
            return result.answer or "", {
                "synthesis_status": "single_source",
                "primary_source": result.source.value,
                "confidence": result.confidence,
            }

        logger.info(f"Synthesizing response from {len(successful_results)} sources")
        synthesis_result: tuple[str, dict[str, Any]] = await self._synthesize_multiple(
            successful_results, query, language, script
        )
        return synthesis_result

    def _no_answer_response(self, language: str | None) -> str:
        return get_error_message(ErrorType.NO_ANSWER_AVAILABLE, language)

    @LLMCircuitBreaker()
    async def _synthesize_multiple(
        self,
        results: list[HandlerResult],
        query: str,
        language: str | None,
        script: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        source_answers_text = self._format_source_answers(results)

        prompt = PromptTemplate.from_template(self.SYNTHESIS_PROMPT)

        parser: PydanticOutputParser[SynthesizedOutput] = PydanticOutputParser(pydantic_object=SynthesizedOutput)
        output_format = strict_format_instructions(parser)

        model = create_chat_model(self.llm_config.llm_synthesizer, self.llm_config)

        try:
            result: SynthesizedOutput = await ainvoke_with_output_retry(
                {
                    "source_answers": source_answers_text,
                    "question": query,
                    "language": language or "the same language as the question",
                    "script_rule": _script_rule(script),
                    "output_format": output_format,
                },
                prompt=prompt,
                model=model,
                parser=parser,
                extra_after_strip=(repair_garbled_json,),
                component="Synthesizer",
            )

            metadata = {
                "synthesis_status": "multi_source",
                "sources_used": result.sources_used,
                "confidence": result.confidence,
                "source_count": len(results),
            }

            return result.answer, metadata

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Synthesis failed: {e}")
            return self._fallback_to_primary(results)

    def _format_source_answers(self, results: list[HandlerResult]) -> str:
        formatted_parts = []

        for result in results:
            source_label = self.SOURCE_LABELS.get(result.source, result.source.value)
            confidence_str = f"{result.confidence:.0%}" if result.confidence else "unknown"

            part = f"""### {source_label} (confidence: {confidence_str})
{result.answer}
"""
            formatted_parts.append(part)

        return "\n".join(formatted_parts)

    def _fallback_to_primary(self, results: list[HandlerResult]) -> tuple[str, dict[str, Any]]:
        sorted_results = sorted(results, key=lambda r: r.confidence, reverse=True)
        primary = sorted_results[0]

        return primary.answer or "", {
            "synthesis_status": "fallback_single",
            "primary_source": primary.source.value,
            "confidence": primary.confidence,
            "fallback_reason": "synthesis_failed",
        }

    def should_synthesize(self, aggregated: AggregatedResult) -> bool:
        successful_count = sum(1 for r in aggregated.results if r.success and r.answer)
        return successful_count > 1

    async def synthesize_from_subqueries(
        self,
        original_query: str,
        sub_results: list[SubQueryResult],
        language: str | None = None,
        script: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        answered = [r for r in sub_results if r.answer]

        if not answered:
            logger.warning("No successful sub-query results to synthesize")
            return self._no_answer_response(language), {
                "synthesis_status": "no_subquery_results",
                "subquery_count": len(sub_results),
                "subquery_answered_count": 0,
            }

        status = "multi_subquery" if len(answered) == len(sub_results) else "partial_subquery"
        logger.info(f"Synthesizing final answer from {len(answered)}/{len(sub_results)} sub-query results")
        synthesized: tuple[str, dict[str, Any]] = await self._synthesize_subquery_results(
            original_query, sub_results, language, script, status
        )
        return synthesized

    @LLMCircuitBreaker()
    async def _synthesize_subquery_results(
        self,
        original_query: str,
        sub_results: list[SubQueryResult],
        language: str | None,
        script: str | None = None,
        synthesis_status: str = "multi_subquery",
    ) -> tuple[str, dict[str, Any]]:
        subquery_answers_text = self._format_subquery_answers(sub_results)

        prompt_template = (
            """
You are a response synthesis assistant. Your task is to combine answers from multiple sub-queries into a single, coherent response to the original question.

## Original Question
{original_query}

## Sub-Query Results
{subquery_answers}

## Language
The response should be in: {language}{script_rule}

## Hindi / Hinglish Script Rules
- """
            + HINDI_SCRIPT_RULES
            + """

## Instructions
1. Synthesize a unified answer that addresses the ORIGINAL question using information from all sub-queries
2. If a sub-query result is marked NOT FOUND, state plainly (in the reply language) which part of the original question could not be answered from the sources. Never invent that missing information from general knowledge, training data, or inference, and never offer to provide it from general knowledge - the sources are the only permitted basis for anything you say.
3. Integrate the answered sub-queries naturally - don't list them separately
3a. """
            + ABBREVIATION_EXPANSION_RULE
            + """
   A sub-answer that uses a bare acronym is not licence to spell it out here: if none of them expands it, neither do you.
3b. In the two rules below, the sub-query results are the passages. NO PERSONAL RECOMMENDATIONS: """
            + NO_PERSONAL_RECOMMENDATIONS_RULE
            + """
3c. ATTRIBUTED CLAIMS, NEUTRAL VOICE: """
            + ATTRIBUTED_CLAIMS_RULE
            + """
   Keep any attribution a sub-answer already makes (the outlet, organisation, or date it names); never drop it.
3d. Add nothing a sub-answer does not state: no advice, conclusions, or "general guidance" of your own, however reasonable it sounds.
4. Maintain logical flow and coherence
5. SCOPE FIDELITY: if a sub-answer's guidance is explicitly limited to a stated range or condition (an age, stage, quantity, duration, date, or eligibility window) and the original question states a value OUTSIDE that range, do NOT present that guidance as applying to the user — state its limit instead. When listing options or methods, include ONLY those whose stated scope covers the user's stated value; omit excluded options entirely unless the user explicitly asked about them. For sensitive topics (health, medication, medical procedures, legal matters, finances, personal safety), apply this strictly: never adapt or extrapolate out-of-scope instructions to the user's stated situation; if a sub-answer recommends a different course for that situation (such as seeking trained or professional support), lead with that recommendation.
"""
            + f"6. Keep the response concise but comprehensive: 2-4 sentences for simple questions, up to a short paragraph or two for complex ones. Aim to stay under {ANSWER_TARGET_MAX_CHARS} characters; do not over-explain unless explicitly asked.\n"
            + """7. Do NOT mention "sub-query" or "first I found" etc. - write as if answering the original question directly
8. """
            + PLAIN_TEXT_ONLY_INSTRUCTION
            + "\n9. "
            + WEB_BOILERPLATE_FILTER_INSTRUCTION
            + """

## Output Format
{output_format}
"""
        )

        prompt = PromptTemplate.from_template(prompt_template)

        parser: PydanticOutputParser[SynthesizedOutput] = PydanticOutputParser(pydantic_object=SynthesizedOutput)
        output_format = strict_format_instructions(parser)

        model = create_chat_model(self.llm_config.llm_synthesizer, self.llm_config)

        try:
            result: SynthesizedOutput = await ainvoke_with_output_retry(
                {
                    "original_query": original_query,
                    "subquery_answers": subquery_answers_text,
                    "language": language or "the same language as the question",
                    "script_rule": _script_rule(script),
                    "output_format": output_format,
                },
                prompt=prompt,
                model=model,
                parser=parser,
                extra_after_strip=(repair_garbled_json,),
                component="Synthesizer",
            )

            metadata = {
                "synthesis_status": synthesis_status,
                "subquery_count": len(sub_results),
                "subquery_answered_count": sum(1 for r in sub_results if r.answer),
                "confidence": result.confidence,
            }

            return result.answer, metadata

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Sub-query synthesis failed: {e}")
            return self._fallback_to_concatenation(sub_results)

    def _format_subquery_answers(self, sub_results: list[SubQueryResult]) -> str:
        formatted_parts = []

        for idx, result in enumerate(sub_results, 1):
            answer_text = result.answer if result.answer else SUBQUERY_NOT_FOUND
            part = f"""### Sub-Query {idx}: {result.sub_query.query}
Answer: {answer_text}
Reasoning: {result.sub_query.reasoning}
"""
            formatted_parts.append(part)

        return "\n".join(formatted_parts)

    def _fallback_to_concatenation(self, sub_results: list[SubQueryResult]) -> tuple[str, dict[str, Any]]:
        answers = [result.answer for result in sub_results if result.answer]
        combined = " ".join(answers)

        return combined, {
            "synthesis_status": "fallback_concatenation",
            "subquery_count": len(sub_results),
            "subquery_answered_count": len(answers),
            "fallback_reason": "synthesis_failed",
        }
