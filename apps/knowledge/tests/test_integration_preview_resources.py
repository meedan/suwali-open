"""Integration smoke tests for /preview scenario resource filtering.

Mirrors the manual test-preview-routes.sh check: each preview scenario gets all
configured external_resources in the request, but the answer must surface only
the resource tagged for that scenario.
"""

import os
from typing import Any

import pytest
import requests
from loguru import logger

from tests.plain_text_assertions import assert_plain_text_answer
from tests.scenario_contact_assertions import assert_answer_contacts_subset

pytestmark = pytest.mark.integration

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")

FIRST_MESSAGE_URL = "https://example.org/welcome"
ROLE_GUIDE = "Role Guide"
SPEAK_EMAIL = "support@example.org"
BUY_NOW = "Buy Now"
CLOSING_URL = "https://example.org/goodbye"

ALL_RESOURCES = [FIRST_MESSAGE_URL, ROLE_GUIDE, SPEAK_EMAIL, BUY_NOW, CLOSING_URL]

PREVIEW_PERSONALIZATION: dict[str, Any] = {
    "name": "DemoBot",
    "description": "Helps with community news and local services",
    "hub_name": "Demo Hub",
    "tone": "advocate",
    "external_resources": [
        {"title": FIRST_MESSAGE_URL, "scenarios": ["first_message"]},
        {"title": ROLE_GUIDE, "scenarios": ["role_description"]},
        {"title": SPEAK_EMAIL, "scenarios": ["speak_to_person"]},
        {"title": BUY_NOW, "scenarios": ["purchase_subscribe"]},
        {"title": CLOSING_URL, "scenarios": ["conversation_closed"]},
    ],
}

SCENARIO_EXPECTED: list[tuple[str, str]] = [
    ("first_message", FIRST_MESSAGE_URL),
    ("role_description", ROLE_GUIDE),
    ("speak_to_person", SPEAK_EMAIL),
    ("purchase_subscribe", BUY_NOW),
    ("conversation_closed", CLOSING_URL),
]


@pytest.mark.order(6)
@pytest.mark.parametrize(("scenario", "expected_resource"), SCENARIO_EXPECTED)
def test_preview_api_surfaces_only_scenario_resource(scenario: str, expected_resource: str) -> None:
    """Each /preview scenario must include its own resource and exclude the others."""
    logger.info(f"Testing /preview resource filtering for scenario={scenario} expected={expected_resource}")

    response = requests.post(
        f"{BASE_URL}/preview",
        json={
            "scenario": scenario,
            "personalization": PREVIEW_PERSONALIZATION,
        },
        timeout=90,
    )

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    logger.info(f"scenario={scenario} answer={answer!r}")

    assert answer.strip(), f"Expected non-empty answer for scenario={scenario}"
    assert expected_resource in answer, (
        f"scenario={scenario} missing expected resource {expected_resource!r} in answer: {answer!r}"
    )

    forbidden = [title for title in ALL_RESOURCES if title != expected_resource]
    for title in forbidden:
        assert title not in answer, f"scenario={scenario} leaked resource {title!r} into answer: {answer!r}"

    assert_answer_contacts_subset(answer, [expected_resource])
    assert_plain_text_answer(answer)
