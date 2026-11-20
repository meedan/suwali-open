"""Integration tests for topic extraction during document ingestion and chat."""

import os

import pytest
import requests
from loguru import logger

from app.services.topic_extractor import TopicExtractor
from tests.integration_fixtures import (
    DATA_DIR,
    CallbackCapture,
    _ingest_document,
    _load_document_text,
)

pytestmark = pytest.mark.integration

_SKIP_TOPIC_EXTRACTION = os.getenv("TOPIC_EXTRACTION_ENABLED", "1").lower() in ("0", "false")

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
HUB_ID = 1

ELECTIONS_DOCUMENT = DATA_DIR / "elections-philippines-ecuador.txt"
ELECTIONS_DOCUMENT_ID = "integration_test_topic_extraction"

_ELECTION_THEME_KEYWORDS = (
    "election",
    "electoral",
    "democracy",
    "voting",
    "philippines",
    "ecuador",
)

_TIMEOUT = 180


def _elections_text() -> str:
    return _load_document_text(ELECTIONS_DOCUMENT)


def _topic_matches_election_theme(topic: str) -> bool:
    lowered = topic.lower()
    return any(keyword in lowered for keyword in _ELECTION_THEME_KEYWORDS)


def _assert_broad_election_topics(topics: list[str]) -> None:
    assert 1 <= len(topics) <= 5, f"Expected 1-5 topics, got {len(topics)}: {topics}"
    assert all(topic.strip() for topic in topics), f"Topics must be non-empty strings: {topics}"
    assert any(_topic_matches_election_theme(topic) for topic in topics), (
        f"Expected at least one election-themed topic from {_ELECTION_THEME_KEYWORDS}, got: {topics}"
    )
    logger.info(f"Extracted topics: {topics}")


def _topic_looks_french(topic: str) -> bool:
    if any(char in topic for char in "àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ"):
        return True
    lowered = topic.lower()
    election_topics_french_keywords = (
        "élection",
        "élector",
        "démocr",
        "intégrit",
        "désinformation",
        "philippines",
        "équateur",
        # "vote",
    )
    return any(keyword in lowered for keyword in election_topics_french_keywords)


def _assert_has_french_topic(topics: list[str]) -> None:
    assert 1 <= len(topics) <= 5, f"Expected 1-5 topics, got {len(topics)}: {topics}"
    assert any(_topic_looks_french(topic) for topic in topics), (
        f"Expected at least one distinctly French topic (diacritic or French keyword), got: {topics}"
    )
    logger.info(f"Extracted French topics: {topics}")


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
async def test_topic_extractor_returns_broad_election_topics() -> None:
    topics = await TopicExtractor().extract(_elections_text(), existing_topics=[])
    _assert_broad_election_topics(topics)


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
async def test_topic_extractor_reuses_existing_canonical_topic() -> None:
    topics = await TopicExtractor().extract(
        _elections_text(),
        existing_topics=["Elections", "Climate Policy"],
    )

    assert "Elections" in topics, f"Expected canonical reuse of 'Elections', got: {topics}"
    assert "Climate Policy" not in topics, f"Irrelevant existing topic should not appear: {topics}"
    assert len(topics) <= 5
    logger.info(f"Extracted topics with canonical reuse: {topics}")


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
def test_ingestion_callback_includes_extracted_topics() -> None:
    with CallbackCapture() as capture:
        _ingest_document(
            ELECTIONS_DOCUMENT,
            f"{ELECTIONS_DOCUMENT_ID}_callback",
            _elections_text(),
            callback_url=capture.url,
        )
        callback = capture.wait_for_request(timeout=_TIMEOUT)

    assert callback.success is True, f"Expected successful ingestion callback, got: {callback}"
    _assert_broad_election_topics(callback.topics)


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
def test_ingestion_callback_reuses_existing_topic() -> None:
    with CallbackCapture() as capture:
        _ingest_document(
            ELECTIONS_DOCUMENT,
            f"{ELECTIONS_DOCUMENT_ID}_reuse",
            _elections_text(),
            callback_url=capture.url,
            existing_topics=["Elections"],
        )
        callback = capture.wait_for_request(timeout=_TIMEOUT)

    assert callback.success is True, f"Expected successful ingestion callback, got: {callback}"
    assert "Elections" in callback.topics, f"Expected canonical reuse of 'Elections', got: {callback.topics}"
    logger.info(f"Callback topics with canonical reuse: {callback.topics}")


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
async def test_topic_extractor_extracts_topics_in_portuguese() -> None:
    """Test that topics are extracted in the same language as the content (Portuguese)."""
    portuguese_text = """
    Brasil vence a Croácia por 3 a 1 e conquista o hexacampeonato mundial de futebol.
    A seleção brasileira mostrou um futebol dominante durante toda a partida final realizada
    no estádio Maracanã. Os gols foram marcados por Neymar, Vinícius Júnior e Richarlison,
    enquanto a Croácia conseguiu apenas um gol de consolação com Modric. A vitória representa
    o sexto título mundial do Brasil, consolidando sua posição como a seleção mais vitoriosa
    da história das Copas do Mundo. Torcedores celebraram nas ruas de todo o país após o
    apito final, em cenas de pura alegria e emoção nacional.
    """

    topics = await TopicExtractor().extract(portuguese_text, existing_topics=[])

    assert len(topics) >= 1, f"Expected at least one topic, got {len(topics)}: {topics}"

    # Check that at least one topic appears to be in Portuguese
    # Common Portuguese topic words related to this content
    portuguese_indicators = ["brasil", "futebol", "copa", "mundo", "seleção", "campeonato"]
    topics_lower = [topic.lower() for topic in topics]

    has_portuguese_topic = any(
        any(indicator in topic_lower for indicator in portuguese_indicators) for topic_lower in topics_lower
    )

    assert has_portuguese_topic, (
        f"Expected at least one topic in Portuguese (containing words like {portuguese_indicators}), but got: {topics}"
    )

    logger.info(f"Extracted Portuguese topics: {topics}")


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
async def test_topic_extractor_does_not_reuse_cross_language_topic() -> None:
    """English content must not reuse a Portuguese existing topic name."""
    topics = await TopicExtractor().extract(
        _elections_text(),
        existing_topics=["Eleições"],
        content_language="en",
    )

    assert "Eleições" not in topics, f"Must not reuse Portuguese topic for English content, got: {topics}"
    _assert_broad_election_topics(topics)
    logger.info(f"Extracted topics with cross-language existing topic: {topics}")


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
async def test_topic_extractor_extracts_topics_in_french() -> None:
    """Topics from French content should use French labels, not English cognates only."""
    french_text = """
    Les initiatives d'intégrité électorale s'intensifient aux Philippines et en Équateur.
    Nos partenaires travaillent à fournir des informations fiables aux électeurs pendant
    des scrutins cruciaux cette saison. Malgré le retrait des grandes plateformes technologiques
    du soutien au travail sur l'intégrité électorale, notre équipe reste engagée à permettre
    aux communautés du monde entier d'accéder à des informations critiques et fiables sur
    les élections dans leurs pays. Des récits non vérifiés et la désinformation se propagent
    en ligne pendant les campagnes électorales.
    """

    topics = await TopicExtractor().extract(french_text, existing_topics=[], content_language="fr")

    _assert_has_french_topic(topics)


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(4)
async def test_topic_extractor_does_not_reuse_english_topic_for_french_content() -> None:
    """French content must not reuse an English existing topic name."""
    french_text = """
    Les initiatives d'intégrité électorale s'intensifient aux Philippines et en Équateur.
    Nos partenaires travaillent à fournir des informations fiables aux électeurs pendant
    des scrutins cruciaux. La désinformation et les récits non vérifiés se propagent en ligne
    pendant les campagnes électorales dans les deux pays.
    """

    topics = await TopicExtractor().extract(
        french_text,
        existing_topics=["Elections"],
        content_language="fr",
    )

    assert "Elections" not in topics, f"Must not reuse English topic for French content, got: {topics}"
    _assert_has_french_topic(topics)


@pytest.mark.skipif(_SKIP_TOPIC_EXTRACTION, reason="TOPIC_EXTRACTION_ENABLED is off")
@pytest.mark.order(5)
def test_chat_api_extracts_topics_in_french() -> None:
    """French chat questions should return distinctly French topics, not English canonical names."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 92401,
        "message": ("Quelles initiatives d'intégrité électorale ont lieu aux Philippines et en Équateur ?"),
        "history": [],
        "existing_topics": ["Elections"],
        "personalization": {
            "name": "TestBot",
            "tone": "advocate",
            "default_language": "fr",
            "supported_languages": ["en", "ar", "fr", "pt", "es", "hi"],
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    topics = data.get("topics", [])
    assert topics, f"Expected topics on French question response, got: {data}"

    assert "Elections" not in topics, f"Must not reuse English canonical topic for French chat, got: {topics}"
    _assert_has_french_topic(topics)
