import sys
from datetime import date

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.output_parsing import (
    ainvoke_with_empty_content_retry,
    repair_garbled_json,
    strict_format_instructions,
    strip_reasoning,
)
from app.services.router.classifier import (
    LLMClassificationOutput,
    QueryClassifier,
    is_degenerate_llm_classification,
    location_verdict_pending,
)
from app.services.router.decomposer import LLMDecompositionOutput, QueryDecomposer
from app.services.router.models import (
    ClassificationResult,
    DecompositionResult,
    KnowledgeSource,
    QueryContext,
    QueryIntent,
    RouteDecision,
)
from app.services.router.prompts import (
    DECOMPOSITION_GUIDELINES,
    ELECTION_RESULTS_DETECTION,
    INTENT_CLASSIFICATION,
    LOCATION_ONLY_REPLY,
    METAQUESTION,
    ROLE_DESCRIPTION_DETECTION,
    SCENARIO_INTENT_DETECTION,
    SOURCE_ROUTING,
    SYNTHESIS_DETECTION,
    TEMPORAL_CLASSIFICATION,
    USER_LOCATION_DEPENDENCE,
    VOTE_RECOMMENDATION_DETECTION,
    WHEN_TO_DECOMPOSE,
)


class LLMUnifiedClassificationDecompositionOutput(BaseModel):
    """Nested output for the unified Classifier+Decomposer LLM call."""

    classification: LLMClassificationOutput = Field(
        description="Classification decision: intent, routing, temporal, metaquestion, synthesis."
    )
    decomposition: LLMDecompositionOutput = Field(
        description="Decomposition decision: whether to split the query, and the sub-queries if so."
    )


class UnifiedClassifierDecomposer:
    """Single-LLM-call replacement for QueryClassifier + QueryDecomposer.

    Reuses the existing classifier's heuristics so cheap short-circuits still
    apply, and reuses its temporal/synthesis parsing helpers to keep behavior
    identical for the classification half.
    """

    UNIFIED_PROMPT = (
        """
You are a query routing assistant. You MUST produce a single JSON object with exactly two top-level keys:
- "classification" — the classification decision
- "decomposition"  — the decomposition decision

Fill every required field in both sub-objects. For observability, include a SHORT `reasoning` (one clause, max ~12 words) on BOTH `classification` and `decomposition`. Do NOT add a `reasoning` to individual sub-queries — keep those compact.

CRITICAL: the `classification` object must ALWAYS be complete, for EVERY query. Never omit a classification field because an intent makes it seem "not applicable" (synthesis, metaquestion, non-question, etc.) — in those cases still emit the field with its neutral value: `"sources": []`, `"confidences": []`, `"temporal_type": "none"`, `"message_script": "unknown"`, and explicit booleans. In particular, when you decide `is_synthesis` or `is_metaquestion` is true, you must still OUTPUT that boolean plus all other classification fields.

You have thirteen jobs:
1. Decide if this is a genuine question/inquiry or just a greeting/acknowledgment/filler
2. Detect speak-to-person or purchase/subscribe personalization scenario intent
3. Detect if the user is asking about the assistant's identity / capabilities
4. Detect if the user is asking a meta-question about the system itself
5. Detect if the user is asking the assistant to decide a political choice for them (whom or what to vote for)
6. Detect if the user is asking about the outcome of an election, referendum, or ballot measure
7. Detect if the answer depends on where the user is while the query does not say where
8. Detect if the user wants a broad digest/recap/summary of recent events
9. Identify the ISO 639-1 language AND the ISO 15924 script the query text is written in (judge only by the text, never by names or topics it mentions); set classification.message_language and classification.message_script. These are independent: romanized Hindi ("kya hua?") is message_language "hi" with message_script "Latn", while "क्या हुआ?" is "hi" with "Deva"
10. If it's a question, decide which knowledge sources should be queried
11. Detect any temporal (time-sensitive) intent in the question
12. Decide whether the question should be decomposed into simpler sub-queries
13. Detect if the query does nothing but say where the user is

---

# Part A — classification.*

"""
        + INTENT_CLASSIFICATION
        + """

"""
        + SCENARIO_INTENT_DETECTION
        + """

"""
        + ROLE_DESCRIPTION_DETECTION
        + """

"""
        + METAQUESTION
        + """

"""
        + VOTE_RECOMMENDATION_DETECTION
        + """

"""
        + ELECTION_RESULTS_DETECTION
        + """

"""
        + USER_LOCATION_DEPENDENCE
        + """

"""
        + LOCATION_ONLY_REPLY
        + """

"""
        + SYNTHESIS_DETECTION
        + """

"""
        + SOURCE_ROUTING
        + """

"""
        + TEMPORAL_CLASSIFICATION
        + """

## classification.reasoning
Set `classification.reasoning` to a SHORT phrase (max ~12 words) explaining the decision. Keep it terse — it is for logging, not prose.

---

# Part B — decomposition.*

ALWAYS set `decomposition.should_decompose` (bool), `decomposition.sub_queries` (list), and a SHORT `decomposition.reasoning` (max ~12 words).

## No-op branches (MUST be used when any of these hold)

If `classification.is_question` is false, OR `classification.is_speak_to_person` is true, OR `classification.is_purchase_subscribe` is true, OR `classification.is_role_description` is true, OR `classification.is_metaquestion` is true, OR `classification.is_vote_recommendation` is true, OR `classification.election_question_kind` is "vote_outcome", OR `classification.is_synthesis` is true, you MUST set:
```
decomposition = {{
  "should_decompose": false,
  "sub_queries": [],
  "reasoning": "Not applicable for this intent"
}}
```

## Otherwise: decide whether to decompose

"""
        + WHEN_TO_DECOMPOSE
        + """

"""
        + DECOMPOSITION_GUIDELINES
        + """

Each entry in `decomposition.sub_queries` is an object with keys:
- `"query"` (string; must be self-contained and independently searchable)
- `"dependencies"` (always an empty list — all sub-queries run in parallel)

---

## Query to Classify
{query}
{history_context}
## Context
Today's date: {today}
Hub ID: {hub_id}
Provisional detected language (statistical guess, may be wrong): {language}

## Routing confidence
- `internal_kb` is included with at least 0.3 confidence for organization-related queries; `yago` is included with high confidence for factual entity queries.

## Output Format
{output_format}
"""
    )

    def __init__(self) -> None:
        self.config = Config()
        self.llm_config = LLMConfig()
        self._classifier = QueryClassifier()

    def is_non_question(self, query: str) -> bool:
        return self._classifier.is_non_question(query)

    async def analyze(
        self,
        query: str,
        context: QueryContext,
    ) -> tuple[ClassificationResult, DecompositionResult]:
        heuristic_result = self._classifier._classify_with_heuristics(query)
        if heuristic_result is not None and location_verdict_pending(heuristic_result, context):
            logger.debug("Unified classifier-decomposer: heuristic verdict cannot judge location dependence; using LLM")
            heuristic_result = None
        if heuristic_result is not None:
            logger.debug(f"Unified classifier-decomposer: heuristics matched, intent={heuristic_result.intent.value}")
            heuristic_result.person_entities = await self._classifier._extract_person_names(query, context)
            return heuristic_result, DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning="Heuristic short-circuit; no decomposition needed",
            )

        try:
            classification, decomposition = await self._analyze_with_llm(query, context)
            classification.person_entities = await self._classifier._extract_person_names(query, context)
            return classification, decomposition
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Unified classifier-decomposer failed: {e}")
            classification = ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=[
                    RouteDecision(
                        source=KnowledgeSource.INTERNAL_KB,
                        confidence=0.5,
                        priority=0,
                        reasoning="Unified LLM call failed, defaulting to internal KB",
                    )
                ],
                used_llm=True,
                reasoning=f"Unified classifier-decomposer error: {e}",
                person_entities=await self._classifier._extract_person_names(query, context),
            )
            decomposition = DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning=f"Unified classifier-decomposer error: {e}",
            )
            return classification, decomposition

    @LLMCircuitBreaker()
    async def _analyze_with_llm(
        self,
        query: str,
        context: QueryContext,
    ) -> tuple[ClassificationResult, DecompositionResult]:
        prompt = PromptTemplate.from_template(self.UNIFIED_PROMPT)

        parser: PydanticOutputParser[LLMUnifiedClassificationDecompositionOutput] = PydanticOutputParser(
            pydantic_object=LLMUnifiedClassificationDecompositionOutput
        )
        output_format = strict_format_instructions(parser)

        model = create_chat_model(
            self.llm_config.llm_classifier_decomposer,
            self.llm_config,
            timeout_seconds=self.llm_config.llm_router_timeout_seconds,
            max_retries=self.llm_config.llm_router_max_retries,
            # routing degrades gracefully to the internal kb route; a bedrock retry would only add tail latency
            bedrock_fallback=False,
        )

        prompt_chain = prompt | model

        # include recent conversation history so the classifier can resolve
        # pronouns and references when running on the original (unrewritten) query
        history_context = ""
        if context.history:
            lines = []
            for msg in context.history[-3:]:
                content = msg.content[:500] if len(msg.content) > 500 else msg.content
                lines.append(f"  {msg.role.value}: {content}")
            history_context = (
                "\n## Recent Conversation History\n"
                "Use this to resolve pronouns and references in the query above:\n" + "\n".join(lines) + "\n"
            )

        invoke_kw = {
            "query": query,
            "history_context": history_context,
            "today": date.today().isoformat(),
            "hub_id": context.hub_id,
            "language": context.detected_language or "unknown",
            "output_format": output_format,
        }

        result: LLMUnifiedClassificationDecompositionOutput | None = None
        for attempt in range(2):
            ai_message, content = await ainvoke_with_empty_content_retry(
                prompt_chain, invoke_kw, component="Unified classifier-decomposer"
            )

            if not content.strip():
                logger.warning("Unified classifier-decomposer LLM returned empty content after retry; using fallback")
                classification = ClassificationResult(
                    intent=QueryIntent.QUESTION,
                    routes=[
                        RouteDecision(
                            source=KnowledgeSource.INTERNAL_KB,
                            confidence=0.5,
                            priority=0,
                            reasoning="Unified LLM returned empty content, defaulting to internal KB",
                        )
                    ],
                    used_llm=True,
                    reasoning="Unified LLM returned empty content",
                )
                decomposition = DecompositionResult(
                    should_decompose=False,
                    sub_queries=[],
                    reasoning="Unified LLM returned empty content; skipping decomposition",
                )
                return classification, decomposition

            result = parser.invoke(repair_garbled_json.invoke(strip_reasoning.invoke(ai_message)))
            if not is_degenerate_llm_classification(result.classification):
                break
            # retry once on a no-verdict payload; if it persists build_result_from_llm degrades to the fallback route
            logger.warning(
                f"Unified classifier-decomposer returned a degenerate classification on attempt "
                f"{attempt + 1}/2 (fields present: {sorted(result.classification.model_fields_set)})"
            )
        if result is None:
            # unreachable: the loop either assigned result or returned the empty-content fallback
            raise RuntimeError("Unified classifier-decomposer retry loop ended without a result")

        classification = QueryClassifier.build_result_from_llm(query, result.classification)
        decomposition = self._build_decomposition_result(query, result, classification)

        return classification, decomposition

    def _build_decomposition_result(
        self,
        query: str,
        result: LLMUnifiedClassificationDecompositionOutput,
        classification: ClassificationResult,
    ) -> DecompositionResult:
        if classification.intent != QueryIntent.QUESTION:
            return DecompositionResult(
                should_decompose=False,
                sub_queries=[],
                reasoning=f"Intent is {classification.intent.value}; decomposition not applicable",
            )

        return QueryDecomposer.build_result_from_llm(
            query,
            result.decomposition,
            enabled=self.config.router_enable_decomposition,
            max_subqueries=self.config.router_decomposition_max_subqueries,
        )
