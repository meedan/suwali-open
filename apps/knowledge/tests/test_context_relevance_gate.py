from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

from neo4j import Record

from app.core.config import Config
from app.core.constants import RETRIEVED_CHUNKS_SEPARATOR
from app.services.context_relevance_gate import (
    ContextRelevanceGate,
    RelevanceFilteredRetriever,
    parse_chunk_score_pairs,
)


def _record(*, chunks: list[str], scores: list[float]) -> MagicMock:
    """Build a fake Neo4j Record with parallel ``retrieved_chunks`` and ``chunk_scores`` fields,
    matching the parse format used by ``Neo4jClient.parse_neo4j_record_str``."""
    rec = MagicMock(spec=Record)
    chunks_field = RETRIEVED_CHUNKS_SEPARATOR.join(chunks)
    scores_field = "|".join(str(s) for s in scores)
    rec.content = f"<Record retrieved_chunks='{chunks_field}' chunk_scores='{scores_field}'>"
    rec.metadata = {}
    return rec


class _FakeRetriever:
    def __init__(self, records: list[MagicMock]) -> None:
        self._records = records
        self.result_formatter = lambda r: r

    def get_search_results(self, query_text: str, top_k: int = 5, **kwargs: object) -> object:
        return SimpleNamespace(records=self._records[:top_k], metadata={})


def _config(**overrides: Any) -> Config:
    base: dict[str, Any] = {
        "openai_api_key": "test-key",
        "redis_url": "redis://localhost:6379/1",
        "retriever_relevance_gate_enabled": True,
        "retriever_relevance_shadow_mode": False,
    }
    base.update(overrides)
    return Config.model_validate(base)


def test_context_relevance_gate_filters_subject_drift_records() -> None:
    good = _record(chunks=["fact check report about event xyz"], scores=[0.9])
    bad = _record(chunks=["fact checking article about event abc"], scores=[0.1])
    with patch(
        "app.services.context_relevance_gate.RETRIEVER_RELEVANCE_MIN_CHUNKS_AFTER_FILTER",
        1,
    ):
        gate = ContextRelevanceGate(config=_config(), embedder_id="fake:model")

        kept, telemetry = gate.filter_records([good, bad])

    assert len(kept) == 1
    assert kept[0].content == good.content
    assert telemetry.enabled is True
    assert telemetry.candidates_count == 2
    assert telemetry.kept_count == 1
    assert telemetry.dropped_count == 1


def test_shadow_mode_preserves_records_but_keeps_counterfactual_telemetry() -> None:
    good = _record(chunks=["event xyz details"], scores=[0.9])
    bad = _record(chunks=["unrelated"], scores=[0.05])
    with patch(
        "app.services.context_relevance_gate.RETRIEVER_RELEVANCE_MIN_CHUNKS_AFTER_FILTER",
        1,
    ):
        gate = ContextRelevanceGate(
            config=_config(retriever_relevance_shadow_mode=True),
            embedder_id="fake:model",
        )

        kept, telemetry = gate.filter_records([good, bad])

    assert len(kept) == 2  # shadow mode returns all records
    assert telemetry.shadow_mode is True
    # the counterfactual: the gate WOULD have dropped the low-score record
    assert telemetry.kept_count == 1
    assert telemetry.dropped_count == 1


def test_relevance_filtered_retriever_exposes_last_telemetry() -> None:
    records = [
        _record(chunks=["event xyz details"], scores=[0.9]),
        _record(chunks=["unrelated content"], scores=[0.05]),
    ]
    with patch(
        "app.services.context_relevance_gate.RETRIEVER_RELEVANCE_MIN_CHUNKS_AFTER_FILTER",
        1,
    ):
        wrapped = RelevanceFilteredRetriever(
            base_retriever=_FakeRetriever(records=records),  # type: ignore[arg-type]
            relevance_gate=ContextRelevanceGate(
                config=_config(),
                embedder_id="fake:model",
            ),
        )

        result = wrapped.get_search_results(query_text="event xyz question", top_k=2)

    assert len(result.records) == 1
    assert wrapped.last_telemetry is not None
    assert wrapped.last_telemetry.kept_count == 1
    assert wrapped.last_telemetry.duration_ms is not None


def test_disabled_gate_passes_through_records_unchanged() -> None:
    records = [
        _record(chunks=["any"], scores=[0.05]),
        _record(chunks=["any"], scores=[0.05]),
    ]
    gate = ContextRelevanceGate(
        config=_config(retriever_relevance_gate_enabled=False),
        embedder_id="fake:model",
    )

    kept, telemetry = gate.filter_records(records)

    assert kept == records
    assert telemetry.enabled is False
    assert telemetry.kept_count == len(records)
    assert telemetry.dropped_count == 0


def test_keep_top_n_fallback_keeps_min_chunks() -> None:
    """When all candidates are below the primary threshold and below the relaxed threshold,
    keep_top_n falls back to the top-N by score."""
    with (
        patch("app.services.context_relevance_gate.RETRIEVER_RELEVANCE_FALLBACK_MODE", "keep_top_n"),
        patch("app.services.context_relevance_gate.RETRIEVER_RELEVANCE_MIN_CHUNKS_AFTER_FILTER", 2),
        patch(
            "app.services.context_relevance_gate.RETRIEVER_RELEVANCE_RELAXED_SIMILARITY_SCORE",
            0.9,
        ),
    ):
        gate = ContextRelevanceGate(
            config=_config(),
            embedder_id="fake:model",
        )

        kept, telemetry = gate.filter_chunks([("low_a", 0.05), ("low_b", 0.10), ("low_c", 0.02)])

    assert len(kept) == 2  # min_chunks_after_filter
    assert kept == ["low_b", "low_a"]  # ordered by score desc
    assert telemetry.fallback_used is True
    assert telemetry.fallback_mode == "keep_top_n"


def test_max_chunks_after_filter_cap_is_enforced() -> None:
    with patch(
        "app.services.context_relevance_gate.RETRIEVER_RELEVANCE_MAX_CHUNKS_AFTER_FILTER",
        2,
    ):
        gate = ContextRelevanceGate(
            config=_config(),
            embedder_id="fake:model",
        )

        kept, telemetry = gate.filter_chunks([("a", 0.9), ("b", 0.8), ("c", 0.7), ("d", 0.6)])

    assert len(kept) == 2
    assert kept == ["a", "b"]
    assert telemetry.kept_count == 2


def test_parse_chunk_score_pairs_pads_missing_scores_with_zero() -> None:
    content = (
        f"<Record retrieved_chunks='alpha{RETRIEVED_CHUNKS_SEPARATOR}beta{RETRIEVED_CHUNKS_SEPARATOR}gamma' "
        "chunk_scores='0.9'>"
    )
    pairs = parse_chunk_score_pairs(content)
    assert pairs == [("alpha", 0.9), ("beta", 0.0), ("gamma", 0.0)]


def test_parse_chunk_score_pairs_handles_missing_chunk_scores_field() -> None:
    content = f"<Record retrieved_chunks='alpha{RETRIEVED_CHUNKS_SEPARATOR}beta'>"
    pairs = parse_chunk_score_pairs(content)
    assert pairs == [("alpha", 0.0), ("beta", 0.0)]


def test_parse_chunk_score_pairs_synthesis_field() -> None:
    content = f"<Record context='<DOC>x</DOC>{RETRIEVED_CHUNKS_SEPARATOR}<DOC>y</DOC>' chunk_scores='0.7|0.2'>"
    pairs = parse_chunk_score_pairs(content, chunks_field="context")
    assert pairs == [("<DOC>x</DOC>", 0.7), ("<DOC>y</DOC>", 0.2)]
