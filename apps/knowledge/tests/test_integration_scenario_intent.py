"""Integration smoke tests for personalization scenario intent routing.

These tests hit /chat with personalization payloads and do not require
document ingestion. They validate end-to-end scenario short-circuit behavior
and that answers only surface contact details from configured resource titles.
"""

import os
from typing import Any

import pytest
import requests
from glom import glom
from loguru import logger

from tests.plain_text_assertions import assert_plain_text_answer
from tests.scenario_contact_assertions import assert_answer_contacts_subset

pytestmark = pytest.mark.integration

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
HUB_ID = 1

SUPPORT_LINE = "+1 555 1234"
STORE_URL = "https://example.org/store"
EMAIL_SUPPORT = "hello@meedan.org"

ALL_SUPPORTED_LANGUAGES = ["en", "ar", "fr", "pt", "es", "hi"]

MEEDAN_EMAIL_PERSONALIZATION: dict[str, Any] = {
    "name": "Meedan",
    "hub_name": "Meedan",
    "tone": "advocate",
    "external_resources": [
        {
            "title": EMAIL_SUPPORT,
            "description": "When users want to talk to a human (real person).",
            "scenarios": ["speak_to_person"],
        },
    ],
}

PERSONALIZATION = {
    "name": "TestBot",
    "tone": "advocate",
    "external_resources": [
        {"title": SUPPORT_LINE, "description": "Support line", "scenarios": ["speak_to_person"]},
        {"title": STORE_URL, "description": "Online store", "scenarios": ["purchase_subscribe"]},
    ],
}

LOCALIZED_QUERIES: dict[str, dict[str, str]] = {
    "en": {
        "speak_to_person": "Can I talk to a real person?",
        "purchase_buy": "I would like to buy your stuff",
        "purchase_services": "Can I know more about your services?",
    },
    "es": {
        "speak_to_person": "¿Puedo hablar con una persona real?",
        "purchase_buy": "Me gustaría comprar sus productos",
        "purchase_services": "¿Puedo saber más sobre sus servicios?",
    },
    "fr": {
        "speak_to_person": "Puis-je parler à une vraie personne ?",
        "purchase_buy": "Je voudrais acheter vos produits",
        "purchase_services": "Puis-je en savoir plus sur vos services ?",
    },
    "pt": {
        "speak_to_person": "Posso falar com uma pessoa real?",
        "purchase_buy": "Gostaria de comprar os seus produtos",
        "purchase_services": "Posso saber mais sobre os seus serviços?",
    },
    "ar": {
        "speak_to_person": "هل يمكنني التحدث إلى شخص حقيقي؟",
        "purchase_buy": "أود شراء منتجاتكم",
        "purchase_services": "هل يمكنني معرفة المزيد عن خدماتكم؟",
    },
    "hi": {
        "speak_to_person": "क्या मैं किसी असली व्यक्ति से बात कर सकता हूँ?",
        "purchase_buy": "मैं आपकी चीज़ें खरीदना चाहता हूँ",
        "purchase_services": "क्या मैं आपकी सेवाओं के बारे में और जान सकता हूँ?",
    },
}

_LANG_MESSAGE_ID_BASE = {"en": 9000, "ar": 9100, "fr": 9200, "pt": 9300, "es": 9400, "hi": 9500}


def _chat_payload(
    message: str,
    message_id: int,
    lang: str | None = None,
    personalization: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload_personalization: dict[str, Any] = {**(personalization if personalization is not None else PERSONALIZATION)}
    if lang is not None:
        payload_personalization["default_language"] = lang
        payload_personalization["supported_languages"] = ALL_SUPPORTED_LANGUAGES

    return {
        "hub_id": HUB_ID,
        "message_id": message_id,
        "message": message,
        "history": [],
        "personalization": payload_personalization,
    }


def _assert_scenario_response(
    response: requests.Response,
    *,
    expected_intent: str,
    expected_resource: str,
    allowed_resources: list[str] | None = None,
    lang: str,
    scenario: str,
) -> None:
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    router_intent = glom(data, "metadata.router_intent", default=None)
    response_lang = glom(data, "metadata.language", default=None)

    logger.info(
        f"lang={lang} scenario={scenario} router_intent={router_intent!r} "
        f"response_lang={response_lang!r} answer={answer[:200]!r}"
    )

    assert data.get("error_type") is None
    assert router_intent == expected_intent
    assert expected_resource in answer
    assert_answer_contacts_subset(answer, allowed_resources or [expected_resource])
    assert_plain_text_answer(answer)


@pytest.mark.order(2)
def test_speak_to_person_email_only_no_extra_contacts() -> None:
    lang = "en"
    _assert_scenario_response(
        requests.post(
            f"{BASE_URL}/chat",
            json=_chat_payload(
                "I'd like to talk to a human",
                message_id=9601,
                lang=lang,
                personalization=MEEDAN_EMAIL_PERSONALIZATION,
            ),
            timeout=60,
        ),
        expected_intent="speak_to_person",
        expected_resource=EMAIL_SUPPORT,
        allowed_resources=[EMAIL_SUPPORT],
        lang=lang,
        scenario="speak_to_person_email_only",
    )


@pytest.mark.order(2)
def test_speak_to_person_includes_resource() -> None:
    lang = "en"
    _assert_scenario_response(
        requests.post(
            f"{BASE_URL}/chat",
            json=_chat_payload(
                LOCALIZED_QUERIES[lang]["speak_to_person"],
                message_id=_LANG_MESSAGE_ID_BASE[lang] + 1,
                lang=lang,
            ),
            timeout=60,
        ),
        expected_intent="speak_to_person",
        expected_resource=SUPPORT_LINE,
        lang=lang,
        scenario="speak_to_person",
    )


@pytest.mark.order(2)
def test_purchase_subscribe_includes_resource() -> None:
    lang = "en"
    _assert_scenario_response(
        requests.post(
            f"{BASE_URL}/chat",
            json=_chat_payload(
                LOCALIZED_QUERIES[lang]["purchase_buy"],
                message_id=_LANG_MESSAGE_ID_BASE[lang] + 2,
                lang=lang,
            ),
            timeout=60,
        ),
        expected_intent="purchase_subscribe",
        expected_resource=STORE_URL,
        lang=lang,
        scenario="purchase_buy",
    )


@pytest.mark.order(2)
def test_purchase_subscribe_services_inquiry_includes_resource() -> None:
    lang = "en"
    _assert_scenario_response(
        requests.post(
            f"{BASE_URL}/chat",
            json=_chat_payload(
                LOCALIZED_QUERIES[lang]["purchase_services"],
                message_id=_LANG_MESSAGE_ID_BASE[lang] + 3,
                lang=lang,
            ),
            timeout=60,
        ),
        expected_intent="purchase_subscribe",
        expected_resource=STORE_URL,
        lang=lang,
        scenario="purchase_services",
    )


@pytest.mark.order(2)
@pytest.mark.parametrize("lang", ["ar", "fr", "pt", "es", "hi"])
def test_speak_to_person_includes_resource_localized(lang: str) -> None:
    _assert_scenario_response(
        requests.post(
            f"{BASE_URL}/chat",
            json=_chat_payload(
                LOCALIZED_QUERIES[lang]["speak_to_person"],
                message_id=_LANG_MESSAGE_ID_BASE[lang] + 1,
                lang=lang,
            ),
            timeout=60,
        ),
        expected_intent="speak_to_person",
        expected_resource=SUPPORT_LINE,
        lang=lang,
        scenario="speak_to_person",
    )


@pytest.mark.order(2)
@pytest.mark.parametrize("lang", ["ar", "fr", "pt", "es", "hi"])
def test_purchase_subscribe_includes_resource_localized(lang: str) -> None:
    _assert_scenario_response(
        requests.post(
            f"{BASE_URL}/chat",
            json=_chat_payload(
                LOCALIZED_QUERIES[lang]["purchase_buy"],
                message_id=_LANG_MESSAGE_ID_BASE[lang] + 2,
                lang=lang,
            ),
            timeout=60,
        ),
        expected_intent="purchase_subscribe",
        expected_resource=STORE_URL,
        lang=lang,
        scenario="purchase_buy",
    )


HELP_URL = "https://example.org/help"

UNANSWERABLE_RESOURCE_PERSONALIZATION: dict[str, Any] = {
    "name": "TestBot",
    "tone": "advocate",
    "external_resources": [
        {
            "title": HELP_URL,
            "description": "Help center for questions the bot cannot answer.",
            "scenarios": ["unanswerable_question"],
        },
    ],
}


@pytest.mark.order(2)
def test_error_message_resource_url_is_plain_text() -> None:
    """LLM-generated error messages must include resource URLs bare, never as markdown links.

    Regression test: get_error_message() used to render resources as [title](url),
    which reaches end users verbatim on plain-text channels. A metaquestion triggers
    that path deterministically (refusal generated by the error-message LLM with the
    hub's unanswerable_question resources), without requiring document ingestion.
    """
    response = requests.post(
        f"{BASE_URL}/chat",
        json=_chat_payload(
            "How many articles do you have in your knowledge base?",
            message_id=9701,
            lang="en",
            personalization=UNANSWERABLE_RESOURCE_PERSONALIZATION,
        ),
        timeout=60,
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    router_intent = glom(data, "metadata.router_intent", default=None)

    logger.info(f"scenario=unanswerable_error_message router_intent={router_intent!r} answer={answer[:200]!r}")

    assert data.get("error_type") == "METAQUESTION"
    assert HELP_URL in answer, f"Resource URL missing from error message: {answer!r}"
    assert_plain_text_answer(answer)


ABOUT_URL = "https://example.org/about"

ROLE_DESCRIPTION_PERSONALIZATION: dict[str, Any] = {
    "name": "TestBot",
    "tone": "advocate",
    "description": "a local news assistant covering politics, public health, and business in your area",
    "external_resources": [
        {
            "title": ABOUT_URL,
            "description": "Learn more about what this assistant can help with.",
            "scenarios": ["role_description"],
        },
    ],
}


@pytest.mark.order(2)
@pytest.mark.parametrize(
    ("query", "message_id"),
    [
        ("What things can I ask you about?", 9711),
        ("Who are you and what can you do?", 9712),
    ],
)
def test_role_description_identity_question_is_answered_not_refused(query: str, message_id: int) -> None:
    """Identity/capability questions must be answered with a role description, not the
    metaquestion refusal (regression for report 16829). The router should classify them
    as role_description and surface the hub's role_description resource."""
    response = requests.post(
        f"{BASE_URL}/chat",
        json=_chat_payload(
            query,
            message_id=message_id,
            lang="en",
            personalization=ROLE_DESCRIPTION_PERSONALIZATION,
        ),
        timeout=60,
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    router_intent = glom(data, "metadata.router_intent", default=None)

    logger.info(f"scenario=role_description query={query!r} router_intent={router_intent!r} answer={answer[:200]!r}")

    # not refused as a metaquestion
    assert data.get("error_type") is None, f"identity question was refused: {answer!r}"
    assert router_intent == "role_description"
    assert answer.strip(), "expected a non-empty role description answer"
    assert ABOUT_URL in answer, f"role_description resource missing from answer: {answer!r}"
    assert_plain_text_answer(answer)


@pytest.mark.order(2)
def test_role_description_without_personalization_is_answered() -> None:
    """With no personalization configured at all, an identity question must still be answered
    as a role_description (helpful generic reply) rather than refused as a metaquestion."""
    response = requests.post(
        f"{BASE_URL}/chat",
        json={
            "hub_id": HUB_ID,
            "message_id": 9713,
            "message": "Who are you and what can you do?",
            "history": [],
        },
        timeout=60,
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    router_intent = glom(data, "metadata.router_intent", default=None)

    logger.info(f"scenario=role_description_no_personalization router_intent={router_intent!r} answer={answer[:200]!r}")

    assert data.get("error_type") is None, f"identity question was refused: {answer!r}"
    assert router_intent == "role_description"
    assert answer.strip(), "expected a non-empty role description answer"
    assert_plain_text_answer(answer)


@pytest.mark.order(2)
@pytest.mark.parametrize(
    ("query", "message_id"),
    [
        ("How do you reason about your answers?", 9714),
        ("How did you come up with that?", 9715),
    ],
)
def test_reasoning_question_is_still_metaquestion(query: str, message_id: int) -> None:
    """A question about the bot's reasoning / internals must remain a METAQUESTION refusal,
    NOT be reclassified as role_description. Guards the metaquestion<->role_description boundary."""
    response = requests.post(
        f"{BASE_URL}/chat",
        json={
            "hub_id": HUB_ID,
            "message_id": message_id,
            "message": query,
            "history": [],
        },
        timeout=60,
    )
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    router_intent = glom(data, "metadata.router_intent", default=None)

    logger.info(f"scenario=metaquestion query={query!r} router_intent={router_intent!r} answer={answer[:200]!r}")

    assert router_intent == "metaquestion", f"reasoning question misrouted to {router_intent!r}: {answer!r}"
    assert data.get("error_type") == "METAQUESTION"
    assert_plain_text_answer(answer)


@pytest.mark.order(2)
@pytest.mark.parametrize("lang", ["ar", "fr", "pt", "es", "hi"])
def test_purchase_subscribe_services_inquiry_includes_resource_localized(lang: str) -> None:
    _assert_scenario_response(
        requests.post(
            f"{BASE_URL}/chat",
            json=_chat_payload(
                LOCALIZED_QUERIES[lang]["purchase_services"],
                message_id=_LANG_MESSAGE_ID_BASE[lang] + 3,
                lang=lang,
            ),
            timeout=60,
        ),
        expected_intent="purchase_subscribe",
        expected_resource=STORE_URL,
        lang=lang,
        scenario="purchase_services",
    )
