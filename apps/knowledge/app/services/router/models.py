from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from app.models.chat import ContextNote, ErrorType, Message, PersonalizationSettings
from app.models.temporal import TemporalContext as TemporalContext
from app.models.temporal import TemporalType as TemporalType


class KnowledgeSource(StrEnum):
    INTERNAL_KB = "internal_kb"
    YAGO = "yago"
    WIKIPEDIA = "wikipedia"


class QueryIntent(StrEnum):
    QUESTION = "question"
    NON_QUESTION = "non_question"
    # a bare location reply, acknowledged like small talk but kept apart from it in the cms
    LOCATION_NOTED = "location_noted"
    SYNTHESIS = "synthesis"
    METAQUESTION = "metaquestion"
    VOTE_RECOMMENDATION = "vote_recommendation"
    ELECTION_RESULTS = "election_results"
    ROLE_DESCRIPTION = "role_description"
    SPEAK_TO_PERSON = "speak_to_person"
    PURCHASE_SUBSCRIBE = "purchase_subscribe"


class SynthesisType(StrEnum):
    TEMPORAL = "temporal"
    TOPICAL = "topical"


class SynthesisContext(BaseModel):
    type: SynthesisType = SynthesisType.TEMPORAL
    time_window_days: int | None = Field(default=None, description="e.g. 7 for 'this week', 1 for 'today'")
    topic: str | None = Field(
        default=None,
        description="For TOPICAL synthesis: the bare topic/entity phrase, kept as metadata (e.g. 'Iran').",
    )


class QueryContext(BaseModel):
    hub_id: int
    message_id: int
    original_query: str
    rewritten_query: str | None = None
    detected_language: str | None = None
    detected_script: str | None = None
    language_confidence: float | None = None
    history_summary: str | None = None
    history: list[Message] | None = None
    personalization: PersonalizationSettings | None = None
    conversation_context: list[ContextNote] | None = None
    temporal: TemporalContext | None = None
    person_entities: list[str] = Field(default_factory=list)
    # places the rewritten question names; the retriever ranks chunks that mention them first
    place_entities: list[str] = Field(default_factory=list)
    recency_first_enabled: bool | None = None
    location_gate_enabled: bool | None = None


class RouteDecision(BaseModel):
    source: KnowledgeSource
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score for this route (0-1)")
    reasoning: str | None = None
    priority: int = Field(default=0, description="Lower number = higher priority")


class HandlerResult(BaseModel):
    source: KnowledgeSource
    success: bool
    answer: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    context_snippets: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    latency_ms: float | None = None
    # the handler's own error_type and the localized message it already built for it
    # without these the router cannot tell a system failure from an empty corpus and reports both as NO_ANSWER_AVAILABLE
    error_type: ErrorType | None = None
    error_message: str | None = None


class ClassificationResult(BaseModel):
    intent: QueryIntent = QueryIntent.QUESTION
    routes: list[RouteDecision]
    used_llm: bool = False
    reasoning: str | None = None
    temporal: TemporalContext = Field(default_factory=TemporalContext)
    synthesis: SynthesisContext | None = None
    # the answer depends on where the user is and the query does not say where; False on heuristic paths
    needs_user_location: bool = False
    # the message only says where the user is; False on heuristic paths
    location_only: bool = False
    person_entities: list[str] = Field(default_factory=list)
    # llm verdict on the message language, None on heuristic and fallback paths
    message_language: str | None = None
    # ISO 15924 script the message was written in, None on heuristic and fallback paths.
    # a language code alone cannot express romanized hindi, so script travels as its own field.
    message_script: str | None = None


class AggregatedResult(BaseModel):
    results: list[HandlerResult]
    primary_source: KnowledgeSource | None = None
    total_latency_ms: float | None = None


class SubQuery(BaseModel):
    query: str
    reasoning: str
    dependencies: list[int] = Field(default_factory=list, description="Indices of sub-queries this depends on")


class DecompositionResult(BaseModel):
    should_decompose: bool
    sub_queries: list[SubQuery] = Field(default_factory=list)
    reasoning: str


class SubQueryResult(BaseModel):
    sub_query: SubQuery
    handler_results: list[HandlerResult] = Field(default_factory=list)
    answer: str | None = None
    latency_ms: float = 0.0


class SequentialExecutionResult(BaseModel):
    results: list[SubQueryResult] = Field(default_factory=list)
    total_latency_ms: float = 0.0
