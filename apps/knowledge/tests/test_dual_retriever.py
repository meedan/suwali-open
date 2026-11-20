import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock, patch

from neo4j import Record
from neo4j_graphrag.filters import get_metadata_filter
from neo4j_graphrag.types import RawSearchResult, RetrieverResultItem

from app.core.constants import PRIORITIZED_PRIORITY_TIER, RETRIEVED_CHUNKS_SEPARATOR, SOURCE_DOCUMENT_TAG
from app.models.temporal import TemporalContext, TemporalPrecision, TemporalType
from app.services.dual_retriever import (
    DualRetriever,
    RecencyFirstRetriever,
    _doc_ids,
    _person_text_match_predicate,
    _pit_date_range,
    _recency_date_filter,
    build_recency_window_filter,
    build_retrieval_query,
    build_temporal_filters,
    relevance_gate_cypher_min_cosine,
    temporal_scoring_fragments,
)


def _build_person_filter_clause(person_names: list[str]) -> str:
    pred = _person_text_match_predicate(person_names)
    return f"WHERE {pred}" if pred else ""


def _make_record(content: str, metadata: dict[str, Any] | None = None) -> MagicMock:
    record = MagicMock(spec=Record)
    record.content = content
    record.metadata = metadata or {}
    return record


def _make_records(n: int, prefix: str = "item") -> list[MagicMock]:
    return [_make_record(f"{prefix}_{i}") for i in range(n)]


def _mock_retriever(records: list[Any]) -> MagicMock:
    r = MagicMock()
    r.get_search_results.return_value = RawSearchResult(records=records)
    return r


def _make_dual_retriever(sem: MagicMock, tmp: MagicMock, **kwargs: Any) -> DualRetriever:
    dr = DualRetriever(sem, tmp, **kwargs)

    def _formatter(record: Any) -> RetrieverResultItem:
        # support MagicMock records (.content attr) and real neo4j Records (str()).
        content = getattr(record, "content", None)
        if content is None:
            content = str(record)
        metadata = getattr(record, "metadata", {}) or {}
        return RetrieverResultItem(content=content, metadata=metadata)

    setattr(dr, "result_formatter", _formatter)
    return dr


# ---------------------------------------------------------------------------
# Search merging
# ---------------------------------------------------------------------------


def test_search_returns_temporal_first_then_semantic() -> None:
    sem_items = _make_records(3, "sem")
    tmp_items = _make_records(2, "tmp")
    sem = _mock_retriever(sem_items)
    tmp = _mock_retriever(tmp_items)

    dr = _make_dual_retriever(sem, tmp)
    result = dr.search("query", top_k=5)

    assert len(result.items) == 5
    assert [i.content for i in result.items] == [
        "tmp_0",
        "tmp_1",
        "sem_0",
        "sem_1",
        "sem_2",
    ]


def test_search_forwards_query_vector_to_both() -> None:
    sem = _mock_retriever([])
    tmp = _mock_retriever([])

    dr = _make_dual_retriever(sem, tmp)
    vec = [0.1, 0.2, 0.3]
    dr.search("query", top_k=5, query_vector=vec)

    sem.get_search_results.assert_called_once()
    tmp.get_search_results.assert_called_once()
    # semantic gets both query_text and query_vector (HybridCypherRetriever accepts both)
    assert sem.get_search_results.call_args[1]["query_vector"] == vec
    assert sem.get_search_results.call_args[1]["query_text"] == "query"
    # temporal gets only query_vector (VectorCypherRetriever requires exactly one)
    assert tmp.get_search_results.call_args[1]["query_vector"] == vec
    assert "query_text" not in tmp.get_search_results.call_args[1]


def test_search_temporal_gets_query_text_when_no_vector() -> None:
    sem = _mock_retriever([])
    tmp = _mock_retriever([])

    dr = _make_dual_retriever(sem, tmp)
    dr.search("query", top_k=5)

    tmp.get_search_results.assert_called_once()
    assert tmp.get_search_results.call_args[1]["query_text"] == "query"
    assert "query_vector" not in tmp.get_search_results.call_args[1]


def test_search_passes_full_top_k_to_semantic_and_multiplied_to_temporal() -> None:
    sem = _mock_retriever([])
    tmp = _mock_retriever([])

    dr = _make_dual_retriever(sem, tmp, temporal_top_k_multiplier=4)
    dr.search("query", top_k=10)

    assert sem.get_search_results.call_args[1]["top_k"] == 10
    assert tmp.get_search_results.call_args[1]["top_k"] == 40


def test_search_default_multiplier_passes_top_k_unchanged() -> None:
    sem = _mock_retriever([])
    tmp = _mock_retriever([])

    dr = _make_dual_retriever(sem, tmp)
    dr.search("query", top_k=5)

    assert sem.get_search_results.call_args[1]["top_k"] == 5
    assert tmp.get_search_results.call_args[1]["top_k"] == 5


def test_search_handles_empty_temporal_results() -> None:
    sem = _mock_retriever(_make_records(3, "sem"))
    tmp = _mock_retriever([])

    dr = _make_dual_retriever(sem, tmp)
    result = dr.search("query", top_k=5)

    assert len(result.items) == 3
    assert all(i.content.startswith("sem") for i in result.items)


def test_search_falls_back_to_semantic_on_temporal_error() -> None:
    sem = _mock_retriever(_make_records(3, "sem"))
    tmp = MagicMock()
    tmp.get_search_results.side_effect = RuntimeError("Cypher execution failed")

    dr = _make_dual_retriever(sem, tmp)
    result = dr.search("query", top_k=5)

    assert len(result.items) == 3
    assert all(i.content.startswith("sem") for i in result.items)


def _make_retriever_record(
    doc_ids: list[str],
    chunks: dict[str, str] | None = None,
    entities: str = "",
    published_at: str = "",
) -> Record:
    """Build a real neo4j Record that mimics what the Cypher retrieval query returns.

    ``chunks`` maps document ID to chunk text.  When ``None``, a default
    chunk text is generated for each doc_id.
    """
    if chunks is None:
        chunks = {did: f"Content for {did}" for did in doc_ids}
    pub_attr = f' published_at="{published_at}"' if published_at else ""
    doc_blocks = "\n".join(
        f'<{SOURCE_DOCUMENT_TAG} ref="{did}"{pub_attr}>\n{text}\n</{SOURCE_DOCUMENT_TAG}>'
        for did, text in chunks.items()
        if did in doc_ids
    )
    raw_chunks = RETRIEVED_CHUNKS_SEPARATOR.join(chunks.get(did, "") for did in doc_ids)
    scores = "|".join("0.9" for _ in doc_ids)
    context = f"=== text ===\n{doc_blocks}\n\n=== kg_rels ===\n{entities}"
    return Record(  # type: ignore[no-untyped-call]
        {
            "document_count": len(doc_ids),
            "document_ids_used": "|".join(doc_ids),
            "retrieved_chunks": raw_chunks,
            "chunk_scores": scores,
            "entities": entities,
            "context": context,
        }
    )


def test_search_keeps_semantic_record_on_partial_overlap() -> None:
    """Semantic record with unique docs is kept even if some overlap."""
    sem_rec = _make_retriever_record(["d1", "d2", "d3"])
    tmp_rec = _make_retriever_record(["d2", "d4"])
    sem = _mock_retriever([sem_rec])
    tmp = _mock_retriever([tmp_rec])

    dr = _make_dual_retriever(sem, tmp)
    result = dr.search("query", top_k=5)

    # d1, d3 only exist in semantic — record is kept (accepts d2 duplication).
    assert len(result.items) == 2
    assert result.items[0].content == str(tmp_rec)
    assert result.items[1].content == str(sem_rec)


def test_search_no_overlap_returns_both_temporal_first() -> None:
    """Disjoint doc IDs: both records kept, temporal first."""
    sem_rec = _make_retriever_record(["d1", "d2"])
    tmp_rec = _make_retriever_record(["d3", "d4"])
    sem = _mock_retriever([sem_rec])
    tmp = _mock_retriever([tmp_rec])

    dr = _make_dual_retriever(sem, tmp)
    result = dr.search("query", top_k=5)

    assert len(result.items) == 2
    assert result.items[0].content == str(tmp_rec)
    assert result.items[1].content == str(sem_rec)


def test_search_complete_overlap_returns_only_temporal() -> None:
    """All semantic docs also in temporal: only temporal record is returned."""
    sem_rec = _make_retriever_record(["d1", "d2"])
    tmp_rec = _make_retriever_record(["d1", "d2", "d3"])
    sem = _mock_retriever([sem_rec])
    tmp = _mock_retriever([tmp_rec])

    dr = _make_dual_retriever(sem, tmp)
    result = dr.search("query", top_k=5)

    assert len(result.items) == 1
    assert result.items[0].content == str(tmp_rec)


# ---------------------------------------------------------------------------
# Temporal filters forwarding
# ---------------------------------------------------------------------------


def test_temporal_filters_passed_only_to_temporal_retriever() -> None:
    sem = _mock_retriever([])
    tmp = _mock_retriever([])
    filters = {"published_at": {"$gt": datetime(1970, 1, 1, tzinfo=timezone.utc)}}

    dr = _make_dual_retriever(sem, tmp, temporal_filters=filters)
    dr.search("query", top_k=5)

    sem_kwargs = sem.get_search_results.call_args[1]
    tmp_kwargs = tmp.get_search_results.call_args[1]
    assert "filters" not in sem_kwargs
    assert tmp_kwargs["filters"] == filters


def test_no_filters_when_temporal_filters_is_none() -> None:
    sem = _mock_retriever([])
    tmp = _mock_retriever([])

    dr = _make_dual_retriever(sem, tmp, temporal_filters=None)
    dr.search("query", top_k=5)

    sem_kwargs = sem.get_search_results.call_args[1]
    tmp_kwargs = tmp.get_search_results.call_args[1]
    assert "filters" not in sem_kwargs
    assert "filters" not in tmp_kwargs


# ---------------------------------------------------------------------------
# build_temporal_filters
# ---------------------------------------------------------------------------


def test_recency_date_filter_returns_empty_without_window() -> None:
    ctx = TemporalContext(type=TemporalType.RECENCY)
    assert _recency_date_filter(ctx) == ""


def test_recency_date_filter_returns_empty_for_none() -> None:
    ctx = TemporalContext(type=TemporalType.NONE)
    assert _recency_date_filter(ctx) == ""


def test_recency_date_filter_returns_cypher_clause_with_window() -> None:
    fixed = date(2026, 4, 7)
    with patch("app.services.dual_retriever.date") as mock_date:
        mock_date.today.return_value = fixed
        ctx = TemporalContext(type=TemporalType.RECENCY, recency_window_days=7)
        clause = _recency_date_filter(ctx)
    assert "2026-04-01" in clause  # inclusive lower bound
    assert "2026-04-08" in clause  # exclusive upper bound (one day past 2026-04-07)
    assert "published_at IS NOT NULL" in clause
    # Native temporal comparison against datetime() literals.
    assert "chunk.published_at >= datetime('2026-04-01T00:00:00Z')" in clause
    assert "chunk.published_at < datetime('2026-04-08T00:00:00Z')" in clause


def _utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=timezone.utc)


def test_build_temporal_filters_recency() -> None:
    ctx = TemporalContext(type=TemporalType.RECENCY)
    # Fallback uses the unix-epoch sentinel as a "non-null" lower bound,
    # so NULL published_at values still fail the comparison and get filtered out.
    assert build_temporal_filters(ctx) == {"published_at": {"$gt": _utc(1970, 1, 1)}}


def test_build_temporal_filters_recency_with_window() -> None:
    fixed = date(2026, 4, 7)
    with patch("app.services.dual_retriever.date") as mock_date:
        mock_date.today.return_value = fixed
        ctx = TemporalContext(type=TemporalType.RECENCY, recency_window_days=7)
        assert build_temporal_filters(ctx) == {"published_at": {"$between": [_utc(2026, 4, 1), _utc(2026, 4, 7)]}}


# ---------------------------------------------------------------------------
# build_recency_window_filter / RecencyFirstRetriever
# ---------------------------------------------------------------------------


def test_build_recency_window_filter_returns_utc_midnight_cutoff() -> None:
    fixed = date(2026, 4, 7)
    expected_cutoff = datetime.combine(fixed - timedelta(days=90), datetime.min.time(), tzinfo=timezone.utc)
    with patch("app.services.dual_retriever.date") as mock_date:
        mock_date.today.return_value = fixed
        assert build_recency_window_filter(90) == {
            "$or": [
                {"published_at": {"$gte": expected_cutoff}},
                {"priority_tier": {"$eq": PRIORITIZED_PRIORITY_TIER}},
            ]
        }


def test_build_recency_window_filter_lets_prioritized_chunks_bypass_the_window() -> None:
    """An undated or old prioritized chunk (an editor contribution) must reach the recency-first
    pass; otherwise a recent source answers first and the full-corpus fallback never runs."""
    where, params = get_metadata_filter(build_recency_window_filter(30), node_alias="node")

    assert where == "(node.published_at >= $param_0) OR (node.priority_tier = $param_1)"
    assert params["param_1"] == PRIORITIZED_PRIORITY_TIER


def test_recency_first_retriever_injects_filters_and_prefers_query_vector() -> None:
    vector_retriever = _mock_retriever([])
    filters = {"published_at": {"$gte": _utc(2026, 1, 1)}}
    retriever = RecencyFirstRetriever(vector_retriever, filters)

    retriever.get_search_results("the query", top_k=5, query_vector=[0.1, 0.2])

    kwargs = vector_retriever.get_search_results.call_args[1]
    assert kwargs["filters"] == filters
    assert kwargs["query_vector"] == [0.1, 0.2]
    assert kwargs["top_k"] == 5
    assert "query_text" not in kwargs


def test_recency_first_retriever_uses_query_text_without_vector() -> None:
    vector_retriever = _mock_retriever([])
    filters = {"published_at": {"$gte": _utc(2026, 1, 1)}}
    retriever = RecencyFirstRetriever(vector_retriever, filters)

    retriever.get_search_results("the query", top_k=3)

    kwargs = vector_retriever.get_search_results.call_args[1]
    assert kwargs["filters"] == filters
    assert kwargs["query_text"] == "the query"
    assert kwargs["top_k"] == 3
    assert "query_vector" not in kwargs


def test_build_temporal_filters_pit_year() -> None:
    ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
    result = build_temporal_filters(ctx)
    assert result == {"published_at": {"$between": [_utc(2023, 10, 1), _utc(2025, 3, 31)]}}


def test_build_temporal_filters_pit_month() -> None:
    ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024-03")
    result = build_temporal_filters(ctx)
    assert "$between" in result["published_at"]
    start, end = result["published_at"]["$between"]
    assert start < _utc(2024, 3, 1)
    assert end > _utc(2024, 3, 31)


def test_build_temporal_filters_pit_day() -> None:
    ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024-03-15")
    result = build_temporal_filters(ctx)
    start, end = result["published_at"]["$between"]
    assert start == _utc(2024, 2, 14)
    assert end == _utc(2024, 4, 14)


def test_build_temporal_filters_pit_without_reference_date_falls_back_to_recency() -> None:
    ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date=None)
    assert build_temporal_filters(ctx) == {"published_at": {"$gt": _utc(1970, 1, 1)}}


# ---------------------------------------------------------------------------
# _pit_date_range
# ---------------------------------------------------------------------------


class TestPitDateRange:
    def test_year_precision(self) -> None:
        start, end = _pit_date_range("2024", TemporalPrecision.YEAR)
        assert start == "2023-10-01"
        assert end == "2025-03-31"

    def test_month_precision(self) -> None:
        start, end = _pit_date_range("2024-06", TemporalPrecision.MONTH)
        assert start < "2024-06-01"
        assert end > "2024-06-30"

    def test_day_precision(self) -> None:
        start, end = _pit_date_range("2024-06-15", TemporalPrecision.DAY)
        assert start == "2024-05-16"
        assert end == "2024-07-15"

    def test_month_precision_invalid_month_widens_to_year_range(self) -> None:
        # Regression: an LLM-supplied reference_date like "2026-26" (day value
        # sitting in the month slot, no month digits present at all) used to
        # crash monthrange() with IllegalMonthError instead of degrading.
        start, end = _pit_date_range("2026-26", TemporalPrecision.MONTH)
        assert start == "2025-10-01"
        assert end == "2027-03-31"

    def test_day_precision_recovers_day_month_swap(self) -> None:
        # "2026-26-01": month slot (26) is invalid but the day slot (01), read
        # as a month, is valid - unambiguous day/month swap, source was day-first.
        start, end = _pit_date_range("2026-26-01", TemporalPrecision.DAY)
        assert start == "2025-12-27"
        assert end == "2026-02-25"

    def test_day_precision_recovers_us_mm_dd_yyyy(self) -> None:
        # "01-26-2026": US format, year is the last (4-digit) component ->
        # month=01, day=26, year=2026 -> 26 Jan 2026.
        start, end = _pit_date_range("01-26-2026", TemporalPrecision.DAY)
        assert start == "2025-12-27"
        assert end == "2026-02-25"

    def test_day_precision_us_mm_dd_yyyy_invalid_month_falls_back_to_today(self) -> None:
        # "26-01-2026" is not valid US mm-dd-yyyy (26 is not a valid month)
        # and the year isn't first either, so there's nothing safe to recover.
        start, end = _pit_date_range("26-01-2026", TemporalPrecision.DAY)
        today = date.today()
        assert start == (today - timedelta(days=30)).isoformat()
        assert end == (today + timedelta(days=30)).isoformat()

    def test_day_precision_unparseable_falls_back_to_today(self) -> None:
        start, end = _pit_date_range("not-a-date", TemporalPrecision.DAY)
        today = date.today()
        assert start == (today - timedelta(days=30)).isoformat()
        assert end == (today + timedelta(days=30)).isoformat()


# ---------------------------------------------------------------------------
# TemporalContext properties
# ---------------------------------------------------------------------------


class TestTemporalContextPrecision:
    def test_none_when_no_reference_date(self) -> None:
        ctx = TemporalContext(type=TemporalType.RECENCY)
        assert ctx.precision is None

    def test_year(self) -> None:
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
        assert ctx.precision == TemporalPrecision.YEAR

    def test_month(self) -> None:
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024-03")
        assert ctx.precision == TemporalPrecision.MONTH

    def test_day(self) -> None:
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024-03-15")
        assert ctx.precision == TemporalPrecision.DAY


class TestTemporalContextReferenceDateFull:
    def test_none_when_no_reference_date(self) -> None:
        ctx = TemporalContext(type=TemporalType.RECENCY)
        assert ctx.reference_date_full is None

    def test_year_normalizes_to_mid_year(self) -> None:
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")
        assert ctx.reference_date_full == "2024-07-01"

    def test_month_normalizes_to_mid_month(self) -> None:
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024-03")
        assert ctx.reference_date_full == "2024-03-15"

    def test_day_unchanged(self) -> None:
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024-03-15")
        assert ctx.reference_date_full == "2024-03-15"


# ---------------------------------------------------------------------------
# build_retrieval_query
# ---------------------------------------------------------------------------


class TestBuildRetrievalQuery:
    def test_default_query_has_tier_weighted_ordering(self) -> None:
        query = build_retrieval_query(1, 100, 200, 500, 3000)
        assert "ORDER BY ranked_score DESC" in query
        assert "LIMIT 100" in query
        assert "final_score" not in query
        assert "score * priority_weight AS ranked_score" in query
        assert (
            "CASE WHEN d.priority_tier = -1 THEN 0.5 "
            "WHEN d.priority_tier = 1 THEN 1.0 "
            "WHEN d.priority_tier = 2 THEN 1.5 ELSE 1.0 END"
        ) in query
        assert RETRIEVED_CHUNKS_SEPARATOR in query
        assert "string.join([c IN limited_chunks | coalesce(c.text, '')]" in query
        assert "elementId(chunk)" in query
        assert "'details' IN keys(r)" in query
        assert "r['details']" in query

    def test_query_renders_document_title_attribute(self) -> None:
        # the title is the CMS field, so a mid-document chunk still carries the place its guide is for;
        # escaped so a title cannot close the tag or forge a ref= or prioritized= attribute
        query = build_retrieval_query(1, 100, 200, 500, 3000)
        assert "coalesce(d.title, '')" in query
        assert "cs_pair[4] AS chunk_title" in query
        assert (
            "CASE WHEN ci[5] <> '' THEN ' title=\"' + "
            "replace(replace(replace(replace(ci[5], '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '\"', '&quot;')"
            " + '\"' ELSE '' END"
        ) in query

    def test_query_includes_kg_rels_by_default(self) -> None:
        query = build_retrieval_query(1, 100, 200, 500, 3000)
        assert "=== kg_rels ===" in query
        assert "MATCH (entity)-[rel]-(connectedEntity:__Entity__)" in query
        assert "LIMIT 500\n          RETURN collect(rel) AS rels" in query

    def test_kg_rels_traversal_runs_once_per_distinct_entity(self) -> None:
        """An entity named in many retrieved chunks must not have its edges expanded once per chunk."""
        query = build_retrieval_query(1, 100, 200, 500, 3000)
        assert "collect(DISTINCT chunk) AS rel_chunks" in query
        assert "MATCH (rel_chunk)<-[:FROM_CHUNK]-(entity:__Entity__)\n          WITH DISTINCT entity" in query
        # the traversal follows the chunk_info aggregation, so it is not repeated per UNWOUND chunk
        assert query.index("WHERE size(chunk_info) > 0") < query.index("CALL (rel_chunks)")

    def test_kg_rels_edges_must_co_occur_in_a_chunk_of_the_same_hub(self) -> None:
        """Entities are shared across hubs; an edge is kept only when both ends come from one of
        this hub's chunks, so another hub's relationship text never reaches the context."""
        query = build_retrieval_query(793, 100, 200, 500, 3000)
        assert "EXISTS { MATCH (entity)-[:FROM_CHUNK]->(:Chunk_793)<-[:FROM_CHUNK]-(connectedEntity) }" in query
        # the hop must never reach a lexical node, of this hub or any other
        assert "(connectedEntity)-[:FROM_DOCUMENT]->" not in query
        assert "(connectedEntity)-[:FROM_CHUNK]->(:Chunk_793) }" not in query

    def test_query_omits_kg_rels_when_disabled(self) -> None:
        """Ablation switch for A/B evals: context must contain only the text
        section, and the entity-graph traversal must be skipped entirely."""
        query = build_retrieval_query(1, 100, 200, 500, 3000, include_kg_rels=False)
        assert "=== kg_rels ===" not in query
        assert "CALL (rel_chunks)" not in query
        assert "[] AS rels" in query
        # text section and telemetry fields are unaffected
        assert "=== text ===" in query
        assert "as entities" in query
        assert "as chunk_scores" in query

    def test_query_renders_causal_modality_and_evidence(self) -> None:
        """Causal/conditional edges carry modality + evidence properties written at
        ingestion; kg_rels must surface both so the answer LLM can weigh hedged or
        hypothetical links and quote the source phrase."""
        query = build_retrieval_query(1, 100, 200, 500, 3000)
        assert "'modality' IN keys(r)" in query
        assert "toString(r['modality'])" in query
        assert "'evidence' IN keys(r)" in query
        assert "substring(toString(r['evidence']), 0, 200)" in query

    def test_temporal_query_uses_final_score(self) -> None:
        query = build_retrieval_query(
            1,
            50,
            100,
            500,
            3000,
            temporal_filter="WHERE chunk.published_at IS NOT NULL",
            temporal_scoring="WITH d, chunk, score, 1.0 AS final_score",
            order_by="final_score",
        )
        assert "ORDER BY final_score DESC" in query
        assert "LIMIT 50" in query
        assert "WHERE chunk.published_at IS NOT NULL" in query

    def test_query_includes_score_floor_when_configured(self) -> None:
        query = build_retrieval_query(1, 50, 100, 500, 3000, score_floor=0.25)
        assert "WHERE score >= 0.250000" in query

    def test_query_omits_score_floor_clause_when_zero(self) -> None:
        query = build_retrieval_query(1, 50, 100, 500, 3000, score_floor=0.0)
        assert "WHERE score >=" not in query

    def test_person_names_and_score_floor_use_single_combined_where(self) -> None:
        query = build_retrieval_query(1, 50, 100, 500, 3000, person_names=["Elena Mirova"], score_floor=0.25)
        assert "toLower(chunk.text) CONTAINS 'elena mirova'" in query
        assert "AND score >= 0.250000" in query
        anchor = "WITH d, node AS chunk, score"
        start = query.index(anchor) + len(anchor)
        end = query.index("WITH d, chunk, score, vector.similarity.cosine")
        assert query[start:end].count("WHERE") == 1

    def test_query_surfaces_chunk_scores_field(self) -> None:
        query = build_retrieval_query(1, 50, 100, 500, 3000)
        assert "vector.similarity.cosine($query_vector, chunk.embedding) AS chunk_sim" in query
        # the gate parses this field on the Python side
        assert "as chunk_scores" in query
        assert "chunk_scores" in query.split("RETURN")[1]

    def test_query_includes_min_cosine_filter_when_configured(self) -> None:
        query = build_retrieval_query(1, 50, 100, 500, 3000, min_cosine=0.15)
        assert "WHERE chunk_sim >= 0.150000" in query

    def test_query_omits_min_cosine_filter_when_zero(self) -> None:
        query = build_retrieval_query(1, 50, 100, 500, 3000, min_cosine=0.0)
        assert "WHERE chunk_sim >=" not in query

    def test_min_cosine_from_relevance_gate_helper_in_query(self) -> None:
        config = MagicMock()
        config.retriever_relevance_gate_enabled = True
        config.retriever_relevance_shadow_mode = False
        mc = relevance_gate_cypher_min_cosine(config)
        query = build_retrieval_query(1, 50, 100, 500, 3000, min_cosine=mc)
        assert "WHERE chunk_sim >= 0.100000" in query

    def test_person_names_injects_where_clause(self) -> None:
        query = build_retrieval_query(1, 100, 200, 500, 3000, person_names=["Elena Mirova"])
        assert "toLower(chunk.text) CONTAINS 'elena mirova'" in query
        assert "toLower(chunk.text) CONTAINS 'mirova'" in query

    def test_place_names_boost_the_ordering_score_without_filtering(self) -> None:
        query = build_retrieval_query(1, 100, 200, 500, 3000, place_names=["Colorado"])
        assert "score * priority_weight AS ranked_score" in query
        assert (
            "ORDER BY ranked_score * CASE WHEN (chunk.text =~ '(?iUs).*(?<!\\\\w)colorado(?!\\\\w).*') "
            "THEN 1.500000 ELSE 1.0 END DESC"
        ) in query
        # a boost, never a filter: chunks that do not name the place stay in the pool
        assert "WHERE (chunk.text =~" not in query

    def test_place_boost_applies_after_the_temporal_blend(self) -> None:
        # the recency blend damps ranked_score to the (1 - alpha) share, so the boost multiplies final_score
        query = build_retrieval_query(
            1,
            100,
            200,
            500,
            3000,
            place_names=["Colorado"],
            temporal_scoring="WITH 1 AS final_score",
            order_by="final_score",
        )
        assert "ORDER BY final_score * CASE WHEN (chunk.text =~ '(?iUs).*(?<!\\\\w)colorado(?!\\\\w).*')" in query

    def test_place_names_are_deduplicated_and_escaped(self) -> None:
        query = build_retrieval_query(1, 100, 200, 500, 3000, place_names=["Côte d'Ivoire", "côte d'ivoire", " "])
        assert query.count("=~ '(?iUs).*(?<!\\\\w)côte\\\\s+d\\'ivoire(?!\\\\w).*'") == 1

    def test_place_names_are_matched_as_whole_words(self) -> None:
        # "US" must not boost every chunk holding business or because
        # a dot in the name is literal, a trailing dot still bounds, and a line break between tokens still matches
        query = build_retrieval_query(1, 100, 200, 500, 3000, place_names=["US", "St. Louis", "D.C."])
        assert "CONTAINS" not in query
        assert (
            "(chunk.text =~ '(?iUs).*(?<!\\\\w)us(?!\\\\w).*' "
            "OR chunk.text =~ '(?iUs).*(?<!\\\\w)st\\\\.\\\\s+louis(?!\\\\w).*' "
            "OR chunk.text =~ '(?iUs).*(?<!\\\\w)d\\\\.c\\\\.(?!\\\\w).*')"
        ) in query

    def test_no_place_names_leaves_the_ordering_unchanged(self) -> None:
        for places in (None, [], [" "]):
            query = build_retrieval_query(1, 100, 200, 500, 3000, place_names=places)
            assert "ORDER BY ranked_score DESC" in query
            assert "CASE WHEN (chunk.text =~" not in query

    def test_no_person_names_produces_no_filter(self) -> None:
        query = build_retrieval_query(1, 100, 200, 500, 3000, person_names=None)
        assert "CONTAINS" not in query
        query_empty = build_retrieval_query(1, 100, 200, 500, 3000, person_names=[])
        assert "CONTAINS" not in query_empty

    def test_query_emits_published_at_attribute_on_chunk_markup(self) -> None:
        """When a chunk has chunk.published_at set, the rendered <DOCUMENT> tag must
        carry a literal `published_at="..."` attribute so the LLM can attribute facts
        to their source year."""
        query = build_retrieval_query(1, 100, 200, 500, 3000)

        # the per-chunk tuple carries the published_at value alongside text/doc_id,
        # converted to an ISO string via toString() because chunk.published_at is a DateTime
        assert "coalesce(toString(chunk.published_at), '')" in query
        # the chunk markup conditionally appends the attribute when non-empty
        assert "' published_at=\"' + ci[3] + '\"'" in query
        # and only when non-empty (so undated chunks emit no attribute)
        assert "WHEN ci[3] <> ''" in query
        # the literal attribute name must appear in the rendered Cypher
        assert 'published_at="' in query

    def test_query_emits_prioritized_attribute_for_high_priority_tier(self) -> None:
        from app.core.constants import (
            DEFAULT_PRIORITY_TIER,
            PRIORITIZED_PRIORITY_TIER,
            SOURCE_PRIORITIZED_ATTRIBUTE,
        )

        query = build_retrieval_query(1, 100, 200, 500, 3000)
        assert f"WHEN toInteger(ci[4]) = {PRIORITIZED_PRIORITY_TIER}" in query
        assert f' {SOURCE_PRIORITIZED_ATTRIBUTE}="true"' in query
        assert f'{SOURCE_PRIORITIZED_ATTRIBUTE}="false"' not in query
        assert f"coalesce(d.priority_tier, {DEFAULT_PRIORITY_TIER})" in query
        assert "document_type" not in query
        assert "STARTS WITH" not in query

    def test_query_escapes_forged_document_tags_in_chunk_text(self) -> None:
        """Chunk text is escaped before being wrapped, so body content can never
        impersonate the server-generated <DOCUMENT ...> opening tag."""
        from app.core.constants import SOURCE_DOCUMENT_TAG

        query = build_retrieval_query(1, 100, 200, 500, 3000)
        assert f"'<{SOURCE_DOCUMENT_TAG}', '&lt;{SOURCE_DOCUMENT_TAG}'" in query
        # the escape wraps the truncated text expression, not just one branch
        assert "replace(CASE WHEN size(ci[1])" in query


class TestRelevanceGateCypherMinCosine:
    def test_returns_zero_when_gate_disabled(self) -> None:
        config = MagicMock()
        config.retriever_relevance_gate_enabled = False
        config.retriever_relevance_shadow_mode = False
        assert relevance_gate_cypher_min_cosine(config) == 0.0

    def test_returns_zero_when_shadow_mode(self) -> None:
        config = MagicMock()
        config.retriever_relevance_gate_enabled = True
        config.retriever_relevance_shadow_mode = True
        assert relevance_gate_cypher_min_cosine(config) == 0.0

    def test_returns_relaxed_similarity_when_gate_on_not_shadow(self) -> None:
        config = MagicMock()
        config.retriever_relevance_gate_enabled = True
        config.retriever_relevance_shadow_mode = False
        with patch(
            "app.services.dual_retriever.RETRIEVER_RELEVANCE_RELAXED_SIMILARITY_SCORE",
            0.11,
        ):
            assert relevance_gate_cypher_min_cosine(config) == 0.11


class TestBuildPersonFilterClause:
    def test_empty_list(self) -> None:
        assert _build_person_filter_clause([]) == ""

    def test_single_full_name(self) -> None:
        clause = _build_person_filter_clause(["John Smith"])
        assert "WHERE" in clause
        assert "toLower(chunk.text) CONTAINS 'john smith'" in clause
        assert "toLower(chunk.text) CONTAINS 'smith'" in clause

    def test_single_word_name_no_last_name_variant(self) -> None:
        clause = _build_person_filter_clause(["Madonna"])
        assert clause.count("CONTAINS") == 1
        assert "'madonna'" in clause

    def test_shared_last_name_deduped(self) -> None:
        clause = _build_person_filter_clause(["John Smith", "Bob Smith"])
        # smith should appear only once as standalone
        assert clause.count("'smith'") == 1

    def test_apostrophe_escaped(self) -> None:
        clause = _build_person_filter_clause(["O'Brien"])
        assert "o\\'brien" in clause

    def test_multiple_names_use_or(self) -> None:
        clause = _build_person_filter_clause(["Alice Jones", "Bob Lee"])
        assert " OR " in clause
        assert clause.count("CONTAINS") == 4  # alice jones, jones, bob lee, lee


# ---------------------------------------------------------------------------
# temporal_scoring_fragments
# ---------------------------------------------------------------------------


class TestTemporalScoringFragments:
    def test_recency_uses_today_and_recency_config(self) -> None:
        config = MagicMock()
        config.retriever_temporal_weight = 0.7
        config.retriever_temporal_decay_rate = 0.01
        ctx = TemporalContext(type=TemporalType.RECENCY)

        t_filter, t_scoring, order_by, alpha = temporal_scoring_fragments(ctx, config)

        assert "published_at IS NOT NULL" in t_filter
        assert "final_score" in t_scoring
        assert "ranked_score" in t_scoring
        assert "0.7" in t_scoring
        assert "0.01" in t_scoring
        assert order_by == "final_score"
        assert alpha == 0.7
        # IS NOT NULL guard so duration.inDays() isn't called on undated chunks;
        # the 999999 fallback orders any unfiltered NULL row last.
        assert "CASE WHEN chunk.published_at IS NOT NULL" in t_scoring
        assert "duration.inDays(chunk.published_at" in t_scoring
        assert "999999" in t_scoring

    def test_recency_window_adds_date_bounds_to_filter(self) -> None:
        config = MagicMock()
        config.retriever_temporal_weight = 0.7
        config.retriever_temporal_decay_rate = 0.01
        fixed = date(2026, 4, 7)
        with patch("app.services.dual_retriever.date") as mock_date:
            mock_date.today.return_value = fixed
            ctx = TemporalContext(type=TemporalType.RECENCY, recency_window_days=7)
            t_filter, _, _, _ = temporal_scoring_fragments(ctx, config)
        assert "2026-04-01" in t_filter  # inclusive lower bound
        assert "2026-04-08" in t_filter  # exclusive upper bound (one day past 2026-04-07)

    def test_pit_uses_reference_date_and_pit_config(self) -> None:
        config = MagicMock()
        config.retriever_temporal_weight_pit = 0.8
        config.retriever_temporal_decay_rate_pit = 0.05
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2025-03-15")

        t_filter, t_scoring, order_by, alpha = temporal_scoring_fragments(ctx, config)

        assert "2025-03-15" in t_scoring
        assert "0.8" in t_scoring
        assert "0.05" in t_scoring
        assert alpha == 0.8

    def test_pit_year_normalizes_reference_date(self) -> None:
        config = MagicMock()
        config.retriever_temporal_weight_pit = 0.8
        config.retriever_temporal_decay_rate_pit = 0.05
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date="2024")

        _, t_scoring, _, _ = temporal_scoring_fragments(ctx, config)

        assert "2024-07-01" in t_scoring

    def test_pit_rejects_cypher_injection_reference_date(self) -> None:
        # reference_date is LLM output; TemporalContext's field_validator must strip
        # anything that isn't a plausible YYYY / YYYY-MM / YYYY-MM-DD shape before it
        # ever reaches the datetime() literal built by string interpolation.
        config = MagicMock()
        config.retriever_temporal_weight_pit = 0.8
        config.retriever_temporal_decay_rate_pit = 0.05
        payload = "2024-01-01T00:00:00Z')).days ELSE 999999 END AS days_from_ref WITH d //"
        ctx = TemporalContext(type=TemporalType.POINT_IN_TIME, reference_date=payload)

        assert ctx.reference_date is None

        _, t_scoring, _, _ = temporal_scoring_fragments(ctx, config)

        assert payload not in t_scoring
        # falls back to today() instead, still a well-formed datetime() literal
        assert f"datetime('{date.today().isoformat()}T00:00:00Z')" in t_scoring

    def test_llm_interval_reference_date_never_reaches_datetime_literal(self) -> None:
        # regression: for "over the past five years" the classifier LLM emitted "2021-09-02/2026-09-02" as the date
        # unvalidated it reached the interpolated datetime() literal and Neo4j rejected the query (GqlError 22N36)
        from app.services.router.classifier import LLMClassificationOutput, QueryClassifier

        config = MagicMock()
        config.retriever_temporal_weight_pit = 0.8
        config.retriever_temporal_decay_rate_pit = 0.05
        config.retriever_temporal_weight = 0.7
        config.retriever_temporal_decay_rate = 0.01
        output = LLMClassificationOutput(
            sources=["internal_kb"],
            confidences=[0.8],
            reasoning="span-shaped question",
            temporal_type="point_in_time",
            temporal_reference_date="2021-09-02/2026-09-02",
        )
        ctx = QueryClassifier._parse_llm_temporal(output, "How did this change over the past five years?")

        _, t_scoring, _, _ = temporal_scoring_fragments(ctx, config)

        literals = re.findall(r"datetime\('([^']*)'\)", t_scoring)
        assert literals
        for literal in literals:
            datetime.fromisoformat(literal)  # raises ValueError on a malformed literal


# ---------------------------------------------------------------------------
# VectorCypherRetriever library bug verification
# ---------------------------------------------------------------------------


def test_vector_cypher_retriever_has_embedding_property_name_mismatch() -> None:
    """Verify the neo4j-graphrag bug: VectorCypherRetriever uses _node_embedding_property
    but the base class _fetch_index_infos sets _embedding_node_property.

    If this test fails, the library bug has been fixed and the workaround in
    DualRetriever.with_vector_prefilter can be removed.
    """
    from neo4j_graphrag.retrievers.base import Retriever as BaseRetriever
    from neo4j_graphrag.retrievers.vector import VectorCypherRetriever

    vcr_init_attr = "_node_embedding_property"
    vr_init_attr = "_embedding_node_property"
    base_sets_attr = "_embedding_node_property"

    # VectorRetriever uses the same name as the base class → no bug
    assert vr_init_attr == base_sets_attr

    # VectorCypherRetriever uses a different name → bug
    assert vcr_init_attr != base_sets_attr, (
        "Bug appears fixed! VectorCypherRetriever now uses the same attribute name. "
        "Remove the workaround in DualRetriever.with_vector_prefilter."
    )

    # Verify the attribute name VectorCypherRetriever actually reads in get_search_results
    import inspect

    src = inspect.getsource(VectorCypherRetriever.get_search_results)
    assert vcr_init_attr in src, f"Expected {vcr_init_attr!r} in get_search_results source"
    assert base_sets_attr not in src, f"Bug may be fixed: {base_sets_attr!r} found in get_search_results"

    # Verify the base class writes the other name
    base_src = inspect.getsource(BaseRetriever._fetch_index_infos)
    assert base_sets_attr in base_src
    assert vcr_init_attr not in base_src


# ---------------------------------------------------------------------------
# Hub isolation
#
# Hub scoping here is enforced entirely by which Cypher labels/index names
# get built for a given hub_id — there is no database-level tenant filter to
# fall back on (see AGENTS.md "Hub scoping"). These tests pin that invariant:
# a query or index name built for hub A must never contain hub B's identifiers.
# ---------------------------------------------------------------------------


class TestHubIsolationInQuery:
    def test_query_only_references_its_own_hub_labels(self) -> None:
        hub_a, hub_b = 7, 99
        query_a = build_retrieval_query(hub_a, 100, 200, 500, 3000)

        assert f"Document_{hub_a}" in query_a
        assert f"Chunk_{hub_a}" in query_a  # from the entity-graph EXISTS checks
        assert f"Document_{hub_b}" not in query_a
        assert f"Chunk_{hub_b}" not in query_a

    def test_query_labels_do_not_leak_across_hubs_in_either_direction(self) -> None:
        query_a = build_retrieval_query(7, 100, 200, 500, 3000)
        query_b = build_retrieval_query(99, 100, 200, 500, 3000)

        assert "Document_99" not in query_a
        assert "Chunk_99" not in query_a
        assert "Document_7" not in query_b
        assert "Chunk_7" not in query_b


class TestHubIsolationInIndexNames:
    """The vector/fulltext index names (`text_vectors_{hub_id}`,
    `text_fulltext_index_{hub_id}`) are the other half of hub scoping: the
    retriever's Neo4j index selection, not just the Cypher it runs."""

    def _config(self) -> MagicMock:
        config = MagicMock()
        config.retriever_document_limit = 10
        config.retriever_chunk_limit = 20
        config.retriever_relationship_limit = 50
        config.retriever_chunk_truncate_chars = 3000
        config.retriever_relevance_gate_enabled = False
        config.retriever_relevance_shadow_mode = False
        config.retriever_kg_rels_enabled = True
        config.retriever_temporal_top_k_multiplier = 1
        config.retriever_temporal_weight = 0.5
        config.retriever_temporal_decay_rate = 0.01
        return config

    @patch("app.services.dual_retriever.HybridCypherRetriever")
    def test_with_hybrid_temporal_scopes_index_names_to_hub(self, mock_hybrid: MagicMock) -> None:
        ctx = TemporalContext(type=TemporalType.NONE)

        DualRetriever.with_hybrid_temporal(MagicMock(), MagicMock(), 7, ctx, self._config())

        assert mock_hybrid.call_args_list  # both semantic and temporal retrievers built
        for call in mock_hybrid.call_args_list:
            assert call.kwargs["vector_index_name"] == "text_vectors_7"
            assert call.kwargs["fulltext_index_name"] == "text_fulltext_index_7"

    @patch("app.services.dual_retriever.VectorCypherRetriever")
    @patch("app.services.dual_retriever.HybridCypherRetriever")
    def test_with_vector_prefilter_scopes_index_names_to_hub(
        self, mock_hybrid: MagicMock, mock_vector: MagicMock
    ) -> None:
        ctx = TemporalContext(type=TemporalType.NONE)

        DualRetriever.with_vector_prefilter(MagicMock(), MagicMock(), 7, ctx, self._config())

        assert mock_hybrid.call_args.kwargs["vector_index_name"] == "text_vectors_7"
        assert mock_hybrid.call_args.kwargs["fulltext_index_name"] == "text_fulltext_index_7"
        assert mock_vector.call_args.kwargs["index_name"] == "text_vectors_7"

    @patch("app.services.dual_retriever.VectorCypherRetriever")
    def test_recency_first_retriever_scopes_index_name_to_hub(self, mock_vector: MagicMock) -> None:
        RecencyFirstRetriever.build(MagicMock(), MagicMock(), 7, 90, self._config())

        assert mock_vector.call_args.kwargs["index_name"] == "text_vectors_7"


# ---------------------------------------------------------------------------
# _doc_ids
# ---------------------------------------------------------------------------


class TestDocIds:
    def test_parses_pipe_separated_ids(self) -> None:
        rec = _make_retriever_record(["d1", "d2", "d3"])
        assert _doc_ids(rec) == {"d1", "d2", "d3"}

    def test_returns_empty_set_for_empty_ids(self) -> None:
        rec = Record(  # type: ignore[no-untyped-call]
            {
                "document_ids_used": "",
                "document_count": 0,
                "retrieved_chunks": "",
                "chunk_scores": "",
                "entities": "",
                "context": "",
            }
        )
        assert _doc_ids(rec) == set()

    def test_single_doc_id(self) -> None:
        rec = _make_retriever_record(["only_one"])
        assert _doc_ids(rec) == {"only_one"}
