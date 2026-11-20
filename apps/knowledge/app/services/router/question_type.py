from typing import Any

from app.models.chat import ErrorType, Metadata
from app.models.temporal import TemporalContext, TemporalType
from app.services.router.models import QueryIntent, SynthesisContext, SynthesisType

UNSUPPORTED_LANGUAGE_QUESTION_TYPE = "unsupported_language"


def derive_question_type(
    intent: QueryIntent | str | None = None,
    temporal_type: TemporalType | str | None = None,
    synthesis_type: SynthesisType | str | None = None,
    *,
    error_type: ErrorType | str | None = None,
    unsupported_language: bool = False,
) -> str:
    if unsupported_language:
        return UNSUPPORTED_LANGUAGE_QUESTION_TYPE

    intent_value = intent.value if isinstance(intent, QueryIntent) else intent
    temporal_value = temporal_type.value if isinstance(temporal_type, TemporalType) else temporal_type
    synthesis_value = synthesis_type.value if isinstance(synthesis_type, SynthesisType) else synthesis_type

    if intent_value is None:
        if error_type is not None:
            error_value = error_type.value if isinstance(error_type, ErrorType) else error_type
            return f"error:{error_value.lower()}"
        return "error:unknown"

    if intent_value == QueryIntent.QUESTION.value:
        if temporal_value and temporal_value != TemporalType.NONE.value:
            return f"{QueryIntent.QUESTION.value}:{temporal_value}"
        return QueryIntent.QUESTION.value

    if intent_value == QueryIntent.SYNTHESIS.value:
        if synthesis_value:
            return f"{QueryIntent.SYNTHESIS.value}:{synthesis_value}"
        return QueryIntent.SYNTHESIS.value

    return intent_value


def rewriter_metadata_fields(metadata: Metadata) -> dict[str, Any]:
    """Carry the rewriter's provenance onto a rebuilt Metadata.

    Several answer paths build a fresh Metadata and copied these fields by hand,
    so a field added to the rewriter silently vanished on whichever path forgot it.
    The synthesis paths had already lost `reasoning` this way, which drops the
    rewriter node from the flow even though the rewrite ran.
    """
    return {
        "rewriter_detected_lang": metadata.rewriter_detected_lang,
        "reasoning": metadata.reasoning,
        "rewritten_question": metadata.rewritten_question,
        "rewriter_failed": metadata.rewriter_failed,
    }


def classification_metadata_fields(
    *,
    intent: QueryIntent | str | None = None,
    temporal: TemporalContext | None = None,
    temporal_type: TemporalType | str | None = None,
    synthesis: SynthesisContext | None = None,
    synthesis_type: SynthesisType | str | None = None,
    error_type: ErrorType | str | None = None,
    unsupported_language: bool = False,
    include_temporal_details: bool = True,
    include_synthesis_details: bool = True,
) -> dict[str, Any]:
    """Build the always-set classification fields for ChatResponse.metadata."""
    intent_value = intent.value if isinstance(intent, QueryIntent) else intent

    if temporal is not None:
        resolved_temporal: TemporalType | str = temporal.type
        temporal_reference_date = temporal.reference_date
        temporal_recency_window_days = temporal.recency_window_days
    else:
        resolved_temporal = temporal_type if temporal_type is not None else TemporalType.NONE
        temporal_reference_date = None
        temporal_recency_window_days = None

    temporal_value = resolved_temporal.value if isinstance(resolved_temporal, TemporalType) else resolved_temporal

    if synthesis is not None:
        resolved_synthesis: SynthesisType | str | None = synthesis.type
        synthesis_time_window_days = synthesis.time_window_days
    else:
        resolved_synthesis = synthesis_type
        synthesis_time_window_days = None

    synthesis_value = resolved_synthesis.value if isinstance(resolved_synthesis, SynthesisType) else resolved_synthesis
    if intent_value != QueryIntent.SYNTHESIS.value:
        synthesis_value = None
        synthesis_time_window_days = None

    fields: dict[str, Any] = {
        "router_intent": intent_value,
        "temporal_type": temporal_value or TemporalType.NONE.value,
        "synthesis_type": synthesis_value,
        "question_type": derive_question_type(
            intent_value,
            temporal_value,
            synthesis_value,
            error_type=error_type,
            unsupported_language=unsupported_language,
        ),
    }

    if include_temporal_details and temporal is not None:
        fields["temporal_reference_date"] = temporal_reference_date
        fields["temporal_recency_window_days"] = temporal_recency_window_days

    if include_synthesis_details and synthesis is not None and intent_value == QueryIntent.SYNTHESIS.value:
        fields["synthesis_time_window_days"] = synthesis_time_window_days

    return fields


def ensure_classification_metadata(response_metadata: Metadata | None, error_type: ErrorType | None = None) -> Metadata:
    """Fill missing classification fields without overwriting values already set."""
    metadata = response_metadata if response_metadata is not None else Metadata()

    updates: dict[str, Any] = {}
    if metadata.temporal_type is None:
        updates["temporal_type"] = TemporalType.NONE.value

    if metadata.question_type is None:
        updates["question_type"] = derive_question_type(
            metadata.router_intent,
            updates.get("temporal_type", metadata.temporal_type),
            metadata.synthesis_type,
            error_type=error_type,
        )

    if not updates:
        return metadata
    return metadata.model_copy(update=updates)
