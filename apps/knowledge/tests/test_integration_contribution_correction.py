"""Integration tests: an editor contribution must be able to correct a longer, recently dated source.

Hub 9 holds a many-chunk annual report, published a few days ago, that restates a stale clinic
address in every section, plus a one-paragraph contribution with the current address. The
contribution is ingested exactly as CMS ingests contributions: document_type "contribution",
priority tier 2, no published_at. This is the production shape; the Kestrel Grant pair in
test_integration_prioritized_source.py (two one-line documents, recency-first disabled) is not.

Every test runs twice, with RETRIEVER_RECENCY_FIRST_ENABLED on and off, because the two modes lose
the contribution at different stages:

- retrieval: the first pass must return the contribution alongside the source. With recency-first
  off that means surviving top_k against the source's many chunks; with it on, also getting past
  the last-30-days window the source is inside and the undated contribution is not;
- chat: the answer must give the contributed address and cite the contribution;
- chat: the answer must not repeat the stale address — a correction replaces the source's claim
  rather than being presented as one version among several.

Before the fixes, recency-first on lost the contribution at retrieval (it is undated, so the 30-day
pre-filter excluded it), and with both passages in context the answer kept the stale address as
"another location". Retrieval with recency-first off always passed: one keyword-dense contribution
chunk outranks the source's 18 chunks at top_k=5.
"""

from collections.abc import Generator

import pytest
import requests
from glom import glom
from loguru import logger
from neo4j_graphrag.types import RetrieverResult

from app.core.constants import prioritized_document_refs
from app.models.chat import ChatRequest
from app.services.neo4j_client import Neo4jClient
from app.services.retriever import Retriever
from tests.integration_fixtures import (
    BASE_URL,
    CONTRIBUTION_CORRECTION_CONTRIBUTION_DOC_ID,
    CONTRIBUTION_CORRECTION_CURRENT_ADDRESS,
    CONTRIBUTION_CORRECTION_HUB_ID,
    CONTRIBUTION_CORRECTION_QUESTION,
    CONTRIBUTION_CORRECTION_SOURCE_DOC_ID,
    CONTRIBUTION_CORRECTION_STALE_ADDRESS,
)

pytestmark = pytest.mark.integration

# every test runs with RETRIEVER_RECENCY_FIRST_ENABLED both on and off, passed as the per-request
# override (the setting is read once at service start, so the env var cannot vary per test).
_RECENCY_FIRST_MODES = [
    pytest.param(True, id="recency_first_on"),
    pytest.param(False, id="recency_first_off"),
]


@pytest.fixture(autouse=True)
def _clear_retriever_cache_after_test() -> Generator[None, None, None]:
    yield
    Retriever._cache.clear()


def _document_ids_and_context(result: RetrieverResult) -> tuple[set[str], str]:
    document_ids: set[str] = set()
    contexts: list[str] = []
    for item in result.items:
        record = Neo4jClient.parse_neo4j_record_str(item.content)
        document_ids.update(doc_id for doc_id in record.get("document_ids_used", "").split("|") if doc_id)
        contexts.append(record.get("context", ""))
    return document_ids, "\n".join(contexts)


def _search(message_id: int, *, recency_first_enabled: bool) -> tuple[set[str], str]:
    # direct .retriever.search() runs a single retrieval pass with no chat-path fallback,
    # so the recency-first variant sees exactly what the default first pass sees.
    chat = ChatRequest(
        hub_id=CONTRIBUTION_CORRECTION_HUB_ID,
        message_id=message_id,
        message=CONTRIBUTION_CORRECTION_QUESTION,
        history=[],
    )
    retriever = Retriever(
        chat=chat,
        enable_rephrasing=False,
        enable_hyde=False,
        recency_first_enabled=recency_first_enabled,
    )
    document_ids, context = _document_ids_and_context(
        retriever.retriever.search(query_text=CONTRIBUTION_CORRECTION_QUESTION, top_k=5)
    )
    logger.info(f"contribution-correction recency_first={recency_first_enabled} document_ids={sorted(document_ids)}")
    return document_ids, context


def _chat(message_id: int, *, recency_first_enabled: bool) -> dict[str, object]:
    payload = {
        "hub_id": CONTRIBUTION_CORRECTION_HUB_ID,
        "message_id": message_id,
        "message": CONTRIBUTION_CORRECTION_QUESTION,
        "history": [],
        "recency_first_enabled": recency_first_enabled,
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=180)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data: dict[str, object] = response.json()
    assert data.get("error_type") is None, f"Expected an answer, got error: {data.get('error_type')}"
    logger.info(
        f"[contribution-correction-chat] recency_first={recency_first_enabled} "
        f"answer={data.get('answer')!r} metadata={data.get('metadata')!r}"
    )
    return data


def _ids(data: dict[str, object], path: str) -> set[str]:
    ids = glom(data, path, default=[])
    return {str(doc_id) for doc_id in ids if doc_id} if isinstance(ids, list) else set()


@pytest.mark.order(6)
@pytest.mark.parametrize("recency_first_enabled", _RECENCY_FIRST_MODES)
def test_contribution_reaches_retrieval(
    prepare_contribution_correction_data: None, recency_first_enabled: bool
) -> None:
    """The first retrieval pass must return the contribution alongside the source, despite the
    source's many chunks and, with recency-first on, despite the contribution having no date."""
    document_ids, context = _search(9100 + int(recency_first_enabled), recency_first_enabled=recency_first_enabled)

    assert CONTRIBUTION_CORRECTION_SOURCE_DOC_ID in document_ids, (
        f"Fixture sanity: the recent source must be retrieved, got {sorted(document_ids)}"
    )
    assert CONTRIBUTION_CORRECTION_CONTRIBUTION_DOC_ID in document_ids, (
        f"Contribution must reach the first retrieval pass, got {sorted(document_ids)}"
    )
    # the generator can only prefer the contribution if its wrapping tag marks it prioritized
    prioritized_refs = prioritized_document_refs(context)
    # strip the refs because cms-api can send ids ending in a newline
    assert prioritized_refs == {CONTRIBUTION_CORRECTION_CONTRIBUTION_DOC_ID.strip()}, (
        f"Only the contribution's wrapping tag must be prioritized, got {sorted(prioritized_refs)}"
    )


@pytest.mark.order(6)
@pytest.mark.parametrize("recency_first_enabled", _RECENCY_FIRST_MODES)
def test_chat_answers_with_contributed_address(
    prepare_contribution_correction_data: None, recency_first_enabled: bool
) -> None:
    """The answer must give the contributed address and cite the contribution."""
    data = _chat(9102 + int(recency_first_enabled), recency_first_enabled=recency_first_enabled)
    answer = str(data.get("answer") or "")

    used_ids = _ids(data, "metadata.document_ids_used")
    assert CONTRIBUTION_CORRECTION_CONTRIBUTION_DOC_ID in used_ids, (
        f"Expected contribution among used docs, got {sorted(used_ids)}"
    )
    cited_ids = _ids(data, "metadata.document_ids_cited")
    assert CONTRIBUTION_CORRECTION_CONTRIBUTION_DOC_ID in cited_ids, (
        f"Expected contribution among cited docs, got {sorted(cited_ids)}"
    )
    assert CONTRIBUTION_CORRECTION_CURRENT_ADDRESS in answer, (
        f"Expected contributed address {CONTRIBUTION_CORRECTION_CURRENT_ADDRESS!r} in answer: {answer}"
    )


@pytest.mark.order(6)
@pytest.mark.parametrize("recency_first_enabled", _RECENCY_FIRST_MODES)
def test_chat_does_not_repeat_stale_address(
    prepare_contribution_correction_data: None, recency_first_enabled: bool
) -> None:
    """The corrected claim must replace the source's, not appear as one version among several."""
    data = _chat(9104 + int(recency_first_enabled), recency_first_enabled=recency_first_enabled)
    answer = str(data.get("answer") or "")

    assert CONTRIBUTION_CORRECTION_CURRENT_ADDRESS in answer, (
        f"Expected contributed address {CONTRIBUTION_CORRECTION_CURRENT_ADDRESS!r} in answer: {answer}"
    )
    assert CONTRIBUTION_CORRECTION_STALE_ADDRESS not in answer, (
        f"Stale address {CONTRIBUTION_CORRECTION_STALE_ADDRESS!r} must not appear once corrected: {answer}"
    )
