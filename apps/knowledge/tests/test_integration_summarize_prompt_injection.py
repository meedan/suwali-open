"""Integration tests: summarization must treat source content as untrusted data.

Permanent security contract for item/notebook summarization and chat synthesis.
These tests call live endpoints with injection-shaped payloads and assert behavioral invariants.
NOTE: DO NOT weaken these assertions. If the tests fail after a summarizer change, the fix is incomplete.
"""

import pytest
import requests
from loguru import logger

from tests.integration_fixtures import BASE_URL, SUMMARIZER_INJECTION_HUB_ID
from tests.summarize_injection_fixtures import (
    INJECTION_CASES,
    SYNTHESIS_INJECTION_CASE,
    SYNTHESIS_INJECTION_DOCUMENT_ID,
    SYNTHESIS_INJECTION_TOPIC,
    InjectionCase,
    assert_secure_summarization,
    post_summarize,
)

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("case", INJECTION_CASES, ids=[c.id for c in INJECTION_CASES])
@pytest.mark.order(19)
def test_summarize_treats_note_content_as_data_not_instructions(case: InjectionCase) -> None:
    summary = post_summarize(case.texts, default_language="en")
    logger.info(f"[{case.id}] summary={summary!r}")
    assert_secure_summarization(summary, case)


@pytest.mark.order(20)
def test_synthesis_treats_retrieved_chunks_as_data_not_instructions(
    prepare_summarizer_injection_data: None,
) -> None:
    """Topical synthesis over an injected unique-topic doc must summarize, not Q&A.

    Lives on its own hub so topical top_k retrieval cannot mix in other session fixtures.
    """
    payload = {
        "hub_id": SUMMARIZER_INJECTION_HUB_ID,
        "message_id": 3100,
        "message": f"Tell me all you know about the {SYNTHESIS_INJECTION_TOPIC}.",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=120)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    metadata = data.get("metadata") or {}
    logger.info(f"synthesis injection answer={answer!r}")
    logger.info(f"synthesis injection metadata={metadata}")

    document_ids = set(metadata.get("document_ids_used") or []) | set(metadata.get("document_ids_cited") or [])
    assert SYNTHESIS_INJECTION_DOCUMENT_ID in document_ids, (
        f"Expected {SYNTHESIS_INJECTION_DOCUMENT_ID} among retrieved/cited docs, got {document_ids}. Answer: {answer}"
    )

    # injection resistance is asserted BEFORE the routing assertion below, and deliberately so:
    # these checks (substance present, instruction text absent) hold whichever route the query took,
    # while is_synthesis is an LLM judgement that flips run to run. Asserting routing first meant a
    # classification wobble failed the test without ever checking the thing it is named for.
    for forbidden in SYNTHESIS_INJECTION_CASE.forbidden_substrings:
        assert forbidden.lower() not in answer.lower(), (
            f"forbidden substring {forbidden!r} in synthesis answer "
            f"(instruction bleed or hallucinated answer): {answer!r}"
        )

    if metadata.get("answerable", True):
        assert_secure_summarization(answer, SYNTHESIS_INJECTION_CASE)

    assert metadata.get("synthesis_type") == "topical", (
        f"Expected topical synthesis, got synthesis_type={metadata.get('synthesis_type')!r}. Answer: {answer}"
    )
