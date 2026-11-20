"""Integration tests for query decomposition via /chat."""

from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

import pytest
import requests
from glom import glom
from loguru import logger

from tests.integration_fixtures import BASE_URL, HUB_ID, normalized_answer

pytestmark = pytest.mark.integration

# (message_id, message) per decomposition case
DECOMPOSITION_QUERIES: dict[str, tuple[int, str]] = {
    "multi_intent": (999, "What is PRISM and who created it? Also, what organization are they from?"),
    "temporal_comparison": (1000, "What projects did Meedan work on, and what were their key achievements?"),
    "simple": (1001, "What is Meedan?"),
    "both_answered": (1002, "Who is the director of research at Meedan and what is PRISM?"),
    "mixed": (1003, "What is PRISM, and how do I make traditional spaghetti carbonara?"),
    "mixed_reversed": (1004, "How do I make traditional spaghetti carbonara, and what is PRISM?"),
    "both_failed": (1005, "How do I change a bicycle tire, and what is the melting point of tungsten?"),
}

_DECOMPOSITION_SUBQUERY_STATUSES = frozenset(
    {"no_subquery_results", "partial_subquery", "multi_subquery", "fallback_concatenation"}
)
# synthesizer LLM failure still concatenates every answered sub-query; that is an all-answered
# outcome, not a partial or empty one
_ALL_ANSWERED_SYNTHESIS_STATUSES = frozenset({"multi_subquery", "fallback_concatenation"})
# seven concurrent synthesizer calls can 429 or time out; 4 still overlaps the slow
# decomposed paths without saturating the provider
_DECOMPOSITION_MAX_WORKERS = 4

_GAP_ACKNOWLEDGEMENT_PHRASES = [
    "don't have",
    "do not have",
    "not enough information",
    "cannot answer",
    "can't answer",
    "no relevant",
    "outside",
    "knowledge base",
    "not able to",
    "unable to",
    "no information",
    "no result",  # the synthesizer's wording when a sub-query came back with nothing
    "there is no",
    "not mentioned",
    "could not",
    "couldn't",
    "not found",
    "does not contain",
    "do not contain",
    "cannot provide",
    "can't provide",
    "no details",
    "not available",
    "cannot confirm",
    "did not",
    "not stated",
    "was not",  # catches "was not mentioned", "was not found", "was not clearly stated"
    "sources do not",
    "sources don't",
]


def _ask_decomposition_chat(message_id: int, message: str) -> dict[str, Any]:
    # decomposition runs each sub-query through the full retriever cascade serially
    # (answer + judge + rephrase + HyDE), so these calls need a much larger timeout
    # than the single-query paths
    payload = {"hub_id": HUB_ID, "message_id": message_id, "message": message, "history": []}
    response = requests.post(f"{BASE_URL}/chat/", json=payload, timeout=240)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    data: dict[str, Any] = response.json()
    return data


def _resolve_decomposition_future(future: Future[dict[str, Any]]) -> dict[str, Any] | Exception:
    try:
        return future.result()
    except Exception as exc:
        return exc


def _response_for(responses: dict[str, dict[str, Any] | Exception], name: str) -> dict[str, Any]:
    result = responses[name]
    if isinstance(result, Exception):
        raise result
    return result


@pytest.fixture(scope="module")
def decomposition_responses(prepare_test_data: None) -> dict[str, dict[str, Any] | Exception]:
    """All decomposition cases are issued at once: they are independent reads against
    already-ingested data, so paying the router latency seven times over serially would
    dominate the suite's runtime."""
    with ThreadPoolExecutor(max_workers=_DECOMPOSITION_MAX_WORKERS) as pool:
        futures = {
            name: pool.submit(_ask_decomposition_chat, message_id, message)
            for name, (message_id, message) in DECOMPOSITION_QUERIES.items()
        }
        # a failure in one case must not mask the other six, so exceptions are captured
        # here and re-raised inside the test that owns them
        return {name: _resolve_decomposition_future(future) for name, future in futures.items()}


def _assert_partial_prism_carbonara(data: dict[str, Any]) -> None:
    used = glom(data, "metadata.router_decomposition_used", default=None)
    count = glom(data, "metadata.router_subquery_count", default=None)
    answered = glom(data, "metadata.router_subquery_answered_count", default=None)
    status = glom(data, "metadata.router_synthesis_status", default=None)
    answer = normalized_answer(data.get("answer"))
    logger.info(f"partial synthesis: used={used} count={count} answered={answered} status={status} answer={answer}")

    assert used is True, f"Expected decomposition, got router_decomposition_used={used}"
    assert count == 2, f"Expected 2 sub-queries, got {count}"
    assert answered == 1, f"Expected 1 answered sub-query, got {answered}"
    assert status == "partial_subquery", f"Expected partial_subquery, got {status}"
    assert "prism" in answer, f"Answer should mention PRISM: {answer}"
    assert "carbonara" in answer or "spaghetti" in answer, f"Answer should name the unanswered recipe half: {answer}"
    assert any(phrase in answer for phrase in _GAP_ACKNOWLEDGEMENT_PHRASES), (
        f"Expected the unanswered half to be acknowledged rather than dropped or invented. Answer: {answer}"
    )


@pytest.mark.order(10)
def test_query_decomposition_multi_intent(
    decomposition_responses: dict[str, dict[str, Any] | Exception],
) -> None:
    logger.info("Testing query decomposition with multi-intent query")

    data = _response_for(decomposition_responses, "multi_intent")
    assert "answer" in data, "Response should contain answer"
    assert data["answer"], "Answer should not be empty"

    used = glom(data, "metadata.router_decomposition_used", default=None)
    count = glom(data, "metadata.router_subquery_count", default=None)
    status = glom(data, "metadata.router_synthesis_status", default=None)
    answer = normalized_answer(data["answer"])
    logger.info(f"used={used} count={count} status={status} answer={answer}")

    assert used is True, f"Expected decomposition, got router_decomposition_used={used}"
    assert count is not None and count >= 2, f"Expected at least 2 sub-queries, got {count}"
    # the decomposer often splits "what organization are they from?" into "what organization
    # created PRISM?", which the corpus does not name as a single creator org — so 2/3 plus a
    # named gap is the honest outcome. 3/3 is also fine when the judge accepts Oxford.
    assert status in (_ALL_ANSWERED_SYNTHESIS_STATUSES | {"partial_subquery"}), (
        f"Expected a synthesized decomposed answer, got {status}"
    )
    assert "prism" in answer, "Answer should mention PRISM"
    if status == "partial_subquery":
        # After commit 44d8aed1, partial synthesis explicitly acknowledges gaps.
        # Check via metadata that not all sub-queries were answered.
        answered_count = glom(data, "metadata.router_subquery_answered_count", default=None)
        assert answered_count is not None and answered_count < count, (
            f"Partial synthesis should have some unanswered sub-queries. "
            f"Got {answered_count}/{count} answered. Answer: {answer}"
        )
        # Also check that the answer acknowledges the gap (phrasing may vary)
        assert any(phrase in answer for phrase in _GAP_ACKNOWLEDGEMENT_PHRASES), (
            f"Partial synthesis should acknowledge the unanswered part. Answer: {answer}"
        )
    logger.info("Query decomposition multi-intent test passed")


@pytest.mark.order(11)
def test_query_decomposition_temporal_comparison(
    decomposition_responses: dict[str, dict[str, Any] | Exception],
) -> None:
    logger.info("Testing query decomposition with temporal comparison")

    data = _response_for(decomposition_responses, "temporal_comparison")
    assert "answer" in data, "Response should contain answer"
    assert data["answer"], "Answer should not be empty"

    used = glom(data, "metadata.router_decomposition_used", default=None)
    count = glom(data, "metadata.router_subquery_count", default=None)
    status = glom(data, "metadata.router_synthesis_status", default=None)
    answer = data["answer"].lower()
    logger.info(f"used={used} count={count} status={status} answer={answer}")

    assert used is True, f"Expected decomposition, got router_decomposition_used={used}"
    assert count is not None and count >= 2, f"Expected at least 2 sub-queries, got {count}"
    assert status in _ALL_ANSWERED_SYNTHESIS_STATUSES, (
        f"Expected all sub-queries answered (multi_subquery or fallback_concatenation), got {status}"
    )
    assert "meedan" in answer, "Answer should mention Meedan"
    logger.info("Query decomposition temporal comparison test passed")


@pytest.mark.order(12)
def test_simple_query_no_decomposition(
    decomposition_responses: dict[str, dict[str, Any] | Exception],
) -> None:
    logger.info("Testing simple query without decomposition")

    data = _response_for(decomposition_responses, "simple")
    assert "answer" in data, "Response should contain answer"
    assert data["answer"], "Answer should not be empty"

    used = glom(data, "metadata.router_decomposition_used", default=None)
    status = glom(data, "metadata.router_synthesis_status", default=None)
    answer = data["answer"].lower()
    logger.info(f"used={used} status={status} answer={answer}")

    assert not used, f"Simple query should not decompose, got router_decomposition_used={used}"
    assert status not in _DECOMPOSITION_SUBQUERY_STATUSES, (
        f"Simple query should not use a sub-query synthesis status, got {status}"
    )
    assert "meedan" in answer, "Answer should mention Meedan"
    logger.info("Simple query (no decomposition) test passed")


@pytest.mark.order(12)
def test_query_decomposition_both_answered_heuristic_bypass(
    decomposition_responses: dict[str, dict[str, Any] | Exception],
) -> None:
    logger.info("Testing coordinated wh-clause heuristic bypass (both sub-queries answered)")

    data = _response_for(decomposition_responses, "both_answered")
    used = glom(data, "metadata.router_decomposition_used", default=None)
    count = glom(data, "metadata.router_subquery_count", default=None)
    answered = glom(data, "metadata.router_subquery_answered_count", default=None)
    status = glom(data, "metadata.router_synthesis_status", default=None)
    answer = (data.get("answer") or "").lower()
    topics = data.get("topics") or []
    logger.info(f"used={used} count={count} answered={answered} status={status} topics={topics} answer={answer}")

    assert data.get("error_type") is None, f"Expected a grounded answer, got error_type={data.get('error_type')}"
    assert used is True, f"Expected decomposition, got router_decomposition_used={used}"
    assert count == 2, f"Expected 2 sub-queries, got {count}"
    assert answered == 2, f"Expected 2 answered sub-queries, got {answered}"
    assert status in _ALL_ANSWERED_SYNTHESIS_STATUSES, (
        f"Expected all sub-queries answered (multi_subquery or fallback_concatenation), got {status}"
    )
    assert "hale" in answer, f"Answer should mention Hale: {answer}"
    assert "prism" in answer, f"Answer should mention PRISM: {answer}"
    assert isinstance(topics, list) and len(topics) > 0, f"Expected non-empty topics from sub-queries, got {topics}"


@pytest.mark.order(12)
def test_query_decomposition_mixed_partial_synthesis(
    decomposition_responses: dict[str, dict[str, Any] | Exception],
) -> None:
    logger.info("Testing mixed PRISM/carbonara partial synthesis")

    data = _response_for(decomposition_responses, "mixed")
    _assert_partial_prism_carbonara(data)
    topics = data.get("topics") or []
    assert isinstance(topics, list) and len(topics) > 0, f"Expected non-empty topics from sub-queries, got {topics}"


@pytest.mark.order(12)
def test_query_decomposition_mixed_partial_synthesis_reversed(
    decomposition_responses: dict[str, dict[str, Any] | Exception],
) -> None:
    logger.info("Testing mixed carbonara/PRISM partial synthesis (reversed order)")

    data = _response_for(decomposition_responses, "mixed_reversed")
    _assert_partial_prism_carbonara(data)


@pytest.mark.order(12)
def test_query_decomposition_both_failed(
    decomposition_responses: dict[str, dict[str, Any] | Exception],
) -> None:
    logger.info("Testing both-failed bicycle tire / tungsten decomposition")

    data = _response_for(decomposition_responses, "both_failed")
    used = glom(data, "metadata.router_decomposition_used", default=None)
    count = glom(data, "metadata.router_subquery_count", default=None)
    answered = glom(data, "metadata.router_subquery_answered_count", default=None)
    status = glom(data, "metadata.router_synthesis_status", default=None)
    error_type = data.get("error_type")
    answer = (data.get("answer") or "").lower()
    documents_count = glom(data, "metadata.documents_count", default=None)
    logger.info(
        f"used={used} count={count} answered={answered} status={status} "
        f"error_type={error_type} documents_count={documents_count} answer={answer}"
    )

    assert used is True, f"Expected decomposition, got router_decomposition_used={used}"
    assert count == 2, f"Expected 2 sub-queries, got {count}"
    assert answered == 0, f"Expected 0 answered sub-queries, got {answered}"
    assert status == "no_subquery_results", f"Expected no_subquery_results, got {status}"

    has_error_type = error_type is not None
    has_no_documents = documents_count == 0
    has_insufficient_phrase = any(phrase in answer for phrase in _GAP_ACKNOWLEDGEMENT_PHRASES)
    assert has_error_type or has_no_documents or has_insufficient_phrase, (
        f"Expected a surfaced refusal. Got: error_type={error_type}, documents_count={documents_count}, answer={answer}"
    )
