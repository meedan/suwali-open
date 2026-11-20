import re
import sys
from datetime import date

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import ainvoke_with_output_retry
from app.core.output_parsing import strict_format_instructions
from app.services import language
from app.services.router.extractor import get_entity_extractor
from app.services.router.models import (
    ClassificationResult,
    KnowledgeSource,
    QueryContext,
    QueryIntent,
    RouteDecision,
    SynthesisContext,
    SynthesisType,
    TemporalContext,
    TemporalType,
)
from app.services.router.prompts import (
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
)

_COMPOUND_CLAUSE_PATTERNS = (
    re.compile(
        r"\b(?:also|additionally|then)\s*,\s*(?:what|who|when|where|how|why|which)\b",
        re.IGNORECASE,
    ),
    # "<question> and <second question>?" carries a single "?"
    # without this the heuristics would answer it as one query and the decomposer would never see it
    re.compile(
        r"\b(?:and|or)\s+(?:what|who|when|where|how|why|which)\s+\w",
        re.IGNORECASE,
    ),
)


def location_verdict_pending(result: ClassificationResult, context: QueryContext) -> bool:
    """A question verdict reached without the llm cannot say whether the answer depends on where the user is.

    The router refuses such a question while the conversation holds no location note, so wherever that
    gate is live (the hub has the location gate on and no note yet) only the llm may judge a question,
    whatever the classifier flag says: the feature is an llm feature. Non-question and scenario shortcuts
    carry no such verdict and stay cheap; once a note exists the gate is off and the fast path returns.
    """
    return (
        result.intent == QueryIntent.QUESTION
        and bool(context.location_gate_enabled)
        and not context.conversation_context
    )


def _compound_query_prefers_llm_classifier(query: str) -> bool:
    q = query.strip()
    if q.count("?") > 1:
        return True
    return any(pattern.search(q) for pattern in _COMPOUND_CLAUSE_PATTERNS)


class LLMClassificationOutput(BaseModel):
    is_question: bool = Field(
        default=True,
        description="True if this is a question/inquiry needing an answer, False for greetings/thanks/farewells etc.",
    )
    sources: list[str] = Field(
        default_factory=list,
        description=(
            "List of knowledge sources to query, from: 'internal_kb', 'yago'. "
            "Use an empty list when source routing is not applicable (non-question, synthesis, metaquestion, etc.)."
        ),
    )
    confidences: list[float] = Field(
        default_factory=list,
        description="Confidence scores (0-1) for each source, same order as `sources`. Empty list when `sources` is empty.",
    )
    reasoning: str = Field(
        default="", description="Short phrase (max ~12 words) explaining the classification decision, for logging"
    )
    temporal_type: str = Field(
        default="none",
        description="Temporal intent: 'none', 'recency' (wants latest info), or 'point_in_time' (asks about specific date/period)",
    )
    temporal_reference_date: str | None = Field(
        default=None,
        description=(
            "For point_in_time queries: the date the query refers to, at the most specific precision: "
            "year only ('2024'), year-month ('2024-03'), or full date ('2024-03-15'). Null otherwise. "
            "Always a SINGLE date, never an interval or range like '2023-01/2023-06' - for a period, "
            "pick its midpoint at the coarsest precision that covers it."
        ),
    )
    recency_window_days: int | None = Field(
        default=None,
        description=(
            "Only when temporal_type is 'recency': optional hard retrieval window — last N calendar days "
            "through today (inclusive). Use 1 ONLY for explicit same-day anchors ('today', 'right now', "
            "'as of today', 'this morning'). Use 7 for 'this week' / 'last few days'. Use 30 for "
            "'this month' / 'past month'. "
            "IMPORTANT: Statistical terms like 'current', 'latest', or 'most recent' (e.g. unemployment rate, "
            "inflation, GDP, prices, population) usually refer to the most up-to-date available data, not "
            "strictly to the current day. In these cases, prefer leaving recency_window_days null unless the "
            "user explicitly refers to a same-day timeframe (e.g. 'today', 'right now', 'this morning'). "
            "Avoid setting recency_window_days=1 for statistical queries unless the query clearly requires "
            "same-day data."
        ),
    )
    is_speak_to_person: bool = Field(
        default=False,
        description="True when the user wants to speak to a human, real person, agent, or customer support.",
    )
    is_purchase_subscribe: bool = Field(
        default=False,
        description=(
            "True when the user wants to buy, subscribe to, or learn how to obtain the organization's "
            "products or services (including 'know more about your services'). False for unrelated factual questions."
        ),
    )
    is_role_description: bool = Field(
        default=False,
        description="True if the query asks about the assistant's own identity, purpose, capabilities, or what the user can ask about (e.g. 'who are you?', 'what can you do?', 'what can I ask about?'). These are answered with a description, not refused.",
    )
    is_metaquestion: bool = Field(
        default=False,
        description="True if the query is ABOUT the system/bot itself, its sources as a whole, its reasoning process, or asks for aggregate counts/exhaustive listings of content. False for factual questions answerable from the sources — including questions about Suwali the product ('What is Suwali?'), which the knowledge base may cover — and false for identity/capability questions (use is_role_description for those).",
    )
    is_vote_recommendation: bool = Field(
        default=False,
        description=(
            "True when the user asks the assistant to decide a political choice for them: whom or what to vote "
            "for, support, or pick, which candidate, party, or ballot option is better for them or their group, "
            "or to confirm that an option suits people like them. False for neutral questions about who is "
            "running, what the options say or have done, how they differ, or how, where, and when to vote."
        ),
    )
    election_question_kind: str = Field(
        default="none",
        description=(
            "vote_outcome: how the votes went between candidates, parties, or options in a political vote: who won "
            "or was elected, the votes, percentage, margin, or seats one got, or whether a measure passed. "
            "other_election_topic: anything else about elections, such as turnout, overviews, fraud claims, "
            "candidates, polls, and how, where, or when to vote. non_political_contest: who won a sports, award, "
            "or other non-political contest. none: everything else, including who holds or held an office."
        ),
    )
    needs_user_location: bool = Field(
        default=False,
        description=(
            "True only when the correct answer would differ for users in different places and the query does not "
            'name a place (e.g. "Where can I vote?", "Is there a clinic near me?", a question about the user\'s own '
            "deadline, office, or obligations). False when the query names its place or the answer is the same "
            "everywhere. Also false when the query names its own subject (a person, an organisation, or an identified "
            'measure, bill, proposition, ballot question or amendment such as "State Question 847"): that thing is the '
            "same wherever the user is, so the answer does not depend on their location."
        ),
    )
    is_location_only: bool = Field(
        default=False,
        description=(
            "True only when the query does nothing but say where the user is (a bare place name, abbreviation, "
            "postcode, or any mix of city, county, state and postcode, or a statement like 'I live in Nairobi'), "
            "with a greeting at most. False when it also asks or requests anything."
        ),
    )
    is_synthesis: bool = Field(
        default=False,
        description="True ONLY if the query explicitly uses digest/summary language (e.g. 'summarize', 'recap', 'top news', 'catch me up', 'what happened this week', 'tell me all you know about X', 'overview of X'). False for everything else including general knowledge and specific factual questions.",
    )
    synthesis_type: str | None = Field(
        default=None,
        description=(
            "When is_synthesis is true, the synthesis sub-mode: 'temporal' for time-scoped recaps "
            "(explicit time anchor like 'this week') or 'topical' for topic/entity-scoped overviews "
            "('tell me all you know about X'). Null/ignored when is_synthesis is false."
        ),
    )
    synthesis_time_window_days: int | None = Field(
        default=None,
        description="For temporal synthesis: estimated time window in days (1=today, 7=week, 30=month). Null for topical or when not synthesis.",
    )
    synthesis_topic: str | None = Field(
        default=None,
        description="For topical synthesis: the bare topic/entity phrase (e.g. 'Iran', 'the 2008 financial crisis'). Null otherwise.",
    )
    message_language: str = Field(
        default="unknown",
        description=(
            'ISO 639-1 code of the language the query text is written in, or "unknown". '
            "Judge only by the text itself, never by names, places, or topics it mentions."
        ),
    )
    message_script: str = Field(
        default="unknown",
        description=(
            'ISO 15924 code of the script the query text is written in, or "unknown". '
            'Use "Latn" for the Latin alphabet and "Deva" for Devanagari. '
            "Judge only by the characters used, independently of message_language: "
            'romanized Hindi is message_language "hi" with message_script "Latn".'
        ),
    )


# a completion omitting every one of these fields answered nothing, however valid it looks once defaults fill in
_INTENT_ROUTING_FIELDS = frozenset(
    {
        "is_question",
        "sources",
        "is_speak_to_person",
        "is_purchase_subscribe",
        "is_role_description",
        "is_metaquestion",
        "is_vote_recommendation",
        "election_question_kind",
        "is_synthesis",
    }
)


def is_degenerate_llm_classification(output: LLMClassificationOutput) -> bool:
    """True when the payload contained none of the intent/routing fields.

    All fields default since the sparse-payload regression (Aug 2026), so a clobbered completion
    validates into an all-defaults shape instead of raising. model_fields_set separates fields
    present in the payload from defaulted ones, so legitimately sparse outputs still pass.
    """
    return not (_INTENT_ROUTING_FIELDS & output.model_fields_set)


class QueryClassifier:
    # structured factual lookups — may need external KB enrichment.
    # only facts fixed at a moment in history belong here, because a heuristic match pins temporal_type to NONE.
    # questions about a mutable present state must fall through to the LLM classifier, which tags them as recency.
    STRUCTURED_KB_PATTERNS = [
        r"\bwho\s+(founded|created|invented|discovered|wrote)\b",
        r"\bwhen\s+was\s+\w+\s+(born|founded|created|established|released)\b",
        r"\bwhere\s+(is|was)\s+\w+\s+(born|located|headquartered|founded)\b",
        r"\bwhat\s+is\s+the\s+(capital|population|area|currency)\s+of\b",
        r"\bwho\s+is\s+the\s+author\s+of\b",
    ]

    # org-internal phrasing that signals the user is asking about their own data
    DOMAIN_SPECIFIC_PATTERNS = [
        r"\bour\s+(company|organization|team|product|service)\b",
        r"\binternal\s+(policy|procedure|guideline)\b",
        r"\baccording\s+to\s+(our|the)\s+documentation\b",
        r"\bin\s+our\s+(system|database|records)\b",
    ]

    SPEAK_TO_PERSON_PATTERNS = [
        r"\b(?:speak|talk)\s+(?:to|with)\s+(?:an?\s+)?(?:human|person|agent|representative|someone)\b",
        r"\breal\s+person\b",
        r"\bcustomer\s+(?:service|support)\b",
        r"\blive\s+agent\b",
        r"\bconnect\s+me\s+(?:to|with)\s+(?:an?\s+)?(?:human|person|agent)\b",
    ]

    PURCHASE_SUBSCRIBE_PATTERNS = [
        r"\b(?:i\s+)?(?:want|would\s+like|need)\s+to\s+(?:buy|purchase|subscribe|order)\b",
        r"\bhow\s+(?:can|do)\s+i\s+(?:buy|purchase|subscribe|sign\s*up|order)\b",
        r"\b(?:buy|purchase|subscribe\s+to|sign\s*up\s+for)\s+(?:your|the)\b",
        r"\bi(?:'d| would)\s+like\s+to\s+buy\b",
        r"\b(?:buy|purchase|subscribe|order)\s+(?:your|the)\s+(?:stuff|products?|services?)\b",
        r"\b(?:know|learn)\s+more\s+about\s+(?:your|the)\s+services\b",
        r"\btell\s+me\s+about\s+(?:your|the)\s+services\b",
        r"\bwhat\s+do\s+you\s+offer\b",
        r"\b(?:can|may)\s+i\s+(?:know|learn|get)\s+more\s+about\s+(?:your|the)\s+services\b",
    ]

    NON_QUESTION_PATTERNS = [
        r"^(hi|hello|hey|hola|bonjour|hallo|ciao|salut|oi)[\s!.,]*$",
        r"^good\s+(morning|afternoon|evening|day|night)[\s!.,]*$",
        r"^(thanks|thank\s*you|thx|ty|merci|gracias|danke|obrigado)[\s!.,]*$",
        r"^(bye|goodbye|see\s+you|ciao|adios|au\s+revoir)[\s!.,]*$",
        r"^(ok|okay|sure|got\s+it|understood|alright|fine)[\s!.,]*$",
        r"^(yes|no|yeah|yep|nope|nah)[\s!.,]*$",
        # an opener that announces a question; a topic of a few words is fine, an embedded question is not
        r"^((hi|hello|hey)[\s!.,]*)?"
        r"(i\s+have|i(?:'|’)?ve\s+got|i\s+got|got)\s+(an?|some|a\s+few)\s+(quick\s+)?questions?"
        r"(\s+(about|on|regarding)\s+(?!.*\b(whether|if|how|what|when|where|why|who|which)\b)"
        r"[\w'’-]+(\s+[\w'’-]+){0,3})?"
        r"[\s!.,:?]*$",
        r"^(can|could|may)\s+i\s+ask\s+(you\s+)?(a\s+(quick\s+)?question|something)[\s!.,?]*$",
        r"^quick\s+question[\s!.,:]*$",
    ]

    LLM_CLASSIFICATION_PROMPT = f"""
You are a query routing assistant. Your task is to:
1. Determine if this is a genuine question/inquiry or just a greeting/acknowledgment/filler
2. Detect speak-to-person or purchase/subscribe personalization scenario intent
3. Detect if the user is asking about the assistant's identity / capabilities
4. Detect if the user is asking a meta-question about the system itself
5. Detect if the user is asking the assistant to decide a political choice for them (whom or what to vote for)
6. Detect if the user is asking about the outcome of an election, referendum, or ballot measure
7. Detect if the answer depends on where the user is while the query does not say where
8. Detect if the user wants a broad digest/recap/summary of recent events
9. Identify the ISO 639-1 language AND the ISO 15924 script the query text is written in (judge only by the text, never by names or topics it mentions); set message_language and message_script. These are independent: romanized Hindi ("kya hua?") is message_language "hi" with message_script "Latn", while "क्या हुआ?" is "hi" with "Deva"
10. If it's a question, determine which knowledge sources should be queried
11. Detect any temporal (time-sensitive) intent in the question
12. Detect if the query does nothing but say where the user is

{INTENT_CLASSIFICATION}

{SCENARIO_INTENT_DETECTION}

{ROLE_DESCRIPTION_DETECTION}

{METAQUESTION}

{VOTE_RECOMMENDATION_DETECTION}

{ELECTION_RESULTS_DETECTION}

{USER_LOCATION_DEPENDENCE}

{LOCATION_ONLY_REPLY}

{SYNTHESIS_DETECTION}

{SOURCE_ROUTING}

{TEMPORAL_CLASSIFICATION}

## Query to Classify
{{query}}

## Context
Today's date: {{today}}
Hub ID: {{hub_id}}
Provisional detected language (statistical guess, may be wrong): {{language}}

## Instructions
- First determine is_question, then is_speak_to_person / is_purchase_subscribe, then is_role_description, then is_metaquestion, then is_vote_recommendation, then election_question_kind, then needs_user_location, then is_location_only, then is_synthesis
- If is_question is false OR is_speak_to_person is true OR is_purchase_subscribe is true OR is_role_description is true OR is_metaquestion is true OR is_vote_recommendation is true OR election_question_kind is "vote_outcome": set sources to [] and confidences to []
- Otherwise: select ONE or MORE sources, assign confidence scores (0.0-1.0)
- internal_kb should ALWAYS be included with at least 0.3 confidence for organization-related queries
- For factual entity queries, include yago with high confidence
- Always set temporal_type, temporal_reference_date, recency_window_days, is_role_description, is_metaquestion, is_vote_recommendation, election_question_kind, needs_user_location, is_location_only, is_synthesis, synthesis_time_window_days, message_language, and message_script

## Output Format
{{output_format}}
"""

    def __init__(self) -> None:
        self.config = Config()
        self.llm_config = LLMConfig()
        self._compiled_structured = [re.compile(p, re.IGNORECASE) for p in self.STRUCTURED_KB_PATTERNS]
        self._compiled_domain = [re.compile(p, re.IGNORECASE) for p in self.DOMAIN_SPECIFIC_PATTERNS]
        self._compiled_non_question = [re.compile(p, re.IGNORECASE) for p in self.NON_QUESTION_PATTERNS]
        self._compiled_speak_to_person = [re.compile(p, re.IGNORECASE) for p in self.SPEAK_TO_PERSON_PATTERNS]
        self._compiled_purchase_subscribe = [re.compile(p, re.IGNORECASE) for p in self.PURCHASE_SUBSCRIBE_PATTERNS]
        self._entity_extractor = get_entity_extractor(self.config.yago_entity_extractor)

    def is_non_question(self, query: str) -> bool:
        return any(p.match(query.strip()) for p in self._compiled_non_question)

    def detect_scenario_intent(self, query: str) -> QueryIntent | None:
        ## to test the LLM-based scenario intent detection, temporarily disable the heuristics
        query_lower = query.strip().lower()
        if any(p.search(query_lower) for p in self._compiled_speak_to_person):
            return QueryIntent.SPEAK_TO_PERSON
        if any(p.search(query_lower) for p in self._compiled_purchase_subscribe):
            return QueryIntent.PURCHASE_SUBSCRIBE
        return None

    def extract_place_names(self, query: str, language: str | None) -> list[str]:
        """Return the places (states, cities, countries) named in the query, in query order."""
        try:
            gate_ctx = QueryContext(hub_id=0, message_id=0, original_query=query, detected_language=language)
            entities = self._entity_extractor.extract(query, gate_ctx)
            return [e.text for e in entities if e.entity_type in ("GPE", "LOCATION")]
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Place entity extraction failed: {e}")
            return []

    async def _extract_person_names(self, query: str, context: QueryContext | None = None) -> list[str]:
        """Return person name strings detected in the query."""
        try:
            lang = context.detected_language if context and context.detected_language else None
            if lang is None:
                lang, _ = await language.detect_text(query)
            if context is not None:
                gate_ctx = context.model_copy(update={"detected_language": lang})
            else:
                gate_ctx = QueryContext(hub_id=0, message_id=0, original_query=query, detected_language=lang)
            entities = self._entity_extractor.extract(query, gate_ctx)
            return [e.text for e in entities if e.entity_type == "PERSON"]
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Person entity extraction failed: {e}")
            return []

    async def classify(self, query: str, context: QueryContext, use_llm_fallback: bool = True) -> ClassificationResult:
        heuristic_result = self._classify_with_heuristics(query)
        if heuristic_result is not None and location_verdict_pending(heuristic_result, context):
            logger.debug("Heuristic question verdict cannot judge location dependence; using LLM classifier")
            use_llm_fallback = True
            heuristic_result = None

        if heuristic_result is not None:
            logger.debug(
                f"Query classified via heuristics: intent={heuristic_result.intent.value}, "
                f"routes={[r.source for r in heuristic_result.routes]}"
            )
            logger.debug(
                f"Heuristic temporal: type={heuristic_result.temporal.type.value}, "
                f"reference_date={heuristic_result.temporal.reference_date}"
            )
            heuristic_result.person_entities = await self._extract_person_names(query, context)
            return heuristic_result

        default = ClassificationResult(
            intent=QueryIntent.QUESTION,
            routes=[RouteDecision(source=KnowledgeSource.INTERNAL_KB, confidence=0.5, priority=0)],
            used_llm=False,
            reasoning="Default routing to internal KB (heuristics inconclusive, LLM disabled)",
        )
        if use_llm_fallback or location_verdict_pending(default, context):
            logger.debug("Heuristics inconclusive, using LLM classifier")
            result: ClassificationResult = await self._classify_with_llm(query, context)
            result.person_entities = await self._extract_person_names(query, context)
            return result

        result = default
        result.person_entities = await self._extract_person_names(query, context)
        logger.debug("Defaulting to internal KB (LLM fallback disabled)")
        return result

    def _classify_with_heuristics(self, query: str) -> ClassificationResult | None:
        """
        Attempt to classify query using pattern matching.

        Returns None if classification is ambiguous.
        """
        routes: list[RouteDecision] = []
        query_stripped = query.strip()

        for pattern in self._compiled_non_question:
            if pattern.match(query_stripped):
                logger.debug(f"Non-question pattern matched: {pattern.pattern}")
                return ClassificationResult(
                    intent=QueryIntent.NON_QUESTION,
                    routes=[],
                    used_llm=False,
                    reasoning="Non-question pattern detected (greeting/thanks/farewell etc.)",
                )

        query_lower = query_stripped.lower()

        scenario_intent = self.detect_scenario_intent(query_stripped)
        if scenario_intent is not None:
            logger.debug(f"Scenario intent pattern matched: {scenario_intent.value}")
            return ClassificationResult(
                intent=scenario_intent,
                routes=[],
                used_llm=False,
                reasoning=f"Scenario intent pattern detected ({scenario_intent.value})",
            )

        if _compound_query_prefers_llm_classifier(query_stripped):
            logger.debug("Compound or multi-part query; skipping heuristics for LLM classification")
            return None

        domain_matches = sum(1 for p in self._compiled_domain if p.search(query_lower))
        if domain_matches > 0:
            routes.append(
                RouteDecision(
                    source=KnowledgeSource.INTERNAL_KB,
                    confidence=0.9,
                    priority=0,
                    reasoning="Domain-specific pattern detected",
                )
            )
            return ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=routes,
                used_llm=False,
                reasoning="Strong domain-specific signal",
            )

        structured_matches = sum(1 for p in self._compiled_structured if p.search(query_lower))

        if structured_matches >= 1:
            routes.append(
                RouteDecision(
                    source=KnowledgeSource.YAGO,
                    confidence=0.8,
                    priority=0,
                    reasoning="Structured fact query pattern",
                )
            )
            routes.append(
                RouteDecision(
                    source=KnowledgeSource.INTERNAL_KB,
                    confidence=0.4,
                    priority=1,
                    reasoning="Include internal KB as fallback",
                )
            )
            return ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=routes,
                used_llm=False,
                reasoning="Structured knowledge query detected",
            )

        return None

    @staticmethod
    def _parse_llm_synthesis(result: LLMClassificationOutput) -> SynthesisContext | None:
        if not result.is_synthesis:
            return None

        if result.synthesis_type is None:
            logger.warning("LLM marked is_synthesis=true but did not provide synthesis_type, defaulting to TEMPORAL")
            synthesis_type = SynthesisType.TEMPORAL
        else:
            try:
                synthesis_type = SynthesisType(result.synthesis_type)
            except ValueError:
                logger.warning(
                    f"LLM returned invalid synthesis_type: {result.synthesis_type!r}, defaulting to TEMPORAL"
                )
                synthesis_type = SynthesisType.TEMPORAL

        if synthesis_type == SynthesisType.TOPICAL:
            topic = (result.synthesis_topic or "").strip() or None
            if topic is None:
                logger.warning("LLM marked synthesis as topical but did not provide synthesis_topic")
            return SynthesisContext(type=SynthesisType.TOPICAL, topic=topic)

        time_window = result.synthesis_time_window_days
        if time_window is not None and time_window < 1:
            logger.warning(f"LLM returned invalid synthesis_time_window_days: {time_window}, defaulting to 7")
            time_window = 7

        return SynthesisContext(
            type=SynthesisType.TEMPORAL,
            time_window_days=time_window,
        )

    @staticmethod
    def _parse_llm_temporal(result: LLMClassificationOutput, query: str) -> TemporalContext:
        try:
            temporal_type = TemporalType(result.temporal_type)
        except ValueError:
            logger.opt(exception=sys.exc_info()).warning(
                f"LLM returned invalid temporal_type: {result.temporal_type!r}, defaulting to NONE"
            )
            return TemporalContext()

        if temporal_type == TemporalType.NONE:
            return TemporalContext()

        recency_window_days: int | None = None
        if temporal_type == TemporalType.RECENCY:
            rw = result.recency_window_days
            if rw is not None:
                if rw < 1:
                    logger.warning(f"LLM returned invalid recency_window_days: {rw}, ignoring window")
                    rw = None
                elif rw > 366:
                    rw = 366
            recency_window_days = rw

        return TemporalContext(
            type=temporal_type,
            reference_date=result.temporal_reference_date if temporal_type == TemporalType.POINT_IN_TIME else None,
            recency_window_days=recency_window_days,
            confidence=0.8,
        )

    @staticmethod
    def _parse_llm_language(result: LLMClassificationOutput) -> str | None:
        # llm output is untrusted, anything but a plausible iso 639-1 code must not leak downstream
        lang = (result.message_language or "").strip().lower()
        return lang if re.fullmatch(r"[a-z]{2}", lang) else None

    # the scripts of the languages the service supports (LANGUAGE_NAMES in app.services.language).
    # an allowlist rather than a shape check because the value is interpolated into prompts as an instruction.
    # a hallucinated four-letter token would order the model to write in a script that does not exist.
    KNOWN_SCRIPTS = frozenset({"Latn", "Deva", "Arab"})

    @classmethod
    def _parse_llm_script(cls, result: LLMClassificationOutput) -> str | None:
        # same untrusted-output rule as _parse_llm_language: only a known iso 15924 code may leak downstream.
        # normalized to title case so the prompt renders one spelling regardless of what the model emitted.
        script = (result.message_script or "").strip().title()
        return script if script in cls.KNOWN_SCRIPTS else None

    @staticmethod
    def build_result_from_llm(query: str, result: LLMClassificationOutput) -> ClassificationResult:
        """Translate an LLMClassificationOutput into a ClassificationResult.

        Shared by the standalone classifier and the unified classifier-decomposer so the
        routing / temporal / synthesis / metaquestion mapping stays in one place.
        """
        message_language = QueryClassifier._parse_llm_language(result)
        message_script = QueryClassifier._parse_llm_script(result)

        if not result.is_question:
            logger.debug("LLM classified query as non-question")
            return ClassificationResult(
                intent=QueryIntent.NON_QUESTION,
                routes=[],
                used_llm=True,
                reasoning=result.reasoning,
                message_language=message_language,
                message_script=message_script,
            )

        if result.is_speak_to_person:
            logger.debug("LLM classified query as speak_to_person scenario")
            return ClassificationResult(
                intent=QueryIntent.SPEAK_TO_PERSON,
                routes=[],
                used_llm=True,
                reasoning=result.reasoning,
                message_language=message_language,
                message_script=message_script,
            )

        if result.is_purchase_subscribe:
            logger.debug("LLM classified query as purchase_subscribe scenario")
            return ClassificationResult(
                intent=QueryIntent.PURCHASE_SUBSCRIBE,
                routes=[],
                used_llm=True,
                reasoning=result.reasoning,
                message_language=message_language,
                message_script=message_script,
            )

        if result.is_role_description:
            logger.debug("LLM classified query as role_description (identity/capability)")
            return ClassificationResult(
                intent=QueryIntent.ROLE_DESCRIPTION,
                routes=[],
                used_llm=True,
                reasoning=result.reasoning,
                message_language=message_language,
                message_script=message_script,
            )

        if result.is_metaquestion:
            logger.debug("LLM classified query as metaquestion")
            return ClassificationResult(
                intent=QueryIntent.METAQUESTION,
                routes=[],
                used_llm=True,
                reasoning=result.reasoning,
                message_language=message_language,
                message_script=message_script,
            )

        # a request to pick a candidate, party, or side is refused before retrieval: the generator and
        # judge rules against recommending are a second layer, not the only one
        if result.is_vote_recommendation:
            logger.debug("LLM classified query as vote_recommendation")
            return ClassificationResult(
                intent=QueryIntent.VOTE_RECOMMENDATION,
                routes=[],
                used_llm=True,
                reasoning=result.reasoning,
                message_language=message_language,
                message_script=message_script,
            )

        # refused before retrieval so an outcome is never reported, even when a hub's sources contain it
        if result.election_question_kind == "vote_outcome":
            logger.debug("LLM classified query as election_results")
            return ClassificationResult(
                intent=QueryIntent.ELECTION_RESULTS,
                routes=[],
                used_llm=True,
                reasoning=result.reasoning,
                message_language=message_language,
                message_script=message_script,
            )

        temporal = QueryClassifier._parse_llm_temporal(result, query)
        synthesis = QueryClassifier._parse_llm_synthesis(result)

        routes: list[RouteDecision] = []
        for source_str, confidence in zip(result.sources, result.confidences, strict=False):
            try:
                source = KnowledgeSource(source_str)
                routes.append(
                    RouteDecision(
                        source=source,
                        confidence=min(1.0, max(0.0, confidence)),
                        priority=len(routes),
                    )
                )
            except ValueError:
                logger.opt(exception=sys.exc_info()).warning(f"Unknown source from LLM: {source_str}")

        if not any(r.source == KnowledgeSource.INTERNAL_KB for r in routes):
            routes.append(
                RouteDecision(
                    source=KnowledgeSource.INTERNAL_KB,
                    confidence=0.3,
                    priority=len(routes),
                    reasoning="Default inclusion of internal KB",
                )
            )

        intent = QueryIntent.SYNTHESIS if synthesis is not None else QueryIntent.QUESTION

        return ClassificationResult(
            intent=intent,
            routes=routes,
            used_llm=True,
            reasoning=result.reasoning,
            temporal=temporal,
            synthesis=synthesis,
            needs_user_location=result.needs_user_location,
            location_only=result.is_location_only,
            message_language=message_language,
            message_script=message_script,
        )

    @LLMCircuitBreaker()
    async def _classify_with_llm(self, query: str, context: QueryContext) -> ClassificationResult:
        prompt = PromptTemplate.from_template(self.LLM_CLASSIFICATION_PROMPT)

        parser: PydanticOutputParser[LLMClassificationOutput] = PydanticOutputParser(
            pydantic_object=LLMClassificationOutput
        )
        output_format = strict_format_instructions(parser)

        model = create_chat_model(self.llm_config.llm_classifier, self.llm_config)

        try:
            result: LLMClassificationOutput = await ainvoke_with_output_retry(
                {
                    "query": query,
                    "today": date.today().isoformat(),
                    "hub_id": context.hub_id,
                    "language": context.detected_language or "unknown",
                    "output_format": output_format,
                },
                prompt=prompt,
                model=model,
                parser=parser,
                component="Classifier",
            )
            if is_degenerate_llm_classification(result):
                # no retry on this legacy path; build_result_from_llm degrades empty routing to the fallback route
                logger.warning(
                    f"LLM classification returned a degenerate payload "
                    f"(fields present: {sorted(result.model_fields_set)}); degrading to fallback routing"
                )
            return self.build_result_from_llm(query, result)

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"LLM classification failed: {e}")
            return ClassificationResult(
                intent=QueryIntent.QUESTION,
                routes=[
                    RouteDecision(
                        source=KnowledgeSource.INTERNAL_KB,
                        confidence=0.5,
                        priority=0,
                        reasoning="LLM classification failed, defaulting to internal KB",
                    )
                ],
                used_llm=True,
                reasoning=f"LLM classification error: {e}",
            )
