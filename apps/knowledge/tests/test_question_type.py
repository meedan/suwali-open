from app.models.chat import ErrorType, Metadata
from app.models.temporal import TemporalContext, TemporalType
from app.services.router.models import QueryIntent, SynthesisContext, SynthesisType
from app.services.router.question_type import (
    UNSUPPORTED_LANGUAGE_QUESTION_TYPE,
    classification_metadata_fields,
    derive_question_type,
    ensure_classification_metadata,
    rewriter_metadata_fields,
)


class TestDeriveQuestionType:
    def test_question_none(self) -> None:
        assert derive_question_type(QueryIntent.QUESTION, TemporalType.NONE) == "question"

    def test_question_recency(self) -> None:
        assert derive_question_type(QueryIntent.QUESTION, TemporalType.RECENCY) == "question:recency"

    def test_question_point_in_time(self) -> None:
        assert derive_question_type(QueryIntent.QUESTION, TemporalType.POINT_IN_TIME) == "question:point_in_time"

    def test_synthesis_temporal(self) -> None:
        assert (
            derive_question_type(QueryIntent.SYNTHESIS, TemporalType.RECENCY, SynthesisType.TEMPORAL)
            == "synthesis:temporal"
        )

    def test_synthesis_topical(self) -> None:
        assert (
            derive_question_type(QueryIntent.SYNTHESIS, TemporalType.NONE, SynthesisType.TOPICAL) == "synthesis:topical"
        )

    def test_other_intents(self) -> None:
        assert derive_question_type(QueryIntent.METAQUESTION) == "metaquestion"

    def test_vote_recommendation(self) -> None:
        assert derive_question_type(QueryIntent.VOTE_RECOMMENDATION) == "vote_recommendation"
        assert derive_question_type(QueryIntent.NON_QUESTION) == "non_question"
        assert derive_question_type(QueryIntent.LOCATION_NOTED) == "location_noted"
        assert derive_question_type(QueryIntent.ROLE_DESCRIPTION) == "role_description"
        assert derive_question_type(QueryIntent.SPEAK_TO_PERSON) == "speak_to_person"
        assert derive_question_type(QueryIntent.PURCHASE_SUBSCRIBE) == "purchase_subscribe"

    def test_error_without_intent(self) -> None:
        assert derive_question_type(error_type=ErrorType.QUESTION_TOO_SHORT) == "error:question_too_short"
        assert derive_question_type(error_type=ErrorType.INTERNAL_ERROR) == "error:internal_error"

    def test_unsupported_language(self) -> None:
        assert derive_question_type(unsupported_language=True) == UNSUPPORTED_LANGUAGE_QUESTION_TYPE


class TestRewriterMetadataFields:
    def test_carries_every_rewriter_field(self) -> None:
        source = Metadata(
            rewriter_detected_lang="ar",
            reasoning="Resolved the pronoun against the previous turn.",
            rewritten_question="What are the figures for last week?",
            rewriter_failed=None,
        )

        rebuilt = Metadata(answerable=True, **rewriter_metadata_fields(source))

        assert rebuilt.rewriter_detected_lang == "ar"
        assert rebuilt.reasoning == "Resolved the pronoun against the previous turn."
        assert rebuilt.rewritten_question == "What are the figures for last week?"
        assert rebuilt.rewriter_failed is None

    def test_carries_the_failure_flag(self) -> None:
        rebuilt = Metadata(**rewriter_metadata_fields(Metadata(rewriter_failed=True)))

        assert rebuilt.rewriter_failed is True

    def test_covers_every_rewriter_field_on_metadata(self) -> None:
        """A new rewriter field must be added to the helper, or it vanishes on the rebuilt paths.

        The prefix is `rewrit` so it spans both `rewriter_*` and `rewritten_*`; `reasoning`
        is the one rewriter output whose name carries no prefix at all, so it is named here.
        """
        expected = {name for name in Metadata.model_fields if name.startswith("rewrit")} | {"reasoning"}
        carried = set(rewriter_metadata_fields(Metadata()))

        assert expected <= carried, f"not carried onto rebuilt Metadata: {sorted(expected - carried)}"


class TestClassificationMetadataFields:
    def test_always_sets_core_fields(self) -> None:
        fields = classification_metadata_fields(
            intent=QueryIntent.QUESTION,
            temporal=TemporalContext(type=TemporalType.RECENCY, recency_window_days=7),
        )
        assert fields["router_intent"] == "question"
        assert fields["temporal_type"] == "recency"
        assert fields["synthesis_type"] is None
        assert fields["question_type"] == "question:recency"
        assert fields["temporal_recency_window_days"] == 7

    def test_synthesis_clears_synthesis_type_for_non_synthesis_intent(self) -> None:
        fields = classification_metadata_fields(
            intent=QueryIntent.QUESTION,
            synthesis=SynthesisContext(type=SynthesisType.TEMPORAL, time_window_days=7),
        )
        assert fields["synthesis_type"] is None
        assert fields["question_type"] == "question"

    def test_default_temporal_none(self) -> None:
        fields = classification_metadata_fields(intent=QueryIntent.METAQUESTION)
        assert fields["temporal_type"] == "none"
        assert fields["question_type"] == "metaquestion"


class TestEnsureClassificationMetadata:
    def test_fills_missing_fields(self) -> None:
        metadata = ensure_classification_metadata(Metadata(router_intent="question"))
        assert metadata.temporal_type == "none"
        assert metadata.question_type == "question"

    def test_does_not_overwrite_existing(self) -> None:
        metadata = ensure_classification_metadata(
            Metadata(
                router_intent="question",
                temporal_type="recency",
                question_type="question:recency",
            )
        )
        assert metadata.temporal_type == "recency"
        assert metadata.question_type == "question:recency"

    def test_none_metadata(self) -> None:
        metadata = ensure_classification_metadata(None, error_type=ErrorType.INTERNAL_ERROR)
        assert metadata.temporal_type == "none"
        assert metadata.question_type == "error:internal_error"
