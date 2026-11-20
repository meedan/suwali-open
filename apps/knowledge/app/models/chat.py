import re
from enum import Enum, StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

ScenarioType = Literal[
    "role_description",
    "unanswerable_question",
    "error_occurred",
    "first_message",
    "speak_to_person",
    "purchase_subscribe",
    "conversation_closed",
]


class Role(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


class Message(BaseModel):
    role: Role
    content: str
    # set by the cms on an assistant turn that refused a location-dependent question (metadata.user_location_missing).
    # a bare location in the next user turn resumes the question before it instead of being answered as small talk
    user_location_missing: bool | None = None


ResourceType = Literal["email", "phone", "link", "question"]

_QUESTION_MARK_RE = re.compile(r"[?؟？]")


class ExternalResource(BaseModel):
    title: str  # URL of the external resource
    resource_type: ResourceType | None = None  # None for resources saved before the CMS stored a type
    description: str | None = None  # Description of when to use this resource
    scenarios: list[str] | None = None  # Specific scenarios when this resource should be used

    @model_validator(mode="after")
    def _keep_only_the_first_question(self) -> "ExternalResource":
        # a question is asked in the chatbot's own voice, so anything after it would be relayed as if the bot said it.
        # admins often leave the question mark off ("What's your state"), so a title without one is kept whole.
        if self.resource_type == "question" and (match := _QUESTION_MARK_RE.search(self.title)):
            self.title = self.title[: match.end()].strip()
        return self


class PersonalizationSettings(BaseModel):
    name: str | None = None
    description: str | None = None
    tone: Literal["journalist", "advocate", "executive"] | None = None
    external_resources: list[ExternalResource] | None = None
    hub_name: str | None = None
    default_language: str | None = None
    supported_languages: list[str] | None = None


class ContextNote(BaseModel):
    id: str  # opaque, assigned by the CMS
    text: str


class AddContextNote(BaseModel):
    op: Literal["add"] = "add"
    text: str


class RemoveContextNote(BaseModel):
    op: Literal["remove"] = "remove"
    id: str


ContextUpdate = Annotated[AddContextNote | RemoveContextNote, Field(discriminator="op")]


class ChatRequest(BaseModel):
    hub_id: int
    message_id: int
    message: str
    history: list[Message] | None = None
    personalization: PersonalizationSettings | None = None
    callback_url: str | None = None
    recency_first_enabled: bool | None = None
    # hub feature flag: refuse a location-dependent question until the conversation holds a location note.
    # off or absent, such a question is searched as written; the notes still inform the rewrite either way
    location_gate_enabled: bool | None = None
    existing_topics: list[str] = []  # hub's canonical topics, offered to the extractor for reuse
    # permanent conversation-context
    # empty or non-empty list triggers the context-extraction feature, None doesn't
    conversation_context: list[ContextNote] | None = None
    debug: bool = False  # return this request's log lines in ChatResponse.log


class Neo4jStageTiming(BaseModel):
    queries: list[float]  # each query's ms, in start order
    total_ms: float  # sum of queries: DB load
    wall_ms: float  # time at least one query was running; parallel queries count once
    stage_ms: float | None = None  # the stage's own wall-clock; None for untimed queries


class Metadata(BaseModel):
    answerable: bool | None = None
    documents_count: int | None = None
    query_tokens: int | None = None
    reasoning: str | None = None
    rewritten_question: str | None = None
    document_ids_used: list[str] | None = None
    document_ids_cited: list[str] | None = None
    retrieved_chunks: list[str] | None = None
    entities: list[str] | None = None
    retriever_detected_lang: str | None = None
    language: str | None = None
    rewriter_detected_lang: str | None = None
    rewriter_failed: bool | None = None  # rewrite failed; the question was searched without resolving prior context
    # location-dependent question refused without retrieval: the conversation notes held no location
    user_location_missing: bool | None = None
    # the user answered a location refusal with a bare location: this reply answers the refused question
    location_question_resumed: bool | None = None
    rephrased_query: str | None = None
    rephrase_attempts: int | None = None
    hyde_document: str | None = None
    hyde_used: bool | None = None
    hyde_successful: bool | None = None
    enrichment_facts_used: int | None = None
    enrichment_source: str | None = None  # "yago", "wikipedia", or "enrichment_fallback"
    temporal_type: str | None = None  # "none", "recency", "point_in_time"
    temporal_reference_date: str | None = None  # ISO date used as reference for temporal scoring
    temporal_recency_window_days: int | None = None  # hard recency window when set (see TemporalContext)
    temporal_recency_weight: float | None = None  # α value used in score blending
    recency_first_used: bool | None = None  # recency-first pass attempted (recent docs searched first)
    recency_first_window_days: int | None = None  # window size used by the recency-first pass
    recency_first_fallback_used: bool | None = None  # recent window empty, fell back to full corpus
    # answer re-generated over the same passages after the judge found entities none of them support,
    # or a user claim the passages contradict that the answer confirmed or left uncorrected
    regeneration_used: bool | None = None
    # the user's town no source covers; the question was searched for the region the note puts it in
    region_widened_from: str | None = None
    router_intent: str | None = (
        None  # question, non_question, location_noted, synthesis, metaquestion, vote_recommendation, election_results, role_description, speak_to_person, purchase_subscribe
    )
    router_decomposition_used: bool | None = None
    router_subquery_count: int | None = None
    router_subquery_answered_count: int | None = None
    router_synthesis_status: str | None = None  # no_subquery_results, partial_subquery, multi_subquery, ...
    synthesis_type: str | None = None  # "temporal" or "topical"
    synthesis_time_window_days: int | None = None
    synthesis_chunks_used: int | None = None
    question_type: str | None = None  # derived by derive_question_type from intent + temporal/synthesis
    relevance_gate_enabled: bool | None = None
    relevance_shadow_mode: bool | None = None
    relevance_threshold: float | None = None
    relevance_candidates_count: int | None = None
    relevance_kept_count: int | None = None
    relevance_dropped_count: int | None = None
    relevance_score_min: float | None = None
    relevance_score_p50: float | None = None
    relevance_score_p90: float | None = None
    relevance_score_max: float | None = None
    relevance_fallback_used: bool | None = None
    relevance_fallback_mode: str | None = None
    relevance_embedder_id: str | None = None
    answer_model: str | None = None  # model that produced the answer body
    llm_fallback_used: bool | None = None  # answer came from the bedrock fallback (see LLMWithFallback)
    total_duration_ms: float | None = None
    duration_details: dict[str, float] | None = None
    neo4j_duration_details: dict[str, Neo4jStageTiming] | None = None  # keyed by duration_details stage


class DurationKey:
    LANGUAGE_DETECTION = "language_detection"
    REWRITING = "rewriting"
    CLASSIFICATION = "classification"
    DECOMPOSITION_ANALYSIS = "decomposition_analysis"
    UNIFIED_CLASSIFICATION_DECOMPOSITION = "unified_classification_decomposition"
    DECOMPOSITION_TOTAL = "decomposition_total"
    ENRICHMENT_AGGREGATION = "enrichment_aggregation"
    INTERNAL_KB = "internal_kb"
    REPHRASING = "rephrasing"
    HYDE = "hyde"
    INITIAL_SEARCH = "initial_search"
    REGENERATION = "regeneration"
    ANSWER_JUDGING = "answer_judging"
    RETRIEVAL = "retrieval"
    SEARCH_TOTAL = "search_total"
    RELEVANCE_FILTERING = "relevance_filtering"
    SUMMARIZATION = "summarization"
    SYNTHESIS = "synthesis"
    SCENARIO_REPLY = "scenario_reply"
    ANSWER_LANGUAGE_GATE = "answer_language_gate"
    DIRECTIVE_GATE = "directive_gate"

    @staticmethod
    def sub_query(idx: int) -> str:
        return f"sub_query_{idx}"

    @staticmethod
    def sub_query_handler(idx: int, source: str) -> str:
        return f"sub_query_{idx}_{source}"


class ChatStatus(StrEnum):
    PARSING_QUESTION = "parsing_question"
    SEARCHING_SOURCES = "searching_sources"
    EVALUATING_RESULTS = "evaluating_results"
    COMPLETE = "complete"
    ERROR = "error"


class ErrorType(str, Enum):
    QUESTION_TOO_SHORT = "QUESTION_TOO_SHORT"
    QUESTION_TOO_LONG = "QUESTION_TOO_LONG"
    SEARCH_ERROR = "SEARCH_ERROR"
    CONTEXT_TOO_LARGE = "CONTEXT_TOO_LARGE"
    LLM_ERROR = "LLM_ERROR"
    NO_ANSWER_AVAILABLE = "NO_ANSWER_AVAILABLE"
    METAQUESTION = "METAQUESTION"
    VOTE_RECOMMENDATION = "VOTE_RECOMMENDATION"
    ELECTION_RESULTS = "ELECTION_RESULTS"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ChatResponse(BaseModel):
    answer: str
    error_type: ErrorType | None = None
    metadata: Metadata | None = None
    topics: list[str] = []
    context_updates: list[ContextUpdate] = []
    log: list[str] | None = None  # set only when the request had debug on


class PreviewRequest(BaseModel):
    scenario: ScenarioType
    personalization: PersonalizationSettings


class PreviewResponse(BaseModel):
    answer: str
