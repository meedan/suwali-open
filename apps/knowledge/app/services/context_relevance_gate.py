from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any

from loguru import logger
from neo4j_graphrag.retrievers.base import Retriever as BaseNeo4jRetriever
from neo4j_graphrag.types import RawSearchResult

from app.core.config import Config
from app.core.constants import (
    RETRIEVED_CHUNKS_SEPARATOR,
    RETRIEVER_RELEVANCE_FALLBACK_MODE,
    RETRIEVER_RELEVANCE_MAX_CHUNKS_AFTER_FILTER,
    RETRIEVER_RELEVANCE_MIN_CHUNKS_AFTER_FILTER,
    RETRIEVER_RELEVANCE_MIN_SIMILARITY_SCORE,
    RETRIEVER_RELEVANCE_RELAXED_SIMILARITY_SCORE,
)
from app.services.neo4j_client import Neo4jClient


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = int(round((len(ordered) - 1) * percentile))
    return ordered[max(0, min(idx, len(ordered) - 1))]


def _safe_float(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def parse_chunk_score_pairs(content: str, chunks_field: str = "retrieved_chunks") -> list[tuple[str, float]]:
    """Pair each retrieved chunk text with its per-chunk cosine score.

    Cypher returns ``chunks_field`` (separator-joined chunks) and ``chunk_scores``
    (``|``-joined parallel float strings). The wrapper path uses ``retrieved_chunks``
    (raw chunks); the synthesis path uses ``context`` (DOCUMENT-tag-wrapped chunks).
    Older Cypher payloads without ``chunk_scores`` are tolerated by padding with 0.0
    so callers don't silently drop chunks.
    """
    if not content:
        return []
    parsed = Neo4jClient.parse_neo4j_record_str(content)
    raw_chunks = parsed.get(chunks_field, "")
    raw_scores = parsed.get("chunk_scores", "")
    if not raw_chunks:
        return []
    chunks = [c.strip() for c in raw_chunks.split(RETRIEVED_CHUNKS_SEPARATOR) if c.strip()]
    score_strs = raw_scores.split("|") if raw_scores else []
    scores = [_safe_float(s) for s in score_strs]
    if len(scores) < len(chunks):
        scores = scores + [0.0] * (len(chunks) - len(scores))
    return list(zip(chunks, scores[: len(chunks)]))


@dataclass
class RelevanceTelemetry:
    enabled: bool
    shadow_mode: bool
    threshold: float
    candidates_count: int
    kept_count: int
    dropped_count: int
    score_min: float | None
    score_p50: float | None
    score_p90: float | None
    score_max: float | None
    fallback_used: bool
    fallback_mode: str | None
    embedder_id: str
    duration_ms: float | None = None

    @classmethod
    def disabled(cls, config: Config, embedder_id: str, candidates: int) -> RelevanceTelemetry:
        return cls(
            enabled=False,
            shadow_mode=config.retriever_relevance_shadow_mode,
            threshold=RETRIEVER_RELEVANCE_MIN_SIMILARITY_SCORE,
            candidates_count=candidates,
            kept_count=candidates,
            dropped_count=0,
            score_min=None,
            score_p50=None,
            score_p90=None,
            score_max=None,
            fallback_used=False,
            fallback_mode=None,
            embedder_id=embedder_id,
            duration_ms=None,
        )


class ContextRelevanceGate:
    """Filter chunks/records by per-chunk cosine similarity computed in Cypher.

    The gate is a pure policy layer over already-scored items: it does NOT call
    the embedder, because Neo4j surfaces ``chunk_sim`` per chunk via
    ``vector.similarity.cosine($query_vector, chunk.embedding)``.

    Shadow mode preserves the counterfactual telemetry (what *would* have been
    dropped) while leaving the returned list unchanged.
    """

    def __init__(self, config: Config, embedder_id: str) -> None:
        self.config = config
        self.embedder_id = embedder_id

    # best-chunk-wins: a record passes if its top chunk is similar enough
    def _record_score(self, record: Any) -> float:
        content = getattr(record, "content", "")
        pairs = parse_chunk_score_pairs(content)
        return max((s for _, s in pairs), default=0.0)

    def _apply_threshold(
        self,
        scored_items: list[tuple[float, Any]],
    ) -> tuple[list[Any], bool, str | None]:
        min_score = RETRIEVER_RELEVANCE_MIN_SIMILARITY_SCORE
        kept = [item for item in scored_items if item[0] >= min_score]
        fallback_used = False
        fallback_mode: str | None = None
        min_keep = max(1, RETRIEVER_RELEVANCE_MIN_CHUNKS_AFTER_FILTER)

        if len(kept) < min_keep and scored_items:
            fallback_used = True
            fallback_mode = RETRIEVER_RELEVANCE_FALLBACK_MODE
            if RETRIEVER_RELEVANCE_FALLBACK_MODE == "relax_threshold":
                relaxed = RETRIEVER_RELEVANCE_RELAXED_SIMILARITY_SCORE
                kept = [item for item in scored_items if item[0] >= relaxed]
            if len(kept) < min_keep:
                kept = sorted(scored_items, key=lambda item: item[0], reverse=True)[:min_keep]

        kept = sorted(kept, key=lambda item: item[0], reverse=True)
        max_keep = max(1, RETRIEVER_RELEVANCE_MAX_CHUNKS_AFTER_FILTER)
        kept = kept[:max_keep]
        return [item[1] for item in kept], fallback_used, fallback_mode

    def _build_telemetry(
        self,
        *,
        scores: list[float],
        candidates_count: int,
        kept_count: int,
        fallback_used: bool,
        fallback_mode: str | None,
        duration_ms: float | None,
    ) -> RelevanceTelemetry:
        return RelevanceTelemetry(
            enabled=True,
            shadow_mode=self.config.retriever_relevance_shadow_mode,
            threshold=RETRIEVER_RELEVANCE_MIN_SIMILARITY_SCORE,
            candidates_count=candidates_count,
            kept_count=kept_count,
            dropped_count=max(0, candidates_count - kept_count),
            score_min=min(scores) if scores else None,
            score_p50=_percentile(scores, 0.5),
            score_p90=_percentile(scores, 0.9),
            score_max=max(scores) if scores else None,
            fallback_used=fallback_used,
            fallback_mode=fallback_mode,
            embedder_id=self.embedder_id,
            duration_ms=duration_ms,
        )

    def filter_chunks(self, scored_chunks: list[tuple[str, float]]) -> tuple[list[str], RelevanceTelemetry]:
        """Filter (text, cosine) pairs by threshold/policy.

        Returned text list is the gate's actual decision when filtering, or the
        unchanged input in shadow mode. Telemetry always reflects the gate's
        decision (counterfactual preserved in shadow mode).
        """
        if not self.config.retriever_relevance_gate_enabled:
            chunks = [c for c, _ in scored_chunks]
            return chunks, RelevanceTelemetry.disabled(self.config, self.embedder_id, len(chunks))

        start = perf_counter()
        scored = [(score, chunk) for chunk, score in scored_chunks]
        scores = [s for s, _ in scored]
        kept_chunks, fallback_used, fallback_mode = self._apply_threshold(scored)
        duration_ms = (perf_counter() - start) * 1000

        telemetry = self._build_telemetry(
            scores=scores,
            candidates_count=len(scored_chunks),
            kept_count=len(kept_chunks),
            fallback_used=fallback_used,
            fallback_mode=fallback_mode,
            duration_ms=duration_ms,
        )

        if self.config.retriever_relevance_shadow_mode:
            return [c for c, _ in scored_chunks], telemetry
        return kept_chunks, telemetry

    def filter_records(self, records: list[Any]) -> tuple[list[Any], RelevanceTelemetry]:
        """Filter records by their best chunk's cosine score.

        Returned record list is the gate's actual decision when filtering, or the
        unchanged input in shadow mode. Telemetry always reflects the gate's
        decision (counterfactual preserved in shadow mode).
        """
        if not self.config.retriever_relevance_gate_enabled:
            return records, RelevanceTelemetry.disabled(self.config, self.embedder_id, len(records))

        start = perf_counter()
        scored = [(self._record_score(record), record) for record in records]
        scores = [s for s, _ in scored]
        kept, fallback_used, fallback_mode = self._apply_threshold(scored)
        duration_ms = (perf_counter() - start) * 1000

        telemetry = self._build_telemetry(
            scores=scores,
            candidates_count=len(records),
            kept_count=len(kept),
            fallback_used=fallback_used,
            fallback_mode=fallback_mode,
            duration_ms=duration_ms,
        )

        logger.info(
            "Relevance gate: "
            f"shadow_mode={telemetry.shadow_mode}, "
            f"threshold={telemetry.threshold}, candidates={telemetry.candidates_count}, "
            f"kept={telemetry.kept_count}, dropped={telemetry.dropped_count}, "
            f"fallback={telemetry.fallback_mode if telemetry.fallback_used else 'none'}, "
            f"duration_ms={telemetry.duration_ms or 0.0:.2f}"
        )

        if self.config.retriever_relevance_shadow_mode:
            return records, telemetry
        return kept, telemetry


class RelevanceFilteredRetriever(BaseNeo4jRetriever):
    """Wraps a Neo4j retriever and filters records by per-chunk cosine relevance."""

    def __init__(
        self,
        base_retriever: BaseNeo4jRetriever,
        relevance_gate: ContextRelevanceGate,
    ) -> None:
        self.base_retriever = base_retriever
        self.relevance_gate = relevance_gate
        self.last_telemetry: RelevanceTelemetry | None = None
        get_formatter = getattr(base_retriever, "get_result_formatter", None)
        if callable(get_formatter):
            self.result_formatter = get_formatter()
        else:
            self.result_formatter = getattr(base_retriever, "result_formatter", None)

    def get_search_results(self, query_text: str, top_k: int = 5, **kwargs: Any) -> RawSearchResult:
        raw = self.base_retriever.get_search_results(query_text=query_text, top_k=top_k, **kwargs)
        filtered_records, telemetry = self.relevance_gate.filter_records(raw.records)
        self.last_telemetry = telemetry
        return RawSearchResult(records=filtered_records, metadata=raw.metadata)
