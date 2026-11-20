"""Integration tests: leftover exclusive entities must not enter retrieval context.

After DELETE /document/ removes a source, production retrieval for what remains must not put
that source's exclusive entities into generator context — neither `=== kg_rels ===` (flag on)
nor any retriever path with the flag off. Ingest, delete, and retrieve go through the live API
and Retriever — the same paths production uses. Observation skips /chat so the answer LLM is
not the judge.
"""

from collections.abc import Generator
from typing import Any

import pytest
from loguru import logger
from neo4j import Driver
from neo4j_graphrag.types import RetrieverResult

from app.models.chat import ChatRequest, Metadata
from app.models.temporal import TemporalContext, TemporalType
from app.services.dual_retriever import DualRetriever, RecencyFirstRetriever
from app.services.neo4j_client import Neo4jClient
from app.services.retriever import Retriever
from app.services.router.models import SynthesisContext, SynthesisType
from tests.integration_fixtures import (
    KG_RELS_DELETION_DROP_DOC_ID,
    KG_RELS_DELETION_EXCLUSIVE_ENTITY,
    KG_RELS_DELETION_HUB_ID,
    KG_RELS_DELETION_KEEP_DOC_ID,
    KG_RELS_DELETION_SHARED_ENTITY,
    _delete_document,
)

pytestmark = pytest.mark.integration

_SEARCH_QUERY = "What does AcmeCorpX do?"


def _set_kg_rels(monkeypatch: pytest.MonkeyPatch, *, enabled: bool) -> None:
    """Set the RETRIEVER_KG_RELS_ENABLED config flag.

    The retriever cache key does not include it and these tests need it to be set to True.
    """
    monkeypatch.setenv("RETRIEVER_KG_RELS_ENABLED", "1" if enabled else "0")
    Retriever._cache.clear()


@pytest.fixture(autouse=True)
def _clear_retriever_cache_after_test() -> Generator[None, None, None]:
    """Drop cached retrievers after each test so a kg_rels-on walk cannot leak."""
    yield
    Retriever._cache.clear()


def _make_retriever(
    *,
    recency_first_enabled: bool = False,
    temporal_context: TemporalContext | None = None,
    message_id: int = 6100,
) -> Retriever:
    chat = ChatRequest(
        hub_id=KG_RELS_DELETION_HUB_ID,
        message_id=message_id,
        message=_SEARCH_QUERY,
        history=[],
    )
    return Retriever(
        chat=chat,
        enable_rephrasing=False,
        enable_hyde=False,
        recency_first_enabled=recency_first_enabled,
        temporal_context=temporal_context,
    )


def _search() -> RetrieverResult:
    return _make_retriever(recency_first_enabled=False).retriever.search(query_text=_SEARCH_QUERY, top_k=5)


def _unwrap_base(retriever: Retriever) -> Any:
    """Peel RelevanceFilteredRetriever so DualRetriever / RecencyFirst type checks work."""
    candidate: Any = retriever.retriever
    while hasattr(candidate, "base_retriever") and hasattr(candidate, "relevance_gate"):
        candidate = candidate.base_retriever
    return candidate


def _contexts(result: RetrieverResult) -> tuple[set[str], str, str]:
    """Return (document_ids_used, joined text sections, joined kg_rels sections)."""
    document_ids: set[str] = set()
    text_parts: list[str] = []
    kg_rels_parts: list[str] = []
    for item in result.items:
        record = Neo4jClient.parse_neo4j_record_str(item.content)
        document_ids.update(doc_id for doc_id in record.get("document_ids_used", "").split("|") if doc_id)
        context = record.get("context", "")
        if "\n\n=== kg_rels ===" in context:
            text, kg_rels = context.split("\n\n=== kg_rels ===", 1)
        else:
            text, kg_rels = context, ""
        text_parts.append(text)
        kg_rels_parts.append(kg_rels)
    return document_ids, "\n".join(text_parts), "\n".join(kg_rels_parts)


def _orphan_edge_exists(driver: Driver) -> bool:
    """True when a leftover exclusive-entity edge still hangs off a remaining hub-6 chunk."""
    query = f"""
    MATCH (keep)-[:FROM_CHUNK]->(:Chunk_{KG_RELS_DELETION_HUB_ID})
    MATCH (keep)-[r]-(orphan)
    WHERE type(r) <> 'FROM_CHUNK'
      AND toLower(coalesce(orphan.name, '')) = toLower($orphan)
    RETURN type(r) AS rel_type, keep.name AS keep_name, orphan.name AS orphan_name
    LIMIT 1
    """
    with driver.session() as session:
        record = session.run(query, orphan=KG_RELS_DELETION_EXCLUSIVE_ENTITY).single()
    if record is None:
        logger.info("leftover orphan edge: none")
        return False
    logger.info(f"leftover orphan edge: {record['keep_name']!r} -{record['rel_type']}-> {record['orphan_name']!r}")
    return True


def _assert_orphan_edge_remains(driver: Driver) -> None:
    assert _orphan_edge_exists(driver), (
        f"Exclusive entity '{KG_RELS_DELETION_EXCLUSIVE_ENTITY}' must still have a leftover edge "
        "to an entity attached to remaining hub chunks after document delete — otherwise a later "
        "absence-from-context assertion is vacuous"
    )


def _assert_exclusive_absent(haystack: str, *, expect_no_kg_rels_section: bool, mode: str) -> None:
    assert KG_RELS_DELETION_EXCLUSIVE_ENTITY not in haystack, (
        f"{mode}: exclusive entity '{KG_RELS_DELETION_EXCLUSIVE_ENTITY}' must not appear in retrieval "
        f"context after its only source was deleted. context={haystack!r}"
    )
    if expect_no_kg_rels_section:
        assert "=== kg_rels ===" not in haystack, (
            f"{mode}: retrieval must not include a kg_rels section when the flag is off. context={haystack!r}"
        )


def _assert_keep_doc_in_ids(document_ids: set[str], haystack: str, *, mode: str) -> None:
    assert KG_RELS_DELETION_KEEP_DOC_ID in document_ids, (
        f"{mode}: keep doc '{KG_RELS_DELETION_KEEP_DOC_ID}' should still be retrieved after deleting "
        f"the drop doc, got ids {sorted(document_ids)}"
    )
    assert KG_RELS_DELETION_SHARED_ENTITY in haystack, (
        f"{mode}: shared entity '{KG_RELS_DELETION_SHARED_ENTITY}' should still appear from the keep doc"
    )


def _assert_pre_delete_kg_rels(result: RetrieverResult) -> None:
    document_ids, _text, kg_rels = _contexts(result)
    logger.info(f"pre-delete document_ids={sorted(document_ids)}")
    logger.info(f"pre-delete kg_rels={kg_rels!r}")
    assert KG_RELS_DELETION_KEEP_DOC_ID in document_ids, (
        f"Expected keep doc '{KG_RELS_DELETION_KEEP_DOC_ID}' among retrieved ids {sorted(document_ids)}"
    )
    assert KG_RELS_DELETION_EXCLUSIVE_ENTITY in kg_rels, (
        "ingest did not land the exclusive entity in kg_rels — extraction did not emit a Zemblania edge "
        f"visible from production retrieval. kg_rels={kg_rels!r}"
    )


def test_kg_rels_omit_exclusive_entity_after_document_delete(
    prepare_kg_rels_deletion_data: None, neo4j_driver: Driver, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Zemblania lives only in the drop doc; after that doc is deleted it must not appear in retrieval context."""
    _set_kg_rels(monkeypatch, enabled=True)
    _assert_pre_delete_kg_rels(_search())

    _delete_document(KG_RELS_DELETION_DROP_DOC_ID, KG_RELS_DELETION_HUB_ID)
    _assert_orphan_edge_remains(neo4j_driver)

    after = _search()
    document_ids, text, kg_rels = _contexts(after)
    context = f"{text}\n{kg_rels}"
    logger.info(f"post-delete document_ids={sorted(document_ids)}")
    logger.info(f"post-delete kg_rels={kg_rels!r}")

    _assert_keep_doc_in_ids(document_ids, context, mode="kg_rels-on hybrid")
    _assert_exclusive_absent(context, expect_no_kg_rels_section=False, mode="kg_rels-on hybrid")


def test_orphaned_entity_absent_from_all_retriever_paths_after_delete(
    prepare_kg_rels_deletion_data: None,
    neo4j_driver: Driver,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Leftover exclusive-entity edges stay in Neo4j but must not enter any retriever's context when kg_rels is off."""
    _set_kg_rels(monkeypatch, enabled=True)
    _assert_pre_delete_kg_rels(_search())

    _delete_document(KG_RELS_DELETION_DROP_DOC_ID, KG_RELS_DELETION_HUB_ID)
    _assert_orphan_edge_remains(neo4j_driver)

    _set_kg_rels(monkeypatch, enabled=False)

    hybrid = _make_retriever(recency_first_enabled=False)
    document_ids, text, kg_rels = _contexts(hybrid.retriever.search(query_text=_SEARCH_QUERY, top_k=5))
    haystack = f"{text}\n{kg_rels}"
    logger.info(f"flag-off hybrid document_ids={sorted(document_ids)} kg_rels={kg_rels!r}")
    _assert_keep_doc_in_ids(document_ids, haystack, mode="flag-off hybrid")
    _assert_exclusive_absent(haystack, expect_no_kg_rels_section=True, mode="flag-off hybrid")

    recency = _make_retriever(recency_first_enabled=True)
    recency_base = _unwrap_base(recency)
    assert isinstance(recency_base, RecencyFirstRetriever), f"Expected RecencyFirstRetriever, got {type(recency_base)}"
    document_ids, text, kg_rels = _contexts(recency.retriever.search(query_text=_SEARCH_QUERY, top_k=5))
    haystack = f"{text}\n{kg_rels}"
    logger.info(f"flag-off recency-first document_ids={sorted(document_ids)} kg_rels={kg_rels!r}")
    _assert_keep_doc_in_ids(document_ids, haystack, mode="flag-off recency-first")
    _assert_exclusive_absent(haystack, expect_no_kg_rels_section=True, mode="flag-off recency-first")

    dual_retriever = _make_retriever(
        recency_first_enabled=False,
        temporal_context=TemporalContext(type=TemporalType.RECENCY, confidence=0.9),
    )
    dual_base = _unwrap_base(dual_retriever)
    assert isinstance(dual_base, DualRetriever), f"Expected DualRetriever, got {type(dual_base)}"
    document_ids, text, kg_rels = _contexts(dual_retriever.retriever.search(query_text=_SEARCH_QUERY, top_k=5))
    haystack = f"{text}\n{kg_rels}"
    logger.info(f"flag-off dual document_ids={sorted(document_ids)} kg_rels={kg_rels!r}")
    _assert_keep_doc_in_ids(document_ids, haystack, mode="flag-off DualRetriever")
    _assert_exclusive_absent(haystack, expect_no_kg_rels_section=True, mode="flag-off DualRetriever")

    synthesis = _make_retriever(recency_first_enabled=False)
    synthesis_meta = Metadata()
    synthesis_chunks = synthesis.retrieve_for_synthesis(
        _SEARCH_QUERY,
        SynthesisContext(type=SynthesisType.TEMPORAL, time_window_days=7),
        synthesis_meta,
    )
    synthesis_haystack = "\n".join(synthesis_chunks)
    synthesis_ids = set(synthesis_meta.document_ids_used or [])
    logger.info(f"synthesis document_ids={sorted(synthesis_ids)}")
    _assert_keep_doc_in_ids(synthesis_ids, synthesis_haystack, mode="synthesis")
    _assert_exclusive_absent(synthesis_haystack, expect_no_kg_rels_section=True, mode="synthesis")

    topical = _make_retriever(recency_first_enabled=False)
    topical_meta = Metadata()
    topical_chunks = topical.retrieve_for_topical_summary(KG_RELS_DELETION_SHARED_ENTITY, topical_meta)
    topical_haystack = "\n".join(topical_chunks)
    topical_ids = set(topical_meta.document_ids_used or [])
    logger.info(f"topical document_ids={sorted(topical_ids)}")
    _assert_keep_doc_in_ids(topical_ids, topical_haystack, mode="topical summary")
    _assert_exclusive_absent(topical_haystack, expect_no_kg_rels_section=True, mode="topical summary")
