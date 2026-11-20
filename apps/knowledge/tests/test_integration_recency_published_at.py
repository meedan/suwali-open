"""Integration test: recency filtering uses published_at, not ingestion order."""

import pytest
import requests
from glom import glom
from loguru import logger

from tests.integration_fixtures import (
    BASE_URL,
    FERRY_RIDERSHIP_NEW_DOC_ID,
    FERRY_RIDERSHIP_OLD_DOC_ID,
    HUB_ID,
)

pytestmark = pytest.mark.integration

_RECENT_RIDERSHIP = "67,500"
_OLD_RIDERSHIP = "42,000"


def _document_ids_from_metadata(data: dict[str, object]) -> set[str]:
    raw_ids = glom(data, "metadata.document_ids_used", default=[])
    return {str(doc_id) for doc_id in raw_ids if doc_id} if isinstance(raw_ids, list) else set()


def _cited_document_ids_from_metadata(data: dict[str, object]) -> set[str]:
    raw_ids = glom(data, "metadata.document_ids_cited", default=[])
    return {str(doc_id) for doc_id in raw_ids if doc_id} if isinstance(raw_ids, list) else set()


@pytest.mark.order(5)
def test_recency_prefers_published_at_over_ingest_order(prepare_ferry_ridership_data: None) -> None:
    """Old-dated content ingested last (RSS backlog) must not win a recency query.

    Both documents cover Veridian coastal ferry ridership. The recent-dated doc is
    ingested first; the 2022-dated doc is ingested second. A current-ridership
    question must still source the recent publication.
    """
    query = "What is the current daily ridership on the Veridian coastal ferry?"
    payload = {
        "hub_id": HUB_ID,
        "message_id": 510,
        "message": query,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200

    data = response.json()
    answer = data.get("answer", "")
    assert answer, "Expected a non-empty answer"
    answer_lower = answer.lower()
    logger.info(f"[ferry-recency] answer: {answer}")

    temporal_type = glom(data, "metadata.temporal_type", default=None)
    document_ids = _document_ids_from_metadata(data)
    cited_document_ids = _cited_document_ids_from_metadata(data)
    logger.info(
        f"[ferry-recency] temporal_type={temporal_type}, "
        f"used={sorted(document_ids)}, cited={sorted(cited_document_ids)}"
    )

    assert temporal_type == "recency", f"Expected temporal_type=recency, got: {temporal_type}"
    assert len(document_ids) >= len(cited_document_ids) > 0

    assert FERRY_RIDERSHIP_NEW_DOC_ID in document_ids, (
        f"Expected recency query to use {FERRY_RIDERSHIP_NEW_DOC_ID}, got: {sorted(document_ids)}"
    )
    assert _RECENT_RIDERSHIP in answer, (
        f"Expected current ridership figure {_RECENT_RIDERSHIP} in answer, got: {answer}"
    )

    if cited_document_ids:
        assert FERRY_RIDERSHIP_NEW_DOC_ID in cited_document_ids, (
            f"Expected {FERRY_RIDERSHIP_NEW_DOC_ID} among cited docs, got: {sorted(cited_document_ids)}"
        )

    if _OLD_RIDERSHIP in answer:
        assert "2022" in answer_lower, (
            f"If {_OLD_RIDERSHIP} is mentioned, it should be historical (2022), got: {answer}"
        )

    if FERRY_RIDERSHIP_OLD_DOC_ID in document_ids:
        logger.info(
            f"[ferry-recency] old doc also retrieved via the semantic half of DualRetriever: {FERRY_RIDERSHIP_OLD_DOC_ID}"
        )

    logger.info("Ferry ridership published_at recency test passed")
