"""Integration tests: a synthesis answer must stay within the place the question names.

Hub 10 holds the same programme in two coined places. Topical retrieval is a broad top-k search
with no place filter, so both documents reach the summarizer. The summary must be built from the
requested place only, whether the place is stated outright or resolved from the conversation, and
a place no document covers must end in the no-answer fallback rather than a summary of the others.
"""

from typing import Any

import pytest
import requests
from glom import glom
from loguru import logger

from tests.integration_fixtures import (
    BASE_URL,
    SCOPED_SYNTHESIS_HUB_ID,
    SCOPED_SYNTHESIS_IN_SCOPE_DOC_ID,
    SCOPED_SYNTHESIS_IN_SCOPE_TERMS,
    SCOPED_SYNTHESIS_OTHER_PLACE,
    SCOPED_SYNTHESIS_OUT_OF_SCOPE_DOC_ID,
    SCOPED_SYNTHESIS_OUT_OF_SCOPE_TERMS,
    SCOPED_SYNTHESIS_PLACE,
    SCOPED_SYNTHESIS_UNCOVERED_PLACE,
)

pytestmark = pytest.mark.integration

_TIMEOUT = 180


def _chat(payload: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=_TIMEOUT)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data: dict[str, Any] = response.json()
    logger.info(f"answer={data.get('answer')!r}")
    logger.info(f"metadata={data.get('metadata')}")
    return data


def _assert_summary_scoped_to_place(data: dict[str, Any]) -> None:
    answer = str(data.get("answer") or "")
    answer_lower = answer.lower()
    metadata = data.get("metadata") or {}

    assert data.get("error_type") is None, (
        f"Expected a summary for a covered place, got {data.get('error_type')}: {answer}"
    )

    in_scope_hits = [t for t in SCOPED_SYNTHESIS_IN_SCOPE_TERMS if t in answer_lower]
    assert in_scope_hits, f"Expected facts about {SCOPED_SYNTHESIS_PLACE}, got none. Answer: {answer}"

    leaked = [t for t in SCOPED_SYNTHESIS_OUT_OF_SCOPE_TERMS if t in answer_lower]
    assert not leaked, f"Facts about {SCOPED_SYNTHESIS_OTHER_PLACE} leaked into the summary: {leaked}. Answer: {answer}"

    cited = metadata.get("document_ids_cited") or []
    assert SCOPED_SYNTHESIS_IN_SCOPE_DOC_ID in cited, f"Expected the in-scope document to be cited, got {cited}"
    assert SCOPED_SYNTHESIS_OUT_OF_SCOPE_DOC_ID not in cited, f"The other place's document was cited: {cited}"

    # the scope rule lives in the synthesis path, so the routing check comes after the behavior checks
    assert metadata.get("router_intent") == "synthesis", (
        f"Expected synthesis routing, got router_intent={metadata.get('router_intent')!r}"
    )


@pytest.mark.order(29)
def test_topical_summary_stays_within_named_place(prepare_scoped_synthesis_data: None) -> None:
    data = _chat(
        {
            "hub_id": SCOPED_SYNTHESIS_HUB_ID,
            "message_id": 10001,
            "message": f"Summarize the mobile library programme in {SCOPED_SYNTHESIS_PLACE}.",
            "history": [],
        }
    )
    _assert_summary_scoped_to_place(data)


@pytest.mark.order(29)
def test_topical_summary_keeps_place_resolved_from_history(prepare_scoped_synthesis_data: None) -> None:
    data = _chat(
        {
            "hub_id": SCOPED_SYNTHESIS_HUB_ID,
            "message_id": 10002,
            "message": "Give me an overview of the mobile library programme there.",
            "history": [
                {"role": "user", "content": f"Do you have anything about {SCOPED_SYNTHESIS_PLACE}?"},
                {"role": "assistant", "content": f"Yes, I have information about {SCOPED_SYNTHESIS_PLACE}."},
            ],
        }
    )

    rewritten_question = glom(data, "metadata.rewritten_question", default=None)
    assert rewritten_question and SCOPED_SYNTHESIS_PLACE in rewritten_question, (
        f"Expected the rewriter to resolve the place, got: {rewritten_question}"
    )
    _assert_summary_scoped_to_place(data)


@pytest.mark.order(29)
def test_topical_summary_keeps_place_resolved_from_notes(prepare_scoped_synthesis_data: None) -> None:
    """The conversation notes are the rewriter's only source for "my town": the summarizer never sees them directly."""
    data = _chat(
        {
            "hub_id": SCOPED_SYNTHESIS_HUB_ID,
            "message_id": 10004,
            "message": "Summarize the mobile library programme in my town.",
            "history": [],
            "conversation_context": [{"id": "n1", "text": f"Lives in {SCOPED_SYNTHESIS_PLACE}"}],
        }
    )

    rewritten_question = glom(data, "metadata.rewritten_question", default=None)
    assert rewritten_question and SCOPED_SYNTHESIS_PLACE in rewritten_question, (
        f"Expected the rewriter to take the place from the notes, got: {rewritten_question}"
    )
    _assert_summary_scoped_to_place(data)


@pytest.mark.order(29)
def test_digest_keeps_place_resolved_from_notes(prepare_scoped_synthesis_data: None) -> None:
    """A digest that names no place is about the user's surroundings: the rewriter adds the noted place."""
    data = _chat(
        {
            "hub_id": SCOPED_SYNTHESIS_HUB_ID,
            "message_id": 10005,
            "message": "Summarize this week's news.",
            "history": [],
            "conversation_context": [{"id": "n1", "text": f"Lives in {SCOPED_SYNTHESIS_PLACE}"}],
        }
    )

    rewritten_question = glom(data, "metadata.rewritten_question", default=None)
    assert rewritten_question and SCOPED_SYNTHESIS_PLACE in rewritten_question, (
        f"Expected the rewriter to localize the digest from the notes, got: {rewritten_question}"
    )
    _assert_summary_scoped_to_place(data)


@pytest.mark.order(29)
def test_topical_summary_refuses_place_no_document_covers(prepare_scoped_synthesis_data: None) -> None:
    data = _chat(
        {
            "hub_id": SCOPED_SYNTHESIS_HUB_ID,
            "message_id": 10003,
            "message": f"Summarize the mobile library programme in {SCOPED_SYNTHESIS_UNCOVERED_PLACE}.",
            "history": [],
        }
    )
    answer_lower = str(data.get("answer") or "").lower()

    assert data.get("error_type") == "NO_ANSWER_AVAILABLE", (
        f"Expected the no-answer fallback for an uncovered place, got {data.get('error_type')}: {answer_lower}"
    )
    leaked = [t for t in SCOPED_SYNTHESIS_IN_SCOPE_TERMS + SCOPED_SYNTHESIS_OUT_OF_SCOPE_TERMS if t in answer_lower]
    assert not leaked, f"Other places were summarized instead of refusing: {leaked}. Answer: {answer_lower}"
