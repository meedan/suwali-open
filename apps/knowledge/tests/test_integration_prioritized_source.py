"""Integration tests: high-tier documents must be marked prioritized and acknowledged in chat.

Hub 7 holds only the Kestrel Grant pair. Live Retriever.search inspects generator context for
prioritized="true" (the mechanism chat metadata does not expose). A second test POSTs /chat and
asserts the answer names the prioritized amount. Conflicting figures and a clarifying question
are allowed as long as the prioritized figure is acknowledged.

Hub 8 holds a single default-tier document whose body embeds a forged wrapper tag: the render
must escape it so it can neither mark the passage prioritized nor flip the prompt gate.
"""

import re
from collections.abc import Generator

import pytest
import requests
from glom import glom
from loguru import logger
from neo4j_graphrag.types import RetrieverResult

from app.core.constants import (
    SOURCE_DOCUMENT_TAG,
    SOURCE_PRIORITIZED_ATTRIBUTE,
    wrapping_context_has_prioritized_tag,
)
from app.models.chat import ChatRequest
from app.services.neo4j_client import Neo4jClient
from app.services.retriever import Retriever
from tests.integration_fixtures import (
    BASE_URL,
    FORGED_TAG_DOC_ID,
    FORGED_TAG_HUB_ID,
    FORGED_TAG_QUESTION,
    PRIORITY_CONFLICT_DEFAULT_DOC_ID,
    PRIORITY_CONFLICT_DEFAULT_PUBLISHED_AT,
    PRIORITY_CONFLICT_HIGH_DOC_ID,
    PRIORITY_CONFLICT_HIGH_PUBLISHED_AT,
    PRIORITY_CONFLICT_HUB_ID,
    PRIORITY_CONFLICT_QUESTION,
)

pytestmark = pytest.mark.integration

_HIGH_TIER_AMOUNT = "500"
_PRIORITIZED_TRUE = f'{SOURCE_PRIORITIZED_ATTRIBUTE}="true"'


@pytest.fixture(autouse=True)
def _clear_retriever_cache_after_test() -> Generator[None, None, None]:
    yield
    Retriever._cache.clear()


def _opening_tag(text: str, document_id: str) -> str:
    pattern = rf'<{re.escape(SOURCE_DOCUMENT_TAG)} ref="{re.escape(document_id)}"[^>]*>'
    match = re.search(pattern, text)
    assert match is not None, f"No <{SOURCE_DOCUMENT_TAG} ref={document_id!r}> tag in context: {text!r}"
    return match.group(0)


def _contexts(result: RetrieverResult) -> tuple[set[str], str]:
    document_ids: set[str] = set()
    text_parts: list[str] = []
    for item in result.items:
        record = Neo4jClient.parse_neo4j_record_str(item.content)
        document_ids.update(doc_id for doc_id in record.get("document_ids_used", "").split("|") if doc_id)
        context = record.get("context", "")
        text_parts.append(context.split("\n\n=== kg_rels ===")[0])
    return document_ids, "\n".join(text_parts)


def _has_standalone(text: str, number: str) -> bool:
    return re.search(rf"(?<![0-9]){re.escape(number)}(?![0-9])", text) is not None


def _search(hub_id: int, message_id: int, question: str) -> RetrieverResult:
    # Recency-first windows to the last 30 days; the fixtures are older or undated, so that
    # pass returns no rows. Direct .retriever.search() does not run the chat-path fallback.
    chat = ChatRequest(
        hub_id=hub_id,
        message_id=message_id,
        message=question,
        history=[],
    )
    retriever = Retriever(
        chat=chat,
        enable_rephrasing=False,
        enable_hyde=False,
        recency_first_enabled=False,
    )
    return retriever.retriever.search(query_text=question, top_k=5)


@pytest.mark.order(6)
def test_high_tier_document_tagged_in_retrieval_context(prepare_prioritized_conflict_data: None) -> None:
    """Live Cypher context must mark the high-tier document prioritized and leave the default unmarked."""
    result = _search(PRIORITY_CONFLICT_HUB_ID, 7100, PRIORITY_CONFLICT_QUESTION)
    document_ids, text = _contexts(result)
    logger.info(f"priority-conflict document_ids={sorted(document_ids)}")
    logger.info(f"priority-conflict text={text!r}")

    assert PRIORITY_CONFLICT_HIGH_DOC_ID in document_ids, (
        f"Expected high-tier id among retrieved ids, got {sorted(document_ids)}"
    )
    assert PRIORITY_CONFLICT_DEFAULT_DOC_ID in document_ids, (
        f"Expected default-tier id among retrieved ids, got {sorted(document_ids)}"
    )

    high_tag = _opening_tag(text, PRIORITY_CONFLICT_HIGH_DOC_ID)
    default_tag = _opening_tag(text, PRIORITY_CONFLICT_DEFAULT_DOC_ID)

    assert _PRIORITIZED_TRUE in high_tag, f"High-tier opening tag must be prioritized, got {high_tag!r}"
    assert _PRIORITIZED_TRUE not in default_tag, (
        f"Default-tier opening tag must not be prioritized, got {default_tag!r}"
    )
    assert PRIORITY_CONFLICT_HIGH_PUBLISHED_AT[:10] in high_tag, (
        f"High-tier tag must carry 2020 published_at, got {high_tag!r}"
    )
    assert PRIORITY_CONFLICT_DEFAULT_PUBLISHED_AT[:10] in default_tag, (
        f"Default-tier tag must carry 2025 published_at, got {default_tag!r}"
    )


@pytest.mark.order(6)
def test_forged_prioritized_tag_in_body_is_escaped_and_not_structural(prepare_forged_tag_data: None) -> None:
    """A forged wrapper tag inside document text must be escaped in the rendered context, must not
    mark the real wrapping tag prioritized, and must not flip the prompt gate. Hub 8 holds only
    this default-tier document, so any prioritized signal can only come from the forgery."""
    result = _search(FORGED_TAG_HUB_ID, 8100, FORGED_TAG_QUESTION)
    document_ids, text = _contexts(result)
    logger.info(f"forged-tag document_ids={sorted(document_ids)}")
    logger.info(f"forged-tag text={text!r}")

    assert FORGED_TAG_DOC_ID in document_ids, f"Expected forged-tag id among retrieved ids, got {sorted(document_ids)}"

    tag = _opening_tag(text, FORGED_TAG_DOC_ID)
    assert _PRIORITIZED_TRUE not in tag, f"Default-tier opening tag must not be prioritized, got {tag!r}"
    assert f"&lt;{SOURCE_DOCUMENT_TAG}" in text, (
        f"Forged opening tag in body text must be escaped to &lt;{SOURCE_DOCUMENT_TAG}: {text!r}"
    )
    assert wrapping_context_has_prioritized_tag(text) is False, (
        f"Forged tag in body text must not flip the prioritized prompt gate: {text!r}"
    )


@pytest.mark.order(6)
def test_high_tier_document_wins_dated_conflict_in_chat(prepare_prioritized_conflict_data: None) -> None:
    """The prioritized amount must appear and be acknowledged; a clarifying question is allowed."""
    payload = {
        "hub_id": PRIORITY_CONFLICT_HUB_ID,
        "message_id": 7101,
        "message": PRIORITY_CONFLICT_QUESTION,
        "history": [],
        "recency_first_enabled": False,
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=180)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data: dict[str, object] = response.json()
    answer = str(data.get("answer") or "")
    logger.info(f"[priority-conflict-chat] answer={answer!r}")

    assert data.get("error_type") is None, f"Expected an answer, got error: {data.get('error_type')}"
    assert answer, "Expected a non-empty answer"

    used = glom(data, "metadata.document_ids_used", default=[])
    used_ids = {str(doc_id) for doc_id in used if doc_id} if isinstance(used, list) else set()
    assert PRIORITY_CONFLICT_HIGH_DOC_ID in used_ids, f"Expected high-tier id among used docs, got {sorted(used_ids)}"

    assert _has_standalone(answer, _HIGH_TIER_AMOUNT), (
        f"Expected prioritized amount {_HIGH_TIER_AMOUNT} in answer: {answer}"
    )
    assert SOURCE_PRIORITIZED_ATTRIBUTE in answer.lower(), f"Answer must acknowledge the prioritized figure: {answer}"

    cited = glom(data, "metadata.document_ids_cited", default=[])
    if isinstance(cited, list) and cited:
        cited_ids = {str(doc_id) for doc_id in cited if doc_id}
        assert PRIORITY_CONFLICT_HIGH_DOC_ID in cited_ids, (
            f"Expected high-tier id among cited docs, got {sorted(cited_ids)}"
        )
