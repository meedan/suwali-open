"""Integration tests: conflicts that neither dates, scope, nor priority tier can resolve.

The harbor shuttle fixtures are undated default-tier documents, so recency and wrapping-tag
status cannot resolve their contradictions. Per CONFLICTING OR AMBIGUOUS SOURCES the generator
must present every version, never silently pick one, and must not invent wrapping-tag authority.
Mentioning that the wrapping attribute is absent is fine; assigning that status to a figure is not.
The travelogue control checks the converse: an uncontested fact still gets a plain, definite answer.
"""

import re

import pytest
import requests
from glom import glom
from loguru import logger

from app.core.constants import SOURCE_PRIORITIZED_ATTRIBUTE
from tests.integration_fixtures import (
    BASE_URL,
    HARBOR_SHUTTLE_GUIDE_DOC_ID,
    HARBOR_SHUTTLE_LEAFLET_DOC_ID,
    HUB_ID,
)

pytestmark = pytest.mark.integration

_GUIDE_FARE = "12"
_LEAFLET_FARE = "20"
_GUIDE_CAPACITY = "90"
_LEAFLET_CAPACITY = "60"
_CROSSING_MINUTES = "25"
_ATTR = re.escape(SOURCE_PRIORITIZED_ATTRIBUTE)
# wrapping-tag *status* assigned to a source or figure — not a bare mention of the attribute name
_ASSIGNS_WRAPPING_TAG_STATUS = re.compile(
    rf"\b(?:is|are|was|were)\s+{_ATTR}\b"
    rf"|\bthe\s+{_ATTR}\s+(?:figure|source|amount|fare|one|version|document|leaflet|guide|passage)\b"
    rf"|\b{_ATTR}\s+(?:figure|source|amount|fare)\s+is\b",
    re.IGNORECASE,
)


def _ask(message: str, message_id: int) -> dict[str, object]:
    payload = {
        "hub_id": HUB_ID,
        "message_id": message_id,
        "message": message,
        "history": [],
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=180)
    assert response.status_code == 200
    data: dict[str, object] = response.json()
    logger.info(f"[ambiguous-sources] q={message!r} answer={data.get('answer')!r}")
    return data


def _document_ids_used(data: dict[str, object]) -> set[str]:
    raw_ids = glom(data, "metadata.document_ids_used", default=[])
    return {str(doc_id) for doc_id in raw_ids if doc_id} if isinstance(raw_ids, list) else set()


def _cited_document_ids(data: dict[str, object]) -> set[str]:
    raw_ids = glom(data, "metadata.document_ids_cited", default=[])
    return {str(doc_id) for doc_id in raw_ids if doc_id} if isinstance(raw_ids, list) else set()


def _assert_states_both(data: dict[str, object], value_a: str, value_b: str) -> None:
    """The requirement is never to silently pick one side.
    Compliant forms: asking the user to disambiguate, or presenting both versions attributed to their sources."""
    assert data.get("error_type") is None, f"Expected an answer, got error: {data.get('error_type')}"
    answer = str(data.get("answer", ""))
    assert answer, "Expected a non-empty answer"

    assert value_a in answer, f"Expected conflicting value {value_a} in answer, got: {answer}"
    assert value_b in answer, f"Expected conflicting value {value_b} in answer, got: {answer}"

    document_ids = _document_ids_used(data)
    assert HARBOR_SHUTTLE_GUIDE_DOC_ID in document_ids, (
        f"Expected {HARBOR_SHUTTLE_GUIDE_DOC_ID} among used docs, got: {sorted(document_ids)}"
    )
    assert HARBOR_SHUTTLE_LEAFLET_DOC_ID in document_ids, (
        f"Expected {HARBOR_SHUTTLE_LEAFLET_DOC_ID} among used docs, got: {sorted(document_ids)}"
    )

    asks_back = "?" in answer
    cited = _cited_document_ids(data)
    cites_both_versions = {HARBOR_SHUTTLE_GUIDE_DOC_ID, HARBOR_SHUTTLE_LEAFLET_DOC_ID} <= cited
    assert asks_back or cites_both_versions, (
        f"Answer neither asked the user to disambiguate nor cited both conflicting sources "
        f"(cited: {sorted(cited)}), got: {answer}"
    )
    match = _ASSIGNS_WRAPPING_TAG_STATUS.search(answer)
    assert match is None, (
        f"Both conflicting sources are default-tier; answer must not assign wrapping-tag "
        f"authority to a figure (matched {match.group(0)!r}): {answer}"
    )


@pytest.mark.order(6)
def test_conflicting_fares_present_both_versions(prepare_harbor_shuttle_data: None) -> None:
    """Undated sources state 12 vs 20 credits — the answer must carry both and ask back."""
    data = _ask("How much does an adult ticket for the Veridian harbor shuttle cost?", 520)
    _assert_states_both(data, _GUIDE_FARE, _LEAFLET_FARE)


@pytest.mark.order(6)
def test_conflicting_capacity_presents_both_versions(prepare_harbor_shuttle_data: None) -> None:
    """Undated sources state 90 vs 60 passengers — the answer must carry both and ask back."""
    data = _ask("How many passengers can the Veridian harbor shuttle carry per crossing?", 521)
    _assert_states_both(data, _GUIDE_CAPACITY, _LEAFLET_CAPACITY)


@pytest.mark.order(6)
def test_uncontested_fact_gets_definite_answer(prepare_harbor_shuttle_data: None) -> None:
    """Control: only one source states the crossing time, so the answer must be definite with no clarifying question."""
    data = _ask("How long does the Veridian harbor shuttle crossing take?", 522)

    assert data.get("error_type") is None, f"Expected an answer, got error: {data.get('error_type')}"
    answer = str(data.get("answer", ""))
    assert answer, "Expected a non-empty answer"
    assert _CROSSING_MINUTES in answer, f"Expected crossing time {_CROSSING_MINUTES} in answer, got: {answer}"
    assert not answer.rstrip().endswith("?"), (
        f"An uncontested fact must not end in a clarifying question, got: {answer}"
    )
    match = _ASSIGNS_WRAPPING_TAG_STATUS.search(answer)
    assert match is None, (
        f"Uncontested default-tier fact must not be assigned wrapping-tag authority "
        f"(matched {match.group(0)!r}): {answer}"
    )
