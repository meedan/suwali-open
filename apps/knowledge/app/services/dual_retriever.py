from __future__ import annotations

import re
import sys
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any

from loguru import logger
from neo4j import Driver, Record
from neo4j_graphrag.embeddings.base import Embedder
from neo4j_graphrag.retrievers import HybridCypherRetriever
from neo4j_graphrag.retrievers.base import Retriever as BaseNeo4jRetriever
from neo4j_graphrag.retrievers.vector import VectorCypherRetriever
from neo4j_graphrag.types import RawSearchResult

from app.core.config import Config
from app.core.constants import (
    DEFAULT_PRIORITY_TIER,
    PRIORITIZED_PRIORITY_TIER,
    PRIORITY_TIER_WEIGHTS,
    RETRIEVED_CHUNKS_SEPARATOR,
    RETRIEVER_PLACE_MATCH_WEIGHT,
    RETRIEVER_RELEVANCE_RELAXED_SIMILARITY_SCORE,
    RETRIEVER_RELEVANCE_SCORE_FLOOR,
    SOURCE_DOCUMENT_TAG,
    SOURCE_PRIORITIZED_ATTRIBUTE,
)
from app.core.neo4j_retry import execute_with_retry
from app.models.temporal import TemporalContext, TemporalPrecision, TemporalType
from app.services.neo4j_timing import submit_in_context


def priority_tier_weight_case(tier_property: str = "d.priority_tier") -> str:
    """Return a Cypher CASE expression that maps priority tier to weight."""
    default_weight = PRIORITY_TIER_WEIGHTS[DEFAULT_PRIORITY_TIER]
    tier_cases = " ".join(
        f"WHEN {tier_property} = {tier} THEN {weight}" for tier, weight in PRIORITY_TIER_WEIGHTS.items()
    )
    return f"CASE {tier_cases} ELSE {default_weight} END"


def document_tag_attribute_cypher(published_at_expr: str, tier_expr: str, title_expr: str) -> str:
    """Cypher fragment appending published_at, prioritized and title attributes onto a DOCUMENT opening tag.

    The title is the CMS field, not chunk text. Chunking splits a state guide so only its first chunk
    names the state and the rest say "the State Election Board"; the title carries that scope to the
    generator, the judge and the subject gate for every chunk. Escaped so a title cannot close the tag
    or forge an attribute: a ref= or prioritized= inside it would otherwise read as server markup.
    """
    escaped_title = (
        f"replace(replace(replace(replace({title_expr}, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '\"', '&quot;')"
    )
    return (
        f"CASE WHEN {published_at_expr} <> '' "
        f"THEN ' published_at=\"' + {published_at_expr} + '\"' ELSE '' END + "
        f"CASE WHEN toInteger({tier_expr}) = {PRIORITIZED_PRIORITY_TIER} "
        f"THEN ' {SOURCE_PRIORITIZED_ATTRIBUTE}=\"true\"' ELSE '' END + "
        f"CASE WHEN {title_expr} <> '' THEN ' title=\"' + {escaped_title} + '\"' ELSE '' END"
    )


def escape_forged_document_tags_cypher(text_expr: str) -> str:
    """Cypher fragment escaping literal opening-tag tokens inside chunk text.

    The text is concatenated into real <DOCUMENT> wrapper tags right after this; an
    unescaped token would let document content impersonate the server-generated tag
    and its prioritized attribute to the prompt gate, the answer judge, and the
    generator. replace() is case-sensitive, matching the gate regexes in constants.
    """
    return f"replace({text_expr}, '<{SOURCE_DOCUMENT_TAG}', '&lt;{SOURCE_DOCUMENT_TAG}')"


def _doc_ids(record: Record) -> set[str]:
    """Extract document IDs from a retriever Record via direct field access."""
    raw: str = record.get("document_ids_used", "")
    return {d for d in raw.split("|") if d}


def _person_text_match_predicate(person_names: list[str]) -> str | None:
    """Return a parenthesized Cypher boolean on ``chunk.text``, or ``None`` when no filter."""
    if not person_names:
        return None
    # full names + last-name-only variants for broader matching
    search_terms: list[str] = []
    seen: set[str] = set()
    for name in person_names:
        lower = name.lower()
        if lower not in seen:
            seen.add(lower)
            search_terms.append(lower)
        parts = name.split()
        if len(parts) > 1:
            last = parts[-1].lower()
            if last not in seen:
                seen.add(last)
                search_terms.append(last)
    escaped = [t.replace("\\", "\\\\").replace("'", "\\'") for t in search_terms]
    conditions = " OR ".join(f"toLower(chunk.text) CONTAINS '{t}'" for t in escaped)
    return f"({conditions})"


def _place_text_match_predicate(place_names: list[str]) -> str | None:
    """Return a parenthesized Cypher boolean on ``chunk.text``, or ``None`` when no place is asked about.

    Matched as a whole word, not a substring: "US" is in business and because, "India" in Indiana,
    so a CONTAINS boost would lift most of the pool. Lookarounds rather than \\b, so a name ending in
    punctuation ("D.C.") still bounds; a whitespace run between tokens, so a name split across a line
    break in the chunk still matches. Java regex flags: i for case, s so the dot crosses newlines, U so
    word characters and case cover non-Latin scripts too.
    """
    terms: list[str] = []
    seen: set[str] = set()
    for name in place_names:
        lower = name.strip().lower()
        if lower and lower not in seen:
            seen.add(lower)
            terms.append(lower)
    if not terms:
        return None
    # re.escape first, then the cypher string escapes: a backslash the regex needs reaches cypher doubled
    patterns = [r"\s+".join(re.escape(token) for token in t.split()) for t in terms]
    escaped = [p.replace("\\", "\\\\").replace("'", "\\'") for p in patterns]
    conditions = " OR ".join(f"chunk.text =~ '(?iUs).*(?<!\\\\w){t}(?!\\\\w).*'" for t in escaped)
    return f"({conditions})"


def _place_boost_expr(place_names: list[str] | None, weight: float) -> str:
    """Multiplier appended to the ordering score; empty when no place is asked about so the query is unchanged."""
    pred = _place_text_match_predicate(place_names or [])
    if pred is None:
        return ""
    return f" * CASE WHEN {pred} THEN {weight:.6f} ELSE 1.0 END"


def _where_after_initial_with(person_names: list[str] | None, score_floor: float) -> str:
    """Single ``WHERE`` after ``WITH d, node AS chunk, score``"""
    pred = _person_text_match_predicate(person_names or [])
    score_clause = score_floor > 0.0
    if pred is None and not score_clause:
        return ""
    if pred is not None and not score_clause:
        return f"WHERE {pred}"
    if pred is None and score_clause:
        return f"WHERE score >= {score_floor:.6f}"
    return f"WHERE {pred} AND score >= {score_floor:.6f}"


def relevance_gate_cypher_min_cosine(config: Config) -> float:
    """Cypher-level cosine pre-filter; uses the relaxed threshold so Python's
    relax-on-fallback policy still has headroom. Disabled in shadow mode and
    when the gate is off — Cypher behaviour must not change unless the gate
    is actively filtering."""
    if not config.retriever_relevance_gate_enabled or config.retriever_relevance_shadow_mode:
        return 0.0
    return RETRIEVER_RELEVANCE_RELAXED_SIMILARITY_SCORE


def build_retrieval_query(
    hub_id: int,
    doc_limit: int,
    chunk_limit: int,
    rel_limit: int,
    truncate_at: int,
    *,
    temporal_scoring: str = "",
    temporal_filter: str = "",
    order_by: str = "ranked_score",
    person_names: list[str] | None = None,
    place_names: list[str] | None = None,
    place_weight: float = RETRIEVER_PLACE_MATCH_WEIGHT,
    score_floor: float = 0.0,
    min_cosine: float = 0.0,
    include_kg_rels: bool = True,
) -> str:
    """Build the retrieval-query Cypher used by Hybrid/VectorCypherRetriever.

    ``place_names`` is a boost, not a filter: a chunk whose text names an asked place has its ordering
    score multiplied by ``place_weight``, other chunks keep theirs.
    It multiplies the score the rows are ordered by, so in the temporal pass it applies after the recency blend.
    The boost reorders the index candidates only; a chunk the index did not return cannot be lifted.

    The retriever's ``score`` (RRF for Hybrid, raw cosine for Vector) drives
    ordering. Per-chunk cosine similarity ``chunk_sim`` is computed inline
    against the library-provided ``$query_vector`` parameter so the gate can
    threshold without re-embedding chunks via the embedder API.

    ``score_floor`` filters on the retriever score (RRF/hybrid scale).
    ``min_cosine`` filters on per-chunk cosine similarity (cosine scale,
    typically in [0, 1]).

    ``include_kg_rels`` (ablation switch): when False, the entity-graph
    traversal is skipped and the context contains only the ``=== text ===``
    section — no ``=== kg_rels ===`` block and an empty ``entities`` field.
    """
    tier_weight_case = priority_tier_weight_case("d.priority_tier")
    initial_where = _where_after_initial_with(person_names, score_floor)
    place_boost = _place_boost_expr(place_names, place_weight)
    cosine_floor_filter = f"WHERE chunk_sim >= {min_cosine:.6f}" if min_cosine > 0.0 else ""
    truncated_text = (
        f"CASE WHEN size(ci[1]) > {truncate_at} THEN substring(ci[1], 0, {truncate_at}) + '...' ELSE ci[1] END"
    )

    if include_kg_rels:
        # Entity nodes are shared across hubs (the KG builder's resolver merges them globally by
        # label + name), so an edge between two entities this hub knows may have been extracted
        # from another hub's chunk and carry that hub's text in `details`/`evidence`.
        # Both ends are pinned to :__Entity__ so the hop never lands on any hub's Chunk/Document,
        # and the edge is kept only when its two ends co-occur in one :Chunk_{hub_id}: the extractor
        # only relates entities from the same chunk, so every edge this hub produced satisfies it.
        # Known gap: an edge extracted in another hub between a pair that also co-occurs in one of
        # this hub's chunks still passes — closing that needs hub provenance stamped on the edge.
        # Expanded once per distinct entity; LIMIT stops the EXISTS checks at rel_limit, the aggregate keeps the row.
        rel_traversal = f"""
        CALL (rel_chunks) {{
          UNWIND rel_chunks AS rel_chunk
          MATCH (rel_chunk)<-[:FROM_CHUNK]-(entity:__Entity__)
          WITH DISTINCT entity
          MATCH (entity)-[rel]-(connectedEntity:__Entity__)
          WHERE type(rel) <> 'FROM_CHUNK'
            AND EXISTS {{ MATCH (entity)-[:FROM_CHUNK]->(:Chunk_{hub_id})<-[:FROM_CHUNK]-(connectedEntity) }}
          WITH DISTINCT rel
          LIMIT {rel_limit}
          RETURN collect(rel) AS rels
        }}
        """
        rels_collect = "collect(DISTINCT chunk) AS rel_chunks"
        kg_rels_context = """ +
                '\\n\\n=== kg_rels ===\\n' +
                string.join([r IN rels |
                   coalesce(startNode(r).name, 'Unknown') + ' - ' +
                   type(r) +
                   CASE WHEN 'details' IN keys(r)
                     THEN '(' + substring(toString(r['details']), 0, 200) + ')'
                     ELSE '' END +
                   // causal/conditional edges carry modality + verbatim evidence so the
                   // answer LLM can weigh hedged/hypothetical links and quote the source
                   CASE WHEN 'modality' IN keys(r) OR 'evidence' IN keys(r)
                     THEN '[' +
                       CASE WHEN 'modality' IN keys(r) THEN toString(r['modality']) ELSE '' END +
                       CASE WHEN 'modality' IN keys(r) AND 'evidence' IN keys(r) THEN ': ' ELSE '' END +
                       CASE WHEN 'evidence' IN keys(r)
                         THEN '"' + substring(toString(r['evidence']), 0, 200) + '"'
                         ELSE '' END +
                       ']'
                     ELSE '' END +
                   ' -> ' +
                   coalesce(endNode(r).name, 'Unknown')
                ], '\\n---\\n')"""
    else:
        rel_traversal = ""
        rels_collect = "[] AS rels"
        kg_rels_context = ""

    return f"""
        // `node` is already bound by the retriever wrapper to a chunk resolved via the
        // vector/fulltext index. Starting from the bound node and traversing one outgoing
        // FROM_DOCUMENT edge is O(1) per row. Writing the pattern with labels on BOTH
        // ends (the prior `MATCH (d:Document_{{hub_id}})<-[:FROM_DOCUMENT]-(node:Chunk_{{hub_id}})`)
        // let the planner choose a NodeByLabelScan on the labeled side, so query cost grew
        // linearly with the number of documents/chunks in the hub.
        MATCH (node)-[:FROM_DOCUMENT]->(d:Document_{hub_id})
        WITH d, node AS chunk, score
        {initial_where}
        WITH d, chunk, score, vector.similarity.cosine($query_vector, chunk.embedding) AS chunk_sim
        {cosine_floor_filter}
        WITH d, chunk, score, chunk_sim,
          {tier_weight_case} AS priority_weight
        WITH d, chunk, score, chunk_sim, priority_weight, score * priority_weight AS ranked_score
        {temporal_filter}
        {temporal_scoring}
        ORDER BY {order_by}{place_boost} DESC
        LIMIT {doc_limit}

        // Carry d.document_id and d.priority_tier alongside each chunk to avoid the extra
        // MATCH (chunk)-[:FROM_DOCUMENT]->(chunk_doc:Document_{{hub_id}}) after UNWIND;
        // the relationship is many-to-one so (d, chunk) is already unique by chunk.
        WITH collect(DISTINCT d) AS docs,
             collect(DISTINCT [
               chunk, chunk_sim, coalesce(d.document_id, ''),
               coalesce(d.priority_tier, {DEFAULT_PRIORITY_TIER}),
               coalesce(d.title, '')
             ])[0..{chunk_limit}] AS limited_chunks_scored
        WITH docs, limited_chunks_scored,
             [cs IN limited_chunks_scored | cs[0]] AS limited_chunks,
             [cs IN limited_chunks_scored | toString(coalesce(cs[1], 0.0))] AS chunk_score_strs
        WITH size(docs) AS document_count
          , string.join([d IN docs | coalesce(d.document_id, '')], '|') as document_ids_used
          , string.join([c IN limited_chunks | coalesce(c.text, '')], '{RETRIEVED_CHUNKS_SEPARATOR}') as retrieved_chunks
          , string.join(chunk_score_strs, '|') as chunk_scores
          , limited_chunks_scored
        UNWIND limited_chunks_scored AS cs_pair
        WITH document_count, document_ids_used, retrieved_chunks, chunk_scores,
             cs_pair[0] AS chunk, cs_pair[2] AS chunk_doc_id, cs_pair[3] AS chunk_priority_tier,
             cs_pair[4] AS chunk_title

        WITH document_count, document_ids_used, retrieved_chunks, chunk_scores,
            // ci[0]=elementId, ci[1]=text, ci[2]=document_id, ci[3]=published_at, ci[4]=priority_tier, ci[5]=title
            // toString() formats the stored DateTime as ISO-8601; coalesce maps NULL → '' so the downstream
            // ` ' published_at="...' ` attribute is conditionally suppressed for undated chunks.
            collect(DISTINCT [
              elementId(chunk), chunk.text, chunk_doc_id,
              coalesce(toString(chunk.published_at), ''), chunk_priority_tier, chunk_title
            ]) AS chunk_info,
            {rels_collect}
        WHERE size(chunk_info) > 0
        {rel_traversal}

        // published_at lets the LLM see source freshness and prefer recent articles
        WITH [ci IN chunk_info |
          '<{SOURCE_DOCUMENT_TAG} ref="' + ci[2] + '"' +
          {document_tag_attribute_cypher("ci[3]", "ci[4]", "ci[5]")} +
          '>\\n' +
          {escape_forged_document_tags_cypher(truncated_text)} +
          '\\n</{SOURCE_DOCUMENT_TAG}>'
        ] AS truncated_chunks, rels, document_count, document_ids_used, retrieved_chunks, chunk_scores

        RETURN document_count, document_ids_used, retrieved_chunks, chunk_scores,

                string.join([r IN rels |
                  last(labels(startNode(r))) + "-"
                  + type(r) + "->" + last(labels(endNode(r)))
                ], "\\n") as entities,

                '=== text ===\\n' +
                string.join([c IN truncated_chunks | coalesce(c, '')], '\\n'){kg_rels_context} AS context
        """


def recency_window_bounds(today: date, days: int) -> tuple[str, str]:
    """Inclusive window ending today: last ``days`` calendar days including today."""
    if days < 1:
        days = 1
    end = today
    start = today - timedelta(days=days - 1)
    return start.isoformat(), end.isoformat()


# chunk.published_at is stored as a Neo4j DateTime. The driver writes it via
# datetime($published_at) at ingest time (see ingestor.py). Read-side code must
# therefore treat it as a temporal value: compare against datetime() literals,
# not ISO strings; never wrap it in datetime() again; serialize back to ISO via
# toString() when projecting for the LLM.
_TEMPORAL_BASE_FILTER = "WHERE chunk.published_at IS NOT NULL"


def _cypher_datetime_literal(iso_date: str) -> str:
    """Render a YYYY-MM-DD as a UTC-anchored Cypher ``datetime()`` literal."""
    return f"datetime('{iso_date}T00:00:00Z')"


def _recency_date_filter(temporal_context: TemporalContext) -> str:
    """Cypher filter that hard-filters chunks to the recency window.

    Returns an empty string when there is no hard window, so callers can
    unconditionally interpolate the result into a query.

    Comparisons use native ``datetime()`` literals against the stored DateTime
    value. The upper bound is exclusive (next day at 00:00 UTC) so timestamps
    with a time component on the boundary day still match the inclusive window.
    """
    tc = temporal_context
    if tc.type != TemporalType.RECENCY or not tc.recency_window_days or tc.recency_window_days < 1:
        return ""
    today = date.today()
    start_iso, _ = recency_window_bounds(today, tc.recency_window_days)
    end_exclusive = (today + timedelta(days=1)).isoformat()
    return (
        f"{_TEMPORAL_BASE_FILTER}\n"
        f"AND chunk.published_at >= {_cypher_datetime_literal(start_iso)}"
        f" AND chunk.published_at < {_cypher_datetime_literal(end_exclusive)}"
    )


def temporal_scoring_fragments(
    temporal_context: TemporalContext,
    config: Config,
) -> tuple[str, str, str, float]:
    """Build Cypher fragments for the temporal retriever.

    Returns (temporal_filter, temporal_scoring, order_by, effective_alpha).
    """
    tc = temporal_context
    is_pit = tc.type == TemporalType.POINT_IN_TIME

    alpha = config.retriever_temporal_weight_pit if is_pit else config.retriever_temporal_weight
    decay = config.retriever_temporal_decay_rate_pit if is_pit else config.retriever_temporal_decay_rate
    # reference_date_full is Optional[str], so fall through to today() if the PIT
    # context lacks a fully-resolved date — keeps ref_date typed as str for the
    # downstream datetime() literal builder.
    if is_pit and tc.reference_date and tc.reference_date_full:
        ref_date = tc.reference_date_full
    else:
        ref_date = date.today().isoformat()

    logger.info(f"Temporal retriever: type={tc.type.value}, ref={ref_date}, α={alpha}, λ={decay}")

    recency_filter = _recency_date_filter(tc)
    temporal_filter = recency_filter if recency_filter else _TEMPORAL_BASE_FILTER

    # The IS NOT NULL guard keeps duration.inDays() from receiving NULL; the
    # 999999 fallback pushes undated rows that slipped past upstream filters
    # to the bottom of the final_score ordering.
    temporal_scoring = f"""
        WITH d, chunk, score, chunk_sim, ranked_score,
          CASE WHEN chunk.published_at IS NOT NULL
               THEN abs(duration.inDays(chunk.published_at, {_cypher_datetime_literal(ref_date)}).days)
               ELSE 999999
          END AS days_from_ref
        WITH d, chunk, score, chunk_sim, ranked_score,
          ranked_score * (1.0 - {alpha}) + exp(-{decay} * toFloat(days_from_ref)) * {alpha} AS final_score"""

    return temporal_filter, temporal_scoring, "final_score", alpha


def _safe_year(reference_date: str) -> int:
    """Extract the leading 4-digit year, falling back to the current year."""
    year_str = reference_date[:4]
    if year_str.isdigit():
        return int(year_str)
    logger.warning(f"Invalid year in temporal reference_date {reference_date!r}; falling back to current year")
    return date.today().year


def _safe_month(month_str: str) -> int | None:
    """Parse a 2-digit month, or ``None`` if it's missing/out of the 1-12 range."""
    if month_str.isdigit() and 1 <= int(month_str) <= 12:
        return int(month_str)
    return None


def _try_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _safe_day_date(reference_date: str) -> date:
    """Parse a full reference date, recovering from non-ISO component orders.

    ``reference_date`` is expected to be ISO "YYYY-MM-DD" (see
    ``TemporalContext.reference_date``), but it can arrive with day/month
    swapped while still year-first (source was day-first, e.g. "2026-26-01"
    -> 26 Jan 2026), or in US "MM-DD-YYYY" order where the year comes last
    (e.g. "01-26-2026" -> 26 Jan 2026). Anything else degrades to today
    rather than raising.
    """
    try:
        return date.fromisoformat(reference_date)
    except ValueError:
        pass

    parts = reference_date.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        if len(parts[0]) != 4 and len(parts[2]) == 4:
            # US format: MM-DD-YYYY - the year is the last, 4-digit component.
            month, day, year = int(parts[0]), int(parts[1]), int(parts[2])
            if 1 <= month <= 12 and 1 <= day <= 31:
                parsed = _try_date(year, month, day)
                if parsed is not None:
                    logger.warning(
                        f"Temporal reference_date {reference_date!r} looked like US mm-dd-yyyy; "
                        f"using {parsed.isoformat()}"
                    )
                    return parsed
        elif len(parts[0]) == 4:
            # Year-first but day/month swapped.
            year, first, second = int(parts[0]), int(parts[1]), int(parts[2])
            if 1 <= second <= 12 and 1 <= first <= 31:
                swapped = _try_date(year, second, first)
                if swapped is not None:
                    logger.warning(
                        f"Temporal reference_date {reference_date!r} looked day/month-swapped; "
                        f"using {swapped.isoformat()}"
                    )
                    return swapped

    logger.warning(f"Unparseable temporal reference_date {reference_date!r}; falling back to today")
    return date.today()


def _pit_date_range(reference_date: str, precision: TemporalPrecision) -> tuple[str, str]:
    """Compute filter date bounds for a POINT_IN_TIME query.

    ``reference_date`` is documented (see ``TemporalContext.reference_date``) as
    ISO-ordered "YYYY" / "YYYY-MM" / "YYYY-MM-DD", but it's produced by an LLM
    classification and isn't guaranteed to honor that shape or value ranges (an
    out-of-range or day/month-swapped value previously crashed monthrange()/
    date() with an unhandled exception). Every branch validates before use and
    degrades to a wider/safer range instead of raising.
    """
    if precision == TemporalPrecision.YEAR:
        year = _safe_year(reference_date)
        return f"{year - 1}-10-01", f"{year + 1}-03-31"

    if precision == TemporalPrecision.MONTH:
        year = _safe_year(reference_date)
        month = _safe_month(reference_date[5:7]) if len(reference_date) >= 7 else None
        if month is None:
            # Only "YYYY-MM" is expected here, so there's no second component to
            # recover a missing/invalid month from - degrade to the same
            # year-wide window used at YEAR precision instead of crashing.
            logger.warning(f"Invalid month in temporal reference_date {reference_date!r}; widening to year range")
            return f"{year - 1}-10-01", f"{year + 1}-03-31"
        _, last_day = monthrange(year, month)
        start = date(year, month, 1) - timedelta(days=60)
        end = date(year, month, last_day) + timedelta(days=60)
        return start.isoformat(), end.isoformat()

    d = _safe_day_date(reference_date)
    return (d - timedelta(days=30)).isoformat(), (d + timedelta(days=30)).isoformat()


def _utc_midnight(iso_date: str) -> datetime:
    """Parse a YYYY-MM-DD into a tz-aware Python ``datetime`` at UTC midnight.

    The neo4j Python driver auto-converts ``datetime`` parameters to a native
    ``DateTime`` value, so these objects compare directly against the stored
    ``chunk.published_at`` temporal property. We route the parse through
    ``datetime.fromisoformat`` (not ``date.fromisoformat``) because some unit
    tests patch the module-level ``date`` symbol, and going via ``date`` would
    pick up the mock.
    """
    return datetime.fromisoformat(iso_date).replace(tzinfo=timezone.utc)


# Sentinel "before any real published_at" — used by the fallback filter so the
# pre-filter pipeline still excludes undated chunks now that the empty-string
# trick (``$gt: ""``) is meaningless against a DateTime property.
_MIN_DATETIME = datetime(1970, 1, 1, tzinfo=timezone.utc)


def build_temporal_filters(temporal_context: TemporalContext) -> dict[str, Any]:
    """Build neo4j-graphrag pre-filters for temporal queries.

    Values must be Python ``datetime`` instances (not ISO strings) because the
    target property is a Neo4j ``DateTime`` and the library passes the filter
    value straight through as a query parameter — string vs DateTime comparison
    yields NULL in Cypher and filters every row out.
    """
    if temporal_context.type == TemporalType.POINT_IN_TIME and temporal_context.reference_date:
        precision = temporal_context.precision or TemporalPrecision.DAY
        start, end = _pit_date_range(temporal_context.reference_date, precision)
        logger.info(f"PIT filter: precision={precision.value}, range={start} to {end}")
        return {"published_at": {"$between": [_utc_midnight(start), _utc_midnight(end)]}}

    if (
        temporal_context.type == TemporalType.RECENCY
        and temporal_context.recency_window_days is not None
        and temporal_context.recency_window_days > 0
    ):
        start, end = recency_window_bounds(date.today(), temporal_context.recency_window_days)
        logger.info(f"Recency window filter: {start} to {end} (inclusive)")
        return {"published_at": {"$between": [_utc_midnight(start), _utc_midnight(end)]}}

    # RECENCY without a window or fallback: require any published_at value.
    # NULL fails ``> _MIN_DATETIME``, so undated chunks are still excluded —
    # same intent as the prior empty-string check, expressed natively.
    return {"published_at": {"$gt": _MIN_DATETIME}}


def build_recency_window_filter(window_days: int) -> dict[str, Any]:
    """Build a neo4j-graphrag pre-filter restricting search to the last ``window_days``.

    Drives the recency-first pass: a one-sided ``published_at >= cutoff`` window so
    the exact-KNN pre-filter only scans recent chunks. Undated chunks (NULL
    published_at) fail the comparison and are excluded — they surface only in the
    full-corpus fallback. The cutoff is a tz-aware ``datetime`` so it compares
    directly against the stored ``DateTime`` property.

    Prioritized chunks bypass the window whatever their date: they are authoritative
    even when older, and an undated one (an editor contribution) would otherwise lose to
    any recent source that answers first, because a sufficient recent answer skips the
    fallback. Chunks ingested before ``priority_tier`` was stored on chunks lack it and
    stay windowed until re-ingested.
    """
    cutoff = _utc_midnight((date.today() - timedelta(days=window_days)).isoformat())
    logger.info(
        f"Recency-first window filter: published_at >= {cutoff.date().isoformat()} ({window_days}d) "
        f"or priority_tier = {PRIORITIZED_PRIORITY_TIER}"
    )
    return {
        "$or": [
            {"published_at": {"$gte": cutoff}},
            {"priority_tier": {"$eq": PRIORITIZED_PRIORITY_TIER}},
        ]
    }


def _patch_vector_embedding_property(retriever: VectorCypherRetriever) -> None:
    """Work around a neo4j-graphrag attribute-name mismatch on VectorCypherRetriever.

    VectorCypherRetriever.__init__ creates ``_node_embedding_property`` but
    ``_fetch_index_infos`` (base class) populates ``_embedding_node_property``
    instead. Without this patch, filtered search raises because
    ``embedding_node_property`` is None. When (if)
    test_vector_cypher_retriever_has_embedding_property_name_mismatch or
    test_vector_cypher_retriever_filtered_search_requires_embedding_property_patch
    start to fail it's (probably:) time to remove this patch.
    """
    if retriever._node_embedding_property is None and retriever._embedding_node_property is not None:
        retriever._node_embedding_property = retriever._embedding_node_property


class DualRetriever(BaseNeo4jRetriever):
    """Composite retriever that merges results from a semantic and a temporal retriever."""

    def __init__(
        self,
        semantic_retriever: BaseNeo4jRetriever,
        temporal_retriever: BaseNeo4jRetriever,
        temporal_top_k_multiplier: int = 1,
        temporal_filters: dict[str, Any] | None = None,
        temporal_alpha: float | None = None,
    ) -> None:
        self.semantic_retriever = semantic_retriever
        self.temporal_retriever = temporal_retriever
        self.temporal_top_k_multiplier = max(1, temporal_top_k_multiplier)
        self.temporal_filters = temporal_filters
        self.temporal_alpha = temporal_alpha

    @classmethod
    def with_hybrid_temporal(
        cls,
        driver: Driver,
        embedder: Embedder,
        hub_id: int,
        temporal_context: TemporalContext,
        config: Config,
        *,
        person_names: list[str] | None = None,
        place_names: list[str] | None = None,
    ) -> DualRetriever:
        """Both sub-retrievers are HybridCypherRetriever (original approach)."""
        doc_limit = max(1, config.retriever_document_limit)
        chunk_limit = max(1, config.retriever_chunk_limit)
        rel_limit = max(1, config.retriever_relationship_limit)
        truncate_at = max(200, config.retriever_chunk_truncate_chars)
        half_doc = max(1, doc_limit // 2)
        half_chunk = max(1, chunk_limit // 2)
        min_cosine = relevance_gate_cypher_min_cosine(config)

        vector_index_name = f"text_vectors_{hub_id}"
        fulltext_index_name = f"text_fulltext_index_{hub_id}"

        semantic_query = build_retrieval_query(
            hub_id,
            half_doc,
            half_chunk,
            rel_limit,
            truncate_at,
            person_names=person_names,
            place_names=place_names,
            score_floor=RETRIEVER_RELEVANCE_SCORE_FLOOR,
            min_cosine=min_cosine,
            include_kg_rels=config.retriever_kg_rels_enabled,
        )
        semantic_retriever = HybridCypherRetriever(
            driver=driver,
            vector_index_name=vector_index_name,
            fulltext_index_name=fulltext_index_name,
            embedder=embedder,
            retrieval_query=semantic_query,
        )

        t_filter, t_scoring, t_order, alpha = temporal_scoring_fragments(temporal_context, config)
        temporal_query = build_retrieval_query(
            hub_id,
            half_doc,
            half_chunk,
            rel_limit,
            truncate_at,
            temporal_filter=t_filter,
            temporal_scoring=t_scoring,
            order_by=t_order,
            person_names=person_names,
            place_names=place_names,
            score_floor=RETRIEVER_RELEVANCE_SCORE_FLOOR,
            min_cosine=min_cosine,
            include_kg_rels=config.retriever_kg_rels_enabled,
        )
        temporal_retriever = HybridCypherRetriever(
            driver=driver,
            vector_index_name=vector_index_name,
            fulltext_index_name=fulltext_index_name,
            embedder=embedder,
            retrieval_query=temporal_query,
        )

        return cls(
            semantic_retriever=semantic_retriever,
            temporal_retriever=temporal_retriever,
            temporal_top_k_multiplier=config.retriever_temporal_top_k_multiplier,
            temporal_alpha=alpha,
        )

    @classmethod
    def with_vector_prefilter(
        cls,
        driver: Driver,
        embedder: Embedder,
        hub_id: int,
        temporal_context: TemporalContext,
        config: Config,
        *,
        person_names: list[str] | None = None,
        place_names: list[str] | None = None,
    ) -> DualRetriever:
        """Semantic: HybridCypherRetriever, Temporal: VectorCypherRetriever with pre-filters."""
        doc_limit = max(1, config.retriever_document_limit)
        chunk_limit = max(1, config.retriever_chunk_limit)
        rel_limit = max(1, config.retriever_relationship_limit)
        truncate_at = max(200, config.retriever_chunk_truncate_chars)
        half_doc = max(1, doc_limit // 2)
        half_chunk = max(1, chunk_limit // 2)
        min_cosine = relevance_gate_cypher_min_cosine(config)

        vector_index_name = f"text_vectors_{hub_id}"
        fulltext_index_name = f"text_fulltext_index_{hub_id}"

        semantic_query = build_retrieval_query(
            hub_id,
            half_doc,
            half_chunk,
            rel_limit,
            truncate_at,
            person_names=person_names,
            place_names=place_names,
            score_floor=RETRIEVER_RELEVANCE_SCORE_FLOOR,
            min_cosine=min_cosine,
            include_kg_rels=config.retriever_kg_rels_enabled,
        )
        semantic_retriever = HybridCypherRetriever(
            driver=driver,
            vector_index_name=vector_index_name,
            fulltext_index_name=fulltext_index_name,
            embedder=embedder,
            retrieval_query=semantic_query,
        )

        t_filter, t_scoring, t_order, alpha = temporal_scoring_fragments(temporal_context, config)
        temporal_query = build_retrieval_query(
            hub_id,
            half_doc,
            half_chunk,
            rel_limit,
            truncate_at,
            temporal_filter=t_filter,
            temporal_scoring=t_scoring,
            order_by=t_order,
            person_names=person_names,
            place_names=place_names,
            score_floor=RETRIEVER_RELEVANCE_SCORE_FLOOR,
            min_cosine=min_cosine,
            include_kg_rels=config.retriever_kg_rels_enabled,
        )
        temporal_retriever = VectorCypherRetriever(
            driver=driver,
            index_name=vector_index_name,
            retrieval_query=temporal_query,
            embedder=embedder,
        )
        _patch_vector_embedding_property(temporal_retriever)

        filters = build_temporal_filters(temporal_context)

        return cls(
            semantic_retriever=semantic_retriever,
            temporal_retriever=temporal_retriever,
            temporal_top_k_multiplier=config.retriever_temporal_top_k_multiplier,
            temporal_filters=filters,
            temporal_alpha=alpha,
        )

    def _build_temporal_kwargs(self, query_text: str, kwargs: dict[str, Any]) -> dict[str, Any]:
        """Build kwargs for the temporal retriever.

        VectorCypherRetriever requires exactly one of query_vector or query_text.
        HybridCypherRetriever accepts both. When the caller provides query_vector
        (e.g. from fact-enriched embedding), prefer it to avoid re-embedding.
        """
        temporal_kwargs: dict[str, Any] = {}

        if "query_vector" in kwargs:
            temporal_kwargs["query_vector"] = kwargs["query_vector"]
        else:
            temporal_kwargs["query_text"] = query_text

        if self.temporal_filters:
            temporal_kwargs["filters"] = self.temporal_filters

        return temporal_kwargs

    def get_search_results(self, query_text: str, top_k: int = 5, **kwargs: Any) -> RawSearchResult:
        # Semantic and temporal retrievers issue independent Cypher queries against Neo4j;
        # running them on a 2-worker pool roughly halves wall-clock time for dual retrieval.
        # The Neo4j driver is thread-safe (sessions are created per call inside each retriever).
        temporal_fetch_k = top_k * self.temporal_top_k_multiplier
        temporal_kwargs = self._build_temporal_kwargs(query_text, kwargs)

        with ThreadPoolExecutor(max_workers=2) as executor:
            # Lambdas wrap the calls so mypy doesn't try to unify the generic
            # signature of execute_with_retry against Executor.submit's overloads.
            semantic_future = submit_in_context(
                executor,
                lambda: execute_with_retry(
                    self.semantic_retriever.get_search_results,
                    query_text=query_text,
                    top_k=top_k,
                    **kwargs,
                ),
            )
            temporal_future = submit_in_context(
                executor,
                lambda: execute_with_retry(
                    self.temporal_retriever.get_search_results,
                    top_k=temporal_fetch_k,
                    **temporal_kwargs,
                ),
            )

            # Semantic failures propagate (same as the prior sequential behavior).
            semantic_results = semantic_future.result()

            temporal_results: RawSearchResult | None = None
            try:
                temporal_results = temporal_future.result()
            except Exception:
                logger.opt(exception=sys.exc_info()).error(
                    "Temporal retriever failed, falling back to semantic-only results"
                )

        merged: list[Record] = []
        metadata: dict[str, Any] = {}
        semantic_dropped = 0

        if temporal_results is None:
            merged.extend(semantic_results.records)
            metadata.update({} if semantic_results.metadata is None else semantic_results.metadata)
        else:
            # temporal first — for recency queries the LLM anchors on what it sees first,
            # so temporally-scored results must precede semantic ones.
            temporal_doc_ids: set[str] = set()
            for rec in temporal_results.records:
                temporal_doc_ids |= _doc_ids(rec)

            merged.extend(temporal_results.records)
            metadata.update({} if temporal_results.metadata is None else temporal_results.metadata)

            # drop semantic records fully covered by temporal; keep records that
            # contain unique docs (e.g. undated chunks excluded from temporal).
            for rec in semantic_results.records:
                sem_ids = _doc_ids(rec)
                if sem_ids and sem_ids <= temporal_doc_ids:
                    semantic_dropped += 1
                else:
                    merged.append(rec)

            metadata.update({} if semantic_results.metadata is None else semantic_results.metadata)

        logger.info(
            f"DualRetriever: {len(semantic_results.records)} semantic + "
            f"{len(temporal_results.records) if temporal_results else 0} temporal = "
            f"{len(merged)} items (dropped {semantic_dropped} duplicate semantic records)"
        )
        return RawSearchResult(records=merged, metadata=metadata)


class RecencyFirstRetriever(BaseNeo4jRetriever):
    """Vector retriever pre-filtered to a recent ``published_at`` window.

    Wraps a single ``VectorCypherRetriever`` and always injects the recency
    window filter so the exact-KNN pre-filter only scans recent chunks, shrinking
    the search space. It also resolves the ``query_text``/``query_vector``
    exclusivity that GraphRAG's ``retriever.search(query_text=..., **retriever_config)``
    call would otherwise violate (``VectorCypherRetriever`` requires exactly one).
    """

    def __init__(self, vector_retriever: VectorCypherRetriever, filters: dict[str, Any]) -> None:
        self.vector_retriever = vector_retriever
        self.filters = filters

    @classmethod
    def build(
        cls,
        driver: Driver,
        embedder: Embedder,
        hub_id: int,
        window_days: int,
        config: Config,
        *,
        person_names: list[str] | None = None,
        place_names: list[str] | None = None,
    ) -> RecencyFirstRetriever:
        doc_limit = max(1, config.retriever_document_limit)
        chunk_limit = max(1, config.retriever_chunk_limit)
        rel_limit = max(1, config.retriever_relationship_limit)
        truncate_at = max(200, config.retriever_chunk_truncate_chars)

        retrieval_query = build_retrieval_query(
            hub_id,
            doc_limit,
            chunk_limit,
            rel_limit,
            truncate_at,
            person_names=person_names,
            place_names=place_names,
            score_floor=RETRIEVER_RELEVANCE_SCORE_FLOOR,
            min_cosine=relevance_gate_cypher_min_cosine(config),
            include_kg_rels=config.retriever_kg_rels_enabled,
        )
        vector_retriever = VectorCypherRetriever(
            driver=driver,
            index_name=f"text_vectors_{hub_id}",
            retrieval_query=retrieval_query,
            embedder=embedder,
        )
        _patch_vector_embedding_property(vector_retriever)

        return cls(vector_retriever, build_recency_window_filter(window_days))

    def get_search_results(self, query_text: str, top_k: int = 5, **kwargs: Any) -> RawSearchResult:
        search_kwargs: dict[str, Any] = {"filters": self.filters}
        # VectorCypherRetriever requires exactly one of query_vector/query_text;
        # prefer a caller-supplied vector (e.g. fact-enriched embedding) over the text.
        query_vector = kwargs.get("query_vector")
        if query_vector is not None:
            search_kwargs["query_vector"] = query_vector
        else:
            search_kwargs["query_text"] = query_text

        return self.vector_retriever.get_search_results(top_k=top_k, **search_kwargs)
