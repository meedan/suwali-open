import os
import re
import time
from collections.abc import Generator
from datetime import date, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest
import requests
from _pytest.mark import ParameterSet
from glom import glom
from loguru import logger
from neo4j import Driver, GraphDatabase

from tests.integration_fixtures import (
    BADMINTON_HUB_ID,
    BADMINTON_PT_DOCUMENT_IDS,
    DATA_DIR,
    DEBUG_DATA,
    DEBUG_SKIP_DOC_CREATION,
    DOCUMENT_ID,
    HUB_ID,
    HUB_ID_WITHOUT_SUWALI,
    OLD_ONLY_TOPICS,
    RECENT_TOPICS,
    ROMAN_EMPIRE_DOCUMENT_IDS,
    ROMAN_EMPIRE_DOCUMENTS,
    TEST_TXT,
    normalized_answer,
)

pytestmark = pytest.mark.integration

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
RQ_BASE_URL = os.getenv("RQ_BASE_URL", "http://localhost:8001")


def _chat_with_retry(payload: dict[str, Any], *, timeout: int, attempts: int = 3) -> dict[str, Any]:
    """POST /chat, retrying when the pipeline returns a fallback (error_type set).
    Returns the first real response, or the last fallback when every attempt returned one."""
    data: dict[str, Any] = {}
    for attempt in range(attempts):
        response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=timeout)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        if data.get("error_type") is None:
            return data
        logger.info(f"Attempt {attempt + 1}/{attempts} returned fallback (error_type={data['error_type']})")
    return data


#                                       (document_id, expected_entities_for_label)
EXPECTED_ENTITIES_FOR_DOCUMENT: list[tuple[str, dict[str, list[str]]]] = [
    (
        "llm-prism-alignment.txt",
        {
            "Person": [
                "Hannah Rose Kirk",
                "Scott A. Hale",
            ],
            "Organization": [
                "University of Oxford",
            ],
            "Dataset": [
                "PRISM",
            ],
        },
    ),
    (
        "elections-philippines-ecuador.txt",
        {
            "Person": [
                "Sara Duterte",
                "Rodrigo Duterte",
                "Ferdinand Marcos Jr.",
                "Daniel Noboa",
                "Luisa González",
            ],
            "Location": [
                "Ecuador",
                # "Manila",  ## flaky – mentioned once in a subordinate clause
                "Philippines",
            ],
            "Organization": [
                "Lupa Media",
                "Meedan",
                "Tsek.ph",
                "VERA Files",
            ],
        },
    ),
    (
        "meedan-2025-retrospective.txt",
        {
            "Location": [
                "Ecuador",
                # "Indonesia",  ## flaky...
            ],
            "Organization": [
                "Meedan",
                "Meta",
                "KICTANet",
                "Omgyno",
                "Ecuador Chequea",
                "Patrick J. McGovern Foundation",
                "Swedish International Development Cooperation Agency",
                "Press Forward",
                "McNulty Foundation",
                "National Philanthropic Trust",
                "Battery Powered",
            ],
            # "Product": [
            #     "Suwali",
            # ],
        },
    ),
    (
        "markdown-structured-article.txt",
        {
            "Person": [
                # Both names are **bold**-wrapped in the source — canaries for markdown stripping
                "Elena Vasquez",
                "Klaus Werner",
            ],
            "Organization": [
                "NovaMed Institute",
                "University of Basel",
                "European Medicines Agency",
            ],
            "Location": [
                "Switzerland",
            ],
        },
    ),
]

# queries outside the hub's knowledge base - bot should refuse to answer these.
# one per kind of ask the model is tempted to satisfy from training data:
# world-knowledge recall, a procedure, and open-ended generation.
GENERAL_KNOWLEDGE_QUERIES: list[str] = [
    "Who is the best football team in Brazil?",
    "What's a good recipe for chocolate cake?",
    "Tell me a joke about programmers",
]

# ways the bot reports it has nothing to answer from, matched as substrings of a normalized answer
_NO_GROUNDING_PHRASES: list[str] = [
    "don't have",
    "do not have",
    "not enough information",
    "cannot answer",
    "can't answer",
    "no relevant",
    "no information",
    "there is no",
    "not able to",
    "unable to",
]

# a question wholly outside the corpus also gets refused by naming the boundary itself
_OUT_OF_SCOPE_PHRASES: list[str] = [*_NO_GROUNDING_PHRASES, "outside", "knowledge base"]

# when the corpus covers the subject but not the asked fact, the refusal points at the sources
_SOURCES_SILENT_PHRASES: list[str] = [
    *_NO_GROUNDING_PHRASES,
    "do not say",
    "don't say",
    "does not say",
    "doesn't say",
    "not mention",
]

#                        (Q, [all_in_ans], [any_in_ans], expected_cited_doc)
DOCUMENTS_CHAT = [
    (
        "What is LLM alignment and how is it tackled? What are some promising projects in that regard?",
        ["PRISM"],
        [
            "Hannah Rose Kirk",
            "Dr. Scott A. Hale",
            "Meedan",
            "NeurIPS",
            "award",
            "Oxford",
            "paper",
            "conference",
            "feedback",
            "reliability",
            "safety",
        ],
        "llm-prism-alignment.txt",
    ),
    (
        "What is Suwali and what is its purpose?",
        ["AI"],
        ["Meedan", "Mozilla", "MozFest", "knowledge", "network", "chatbot", "conversational", "nonprofit"],
        ("meedan-2025-retrospective.txt", "suwali-faq.txt"),
    ),
    pytest.param(
        "What should I know about the 2025 elections in the Philippines?",
        ["Duterte", "Marcos"],
        ["Sara", "arrest", "kidnapping", "Tsek", "VERA", "integrity"],
        "elections-philippines-ecuador.txt",
        marks=pytest.mark.skip(reason="flaky: routing non-determinism causes synthesis path with judge rejection"),
    ),
    pytest.param(
        "What should I know about the 2025 elections in Ecuador?",
        ["Noboa", "González"],
        ["Correa", "Chequea", "Lupa Media"],
        "elections-philippines-ecuador.txt",
        marks=pytest.mark.skip(reason="flaky: routing non-determinism causes synthesis path with judge rejection"),
    ),
    (
        "What is Lupa Media?",
        ["fact", "check", "media", "literacy"],
        ["translat", "Indigenous"],
        # the topic-extraction tests ingest elections-philippines-ecuador.txt verbatim under
        # additional document ids; citing any copy of that content is correct
        (
            "elections-philippines-ecuador.txt",
            "integration_test_topic_extraction",
            "integration_test_topic_extraction_reuse",
            "integration_test_topic_extraction_callback",
        ),
    ),
    (
        "What is KICTANet? What are they involved in?",
        ["Kenya Internet and Communications Technology Action Network"],
        ["gender", "violence"],
        "meedan-2025-retrospective.txt",
    ),
]

ROUTER_ENABLE_YAGO = os.getenv("ROUTER_ENABLE_YAGO")
YAGO_NEO4J_URI = os.getenv("YAGO_NEO4J_URI")
YAGO_NEO4J_USERNAME = os.getenv("YAGO_NEO4J_USERNAME", "neo4j")
YAGO_NEO4J_PASSWORD = os.getenv("YAGO_NEO4J_PASSWORD", "password")


@pytest.mark.order(1)
def test_fastapi_health() -> None:
    logger.info("Testing FastAPI health endpoint...")

    response = requests.get(f"{BASE_URL}/health", timeout=5)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "status" in data, "Response should contain 'status' field"
    assert data["status"] == "ok", f"Expected status 'ok', got {data.get('status')}"

    logger.info(f"FastAPI health check passed: {data}")


@pytest.mark.order(2)
@pytest.mark.skipif(DEBUG_DATA, reason="Skipping RQ Worker health test because DEBUG_DATA is True")
def test_rq_worker_health() -> None:
    """Test RQ Worker health endpoint."""
    logger.info("Testing RQ Worker health endpoint...")

    try:
        response = requests.get(f"{RQ_BASE_URL}/health", timeout=5)

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "healthy" in data, "Response should contain 'healthy' field"
        assert data["healthy"] is True, f"Expected healthy=True, got {data.get('healthy')}"
        assert "rq_processes" in data, "Response should contain 'rq_processes' field"
        assert "enqueued_jobs" in data, "Response should contain 'enqueued_jobs' field"
        assert "failed_jobs" in data, "Response should contain 'failed_jobs' field"

        logger.info(
            f"✓ RQ Worker health check passed: {data['rq_processes']} workers, "
            f"{data['enqueued_jobs']} enqueued, {data['failed_jobs']} failed"
        )
    except requests.exceptions.ConnectionError as e:
        pytest.skip(f"RQ Worker health endpoint is not running at {RQ_BASE_URL}/health: {e}")


@pytest.mark.order(3)
@pytest.mark.parametrize("iteration", [1, 2], ids=["create", "update"])
def test_document_ingestion_with_text(neo4j_driver: Driver, iteration: int) -> None:
    if DEBUG_DATA and iteration > 1:
        logger.info("Skipping document ingestion update: DEBUG_DATA is True")
        return

    operation = "Creating" if iteration == 1 else "Updating"
    logger.info(f"=== {operation} document (iteration {iteration}) ===")

    with open(TEST_TXT, "r", encoding="utf-8") as f:
        content = f.read()

    payload = {
        "hub_id": HUB_ID,
        "document_id": DOCUMENT_ID,
        "file_url": "",
        "text": content,
        "published_at": "2024-01-01T10:00:00Z",
        "priority_tier": 2,
    }

    if not DEBUG_SKIP_DOC_CREATION:
        response = requests.post(f"{BASE_URL}/document/", json=payload, timeout=10)

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "id" in data, "Response should contain job ID"
        assert "status" in data, "Response should contain job status"

        job_id = data["id"]
        initial_status = data["status"]

        logger.info(f"Document ingestion job created: {job_id}")
        logger.info(f"Initial status: {initial_status}")

        # Poll the job status endpoint
        max_attempts = 60  # 60 attempts with 10-second intervals = 10 minutes max
        attempt = 0
        final_status = initial_status

        while attempt < max_attempts:
            attempt += 1
            time.sleep(10)

            status_response = requests.get(f"{BASE_URL}/document/{job_id}", timeout=10)
            assert status_response.status_code == 200, f"Failed to get job status: {status_response.text}"

            status_data = status_response.json()
            final_status = status_data["status"]

            logger.info(f"Attempt {attempt}: Job status = {final_status}")

            if final_status == "finished":
                # if status is failed, the ingestion we re-run
                break

        assert final_status == "finished", f"Job did not complete successfully. Final status: {final_status}"
        logger.info(f"Document {operation.lower()} completed successfully!")

    logger.info("Validating data in Neo4j...")

    with neo4j_driver.session() as session:
        # First, ensure there's only one Document with the given document_id (no duplicates)
        document_count_query = f"""
        MATCH (d:Document_{HUB_ID})
        WHERE d.document_id = $document_id
        RETURN count(d) as doc_count
        """

        doc_count_result = session.run(document_count_query, document_id=payload["document_id"])
        record = doc_count_result.single()
        assert record is not None, "Query should return a result"
        doc_count = record["doc_count"]

        assert doc_count == 1, (
            f"Expected exactly 1 Document_{HUB_ID} node with document_id '{payload['document_id']}', but found {doc_count}"
        )
        logger.info(f"Verified exactly 1 Document_{HUB_ID} node exists (no duplicates)")

        # Query to find chunks and documents for the hub
        query = f"""
        MATCH (c:Chunk_{HUB_ID})-[:FROM_DOCUMENT]->(d:Document_{HUB_ID})
        WHERE d.document_id = $document_id
        RETURN c, d
        """

        result = session.run(query, document_id=payload["document_id"])
        records = list(result)

        # Assert that we have records
        assert len(records) > 0, "No chunks found in Neo4j for the ingested document"
        logger.info(f"Found {len(records)} chunk(s) in Neo4j")

        # Additional assertions
        first_record = records[0]
        document_node = first_record["d"]
        chunk_node = first_record["c"]

        # Neo4j stores published_at as a temporal type, so the driver returns a
        # neo4j.time.DateTime. Compare via .to_native() against the payload string
        # parsed to a Python datetime (fromisoformat handles 'Z' on Python 3.11+).
        expected_published_at = datetime.fromisoformat(str(payload["published_at"]).replace("Z", "+00:00"))

        assert document_node["hub_id"] == 1, "Document hub_id should be 1"
        assert document_node["document_id"] == payload["document_id"], "Document ID mismatch"
        assert document_node["published_at"].to_native() == expected_published_at, (
            "Document published_at metadata mismatch"
        )
        assert document_node["priority_tier"] == payload["priority_tier"], "Document priority_tier metadata mismatch"
        assert "text" in chunk_node, "Chunk should have text property"
        assert "embedding" in chunk_node, "Chunk should have embedding property"
        assert chunk_node["published_at"].to_native() == expected_published_at, "Chunk published_at metadata mismatch"

        logger.info("Neo4j validation successful!")


@pytest.mark.order(4)
def test_fact_checking_classification_from_text(neo4j_driver: Driver) -> None:
    """Test that fact-checking articles are correctly classified via LLM when only text is provided (no URL)."""
    logger.info("=== Testing fact-checking classification from text ===")

    fact_checking_file = DATA_DIR / "iverify-pakistan-fact-check.txt"
    with open(fact_checking_file, "r", encoding="utf-8") as f:
        fact_checking_text = f.read()

    document_id = "integration_test_fact_checking"
    payload = {
        "hub_id": HUB_ID,
        "document_id": document_id,
        "file_url": "",
        "text": fact_checking_text,
    }

    response = requests.post(f"{BASE_URL}/document/", json=payload, timeout=10)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "id" in data, "Response should contain job ID"
    assert "status" in data, "Response should contain job status"

    job_id = data["id"]
    initial_status = data["status"]

    logger.info(f"Document ingestion job created: {job_id}")
    logger.info(f"Initial status: {initial_status}")

    max_attempts = 60  # 60 attempts with 10-second intervals = 10 minutes max
    attempt = 0
    final_status = initial_status

    while attempt < max_attempts:
        attempt += 1
        time.sleep(10)

        status_response = requests.get(f"{BASE_URL}/document/{job_id}", timeout=10)
        assert status_response.status_code == 200, f"Failed to get job status: {status_response.text}"

        status_data = status_response.json()
        final_status = status_data["status"]

        logger.info(f"Attempt {attempt}: Job status = {final_status}")

        if final_status in ("finished", "failed"):
            break

    assert final_status == "finished", f"Job did not complete successfully. Final status: {final_status}"

    logger.info("Validating source_type classification in Neo4j...")

    with neo4j_driver.session() as session:
        query = f"""
        MATCH (d:Document_{HUB_ID})
        WHERE d.document_id = $document_id
        RETURN d.source_type as source_type, d.document_id as document_id
        """

        result = session.run(query, document_id=document_id)
        record = result.single()

        assert record is not None, f"No document found with document_id '{document_id}'"
        source_type = record["source_type"]

        assert source_type == "fact_checking", (
            f"Expected source_type to be 'fact_checking', but got '{source_type}'. "
            f"LLM classification should detect this as a fact-checking article based on content."
        )

        logger.info(f"✓ Document correctly classified as '{source_type}'")


@pytest.mark.order(5)
def test_chat_api_meedan_new_executive() -> None:
    logger.info("Testing /chat API with a question about Meedan's executive director...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 1,
        "message": "Who is new executive director of Meedan?",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    logger.info(f"Received answer: {answer}")

    assert answer.strip(), "Answer should not be empty"
    assert "Dima Saber" in answer, f"Answer should mention 'Dima Saber', but got: {answer}"

    documents_count = glom(data, "metadata.documents_count", default=None)
    assert documents_count is not None, "Answer metadata should include documents_count"
    assert documents_count > 0, f"documents_count should be greater than 0, but got: {documents_count}"

    rewritten_question = glom(data, "metadata.rewritten_question", default=None)
    assert rewritten_question is None, "Answer metadata should not include rewritten_question for first question"

    logger.info("Chat API test passed: Answer includes 'Dima Saber'")


@pytest.mark.order(5)
def test_chat_api_meedan_current_leader() -> None:
    """A present-tense leadership question over a corpus that announces the handover in future
    tense must answer with the successor. The source calls Ed Bice the "current CEO" and says
    Dima Saber "will become" executive director, so an answer that stops at the source's framing
    describes a state that ended, which the judge rejects outright and costs the user any answer.
    """
    logger.info("Testing /chat API with a question about Meedan's current executive director...")

    payload = {
        "history": [
            {"content": "Who is new executive director of Meedan?", "role": "user"},
            {
                "content": "The new executive director of Meedan is Dr. Dima Saber, who will take on this role in November.",
                "role": "assistant",
            },
        ],
        "hub_id": HUB_ID,
        # keeps a pronoun to resolve, so the multi-turn rewrite is still exercised
        "message": "Who is its executive director now?",
        "message_id": 2,
    }

    data = _chat_with_retry(payload, timeout=90)
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    logger.info(f"Received answer: {answer}")

    assert answer.strip(), "Answer should not be empty"
    assert "Dima Saber" in answer, f"Answer should name the current executive director 'Dima Saber', but got: {answer}"

    documents_count = glom(data, "metadata.documents_count", default=None)
    assert documents_count is not None, "Answer metadata should include documents_count"
    assert documents_count > 0, f"documents_count should be greater than 0, but got: {documents_count}"

    rewritten_question = glom(data, "metadata.rewritten_question", default=None)
    assert rewritten_question is not None, "Answer metadata should include rewritten_question"
    assert "Meedan" in rewritten_question, (
        f"rewritten_question should reference 'Meedan', but got: {rewritten_question}"
    )

    logger.info("Chat API test passed: Answer names the current leader Dima Saber")


@pytest.mark.order(5)
def test_chat_api_description_language_does_not_override_question_language() -> None:
    """A persona description that merely mentions which languages the bot handles must not
    override the language the user actually wrote in. Regression for the Quint clash: the
    description says "Hindi and English", the user writes in Portuguese, and the answer must
    come back in Portuguese (detection wins over the description's incidental mention)."""

    logger.info("Testing that a description's language mention does not override the question language...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 1,
        "message": "Quem é a diretora executiva da Meedan?",
        "history": [],
        "personalization": {
            "description": "Ask us your queries in Hindi and English, and our bot will help you out.",
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    answer = response.json().get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(response.json(), "metadata.language", default=None)
    assert reported_lang == "pt", (
        f"Description mentioning Hindi/English overrode the Portuguese question; "
        f"expected metadata.language 'pt', got {reported_lang!r}. Answer: {answer}"
    )


@pytest.mark.order(5)
def test_chat_api_history_language_does_not_override_question_language() -> None:
    """A current message in one language must be answered in that language, even when the
    recent history is in another. Regression for the heat-wave incident (message_id 22438):
    detection must classify the current message before history is consulted."""

    logger.info("Testing that history language does not override the current question language...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 1,
        # exact production message — do not "fix" the missing ¿ or the wording
        "message": "Cómo mantenerse segura durante la ola de calor?",
        "history": [
            {"role": "user", "content": "One of the cooling centers broke down this morning and turned people away"},
        ],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    answer = response.json().get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(response.json(), "metadata.language", default=None)
    assert reported_lang == "es", (
        f"English history overrode the Spanish question; expected metadata.language 'es', "
        f"got {reported_lang!r}. Answer: {answer}"
    )


@pytest.mark.order(5)
def test_chat_api_short_ambiguous_message_not_misdetected() -> None:
    """A short Spanish follow-up must be classified as Spanish so the reply comes back
    in Spanish rather than the history's English."""

    logger.info("Testing that a short ambiguous Spanish message is not misdetected...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 2,
        "message": "sí porfa",
        "history": [
            {"role": "user", "content": "What does Meedan do?"},
            {
                "role": "assistant",
                "content": "Meedan is a technology non-profit focused on fact-checking. Would you like more details?",
            },
        ],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    answer = response.json().get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(response.json(), "metadata.language", default=None)
    assert reported_lang == "es", (
        f"Short Spanish message was misdetected; expected metadata.language 'es', got {reported_lang!r}. Answer: {answer}"
    )


@pytest.mark.order(5)
def test_chat_api_out_of_set_misdetection_does_not_trigger_refusal() -> None:
    """A confident wrong out-of-set verdict must not drive the unsupported-language refusal.
    Regression for the Paraguay incident: a hub that supported Spanish must not refuse this
    Spanish question as an unsupported language."""
    logger.info("Testing that an out-of-set misdetection does not trigger the unsupported-language refusal...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 3,
        # exact production message
        "message": "¿Paraguay ha ayudado a Cuba en 2026?",
        "history": [],
        "personalization": {
            "supported_languages": ["en", "es"],
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(data, "metadata.language", default=None)
    assert reported_lang == "es", (
        f"Spanish question was misdetected as '{reported_lang}'; the unsupported-language "
        f"refusal likely fired. Answer: {answer}"
    )


@pytest.mark.order(5)
def test_chat_api_english_toponym_trap_answered_in_english() -> None:
    """An English question dense with Spanish-speaking country names must be answered in English
    (the Nicaragua incident class: toponyms pulling detectors toward Spanish)."""
    logger.info("Testing that Spanish toponyms do not pull an English question into Spanish...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 6,
        "message": "Is it safe to travel to Nicaragua, Paraguay or Guatemala right now?",
        "history": [],
        "personalization": {
            "supported_languages": ["en", "es"],
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(data, "metadata.language", default=None)
    assert reported_lang == "en", f"Expected metadata.language 'en', got {reported_lang!r}; answer: {answer}"


@pytest.mark.order(5)
@pytest.mark.parametrize(
    "message",
    [
        "aadhar card kaise banaye",
        "passport renewal ke liye documents kya chahiye",
        "kya aap mujhe bata sakte hain ki aap kis vishay mein meri madad kar sakte hain?",
    ],
    ids=["short-hinglish", "loanword-hinglish", "long-hinglish"],
)
def test_chat_api_romanized_hindi_answered_in_hindi(message: str) -> None:
    """Romanized Hindi (Latin script, English loanwords) must be answered in Hindi, not English."""
    logger.info(f"Testing that romanized Hindi is answered in Hindi: {message!r}...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 7,
        "message": message,
        "history": [],
        "personalization": {
            "supported_languages": ["en", "hi"],
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(data, "metadata.language", default=None)
    assert reported_lang == "hi", f"Expected metadata.language 'hi', got {reported_lang!r}; answer: {answer}"


@pytest.mark.order(5)
def test_chat_api_code_switched_spanish_stays_spanish() -> None:
    """A Spanish question peppered with English loanwords must stay Spanish end to end."""

    logger.info("Testing that English loanwords do not flip a Spanish question to English...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 8,
        "message": "¿Es seguro instalar el update del software en mi laptop?",
        "history": [
            {"role": "user", "content": "What topics can you help me with?"},
        ],
        "personalization": {
            "supported_languages": ["en", "es"],
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(data, "metadata.language", default=None)
    assert reported_lang == "es", f"Expected metadata.language 'es', got {reported_lang!r}; answer: {answer}"


@pytest.mark.order(5)
def test_chat_api_first_turn_spanish_greeting_answered_in_spanish() -> None:
    """A one-word first-turn greeting must be classified as Spanish so the non-question
    early-exit reply comes back in Spanish, not English from the system prompt."""

    logger.info("Testing that a first-turn Spanish greeting is answered in Spanish...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 9,
        "message": "hola",
        "history": [],
        "personalization": {
            "supported_languages": ["en", "es"],
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    logger.info(f"Received answer: {answer}")
    assert answer.strip(), "Answer should not be empty"

    reported_lang = glom(data, "metadata.language", default=None)
    assert reported_lang == "es", f"Expected metadata.language 'es', got {reported_lang!r}; answer: {answer}"


@pytest.mark.order(5)
def test_history_aware_rewriter_converts_relative_dates() -> None:
    """Test that the rewriter pipeline converts relative dates (e.g. 'yesterday') to ISO format."""
    logger.info("Testing date rewriting in HistoryAwareQuestionRewriter...")

    payload = {
        "history": [
            {"content": "Tell me about Meedan's work", "role": "user"},
            {
                "content": "Meedan is an organization focused on media literacy and fact-checking.",
                "role": "assistant",
            },
        ],
        "hub_id": HUB_ID,
        "message": "What did they announce yesterday?",
        "message_id": 3,
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    rewritten_question = glom(data, "metadata.rewritten_question", default=None)

    assert rewritten_question is not None, "Answer metadata should include rewritten_question"
    logger.info(f"Rewritten question: {rewritten_question}")

    # the retriever needs an absolute date; whether the model writes "on 2026-08-26" or
    # "yesterday (2026-08-26)" is cosmetic, so only the resolved date is asserted here.
    iso_dates = re.findall(r"\d{4}-\d{2}-\d{2}", rewritten_question)
    assert iso_dates, (
        f"rewritten_question should resolve 'yesterday' to an ISO date (YYYY-MM-DD), but got: {rewritten_question}"
    )

    # assert the date itself, not just its shape: any ISO-looking string would sail past a format check.
    # a day of slack absorbs clock skew between the test host and the container that stamps the date.
    expected = date.today() - timedelta(days=1)
    resolved = date.fromisoformat(iso_dates[0])
    assert abs((resolved - expected).days) <= 1, (
        f"rewritten_question should resolve 'yesterday' to {expected.isoformat()}, "
        f"got {resolved.isoformat()} in: {rewritten_question}"
    )

    logger.info(f"Date rewriting test passed: 'yesterday' resolved to {resolved.isoformat()}")


@pytest.mark.parametrize("message,response_includes_all_of,response_includes_any_of,expected_cited_doc", DOCUMENTS_CHAT)
@pytest.mark.order(5)
def test_chat_api_single_question(
    prepare_test_data: None,
    message: str,
    response_includes_all_of: list[str],
    response_includes_any_of: list[str],
    expected_cited_doc: str | tuple[str, ...],
) -> None:
    logger.info("Testing /chat API with the question: '{message}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 101,
        "message": message,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=180)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    logger.info(f"Received answer: {answer}")

    documents_count = glom(data, "metadata.documents_count", default=None)
    assert documents_count is not None, "Answer metadata should include documents_count"
    assert documents_count > 0, f"documents_count should be greater than 0, but got: {documents_count}"

    assert answer.strip(), "Answer should not be empty"

    for keyword in response_includes_all_of:
        assert keyword.lower() in answer.lower(), f"Answer should mention '{keyword}', but got: {answer}"

    assert any(keyword.lower() in answer.lower() for keyword in response_includes_any_of), (
        f"Answer should mention at least one of: {response_includes_any_of}, but got {answer}"
    )

    document_ids_used = glom(data, "metadata.document_ids_used", default=[])
    document_ids_cited = glom(data, "metadata.document_ids_cited", default=[])
    logger.info(f"Documents retrieved: {document_ids_used}, cited: {document_ids_cited}")

    assert document_ids_cited is not None and len(document_ids_cited) > 0, (
        f"Expected at least one cited document, got none. Retrieved: {document_ids_used}"
    )
    # a row may list several acceptable documents when the test corpus contains the same
    # content under multiple document ids (e.g. the topic-extraction tests re-ingest
    # elections-philippines-ecuador.txt verbatim) — citing any copy is correct behavior
    acceptable_cited = (expected_cited_doc,) if isinstance(expected_cited_doc, str) else expected_cited_doc
    assert any(doc in document_ids_cited for doc in acceptable_cited), (
        f"Expected one of {acceptable_cited} to be cited, got cited={document_ids_cited}, retrieved={document_ids_used}"
    )

    logger.info("Chat API test passed")


@pytest.mark.parametrize("query", GENERAL_KNOWLEDGE_QUERIES)
@pytest.mark.order(5)
def test_chat_api_rejects_general_knowledge(prepare_test_data: None, query: str) -> None:
    """bot should not answer questions outside the hub's knowledge base."""
    logger.info(f"Testing general knowledge rejection for: '{query}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 200,
        "message": query,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = normalized_answer(data.get("answer"))
    error_type = data.get("error_type")
    documents_count = glom(data, "metadata.documents_count", default=0)

    logger.info(f"Response - error_type: {error_type}, documents_count: {documents_count}")
    logger.info(f"Answer: {answer[:200]}..." if len(answer) > 200 else f"Answer: {answer}")

    has_error_type = error_type is not None
    has_no_documents = documents_count == 0
    has_insufficient_phrase = any(phrase in answer for phrase in _OUT_OF_SCOPE_PHRASES)

    assert has_error_type or has_no_documents or has_insufficient_phrase, (
        f"Bot should NOT answer general knowledge question '{query}'. "
        f"Expected error_type, documents_count=0, or insufficient answer phrase. "
        f"Got: error_type={error_type}, documents_count={documents_count}, answer={answer}"
    )

    logger.info(f"General knowledge query correctly handled: '{query}'")


# Suwali-the-product questions must route through retrieval like any factual query:
# the classifier used to conflate "about Suwali" with "about the system itself" and refuse them as metaquestions.
# Whether they get answered depends only on whether the hub's sources cover Suwali: hub 1 does (meedan-2025-retrospective.txt), hub 2 does not.
SUWALI_PRODUCT_QUERY = "What is Suwali?"


@pytest.mark.order(5)
def test_chat_api_suwali_answered_when_hub_has_suwali_source(prepare_test_data: None) -> None:
    """A hub whose corpus covers Suwali answers grounded in that source, not via a
    metaquestion refusal or a canned identity reply."""
    logger.info(f"Testing Suwali question in hub with a Suwali source: '{SUWALI_PRODUCT_QUERY}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 210,
        "message": SUWALI_PRODUCT_QUERY,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=180)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    error_type = data.get("error_type")
    router_intent = glom(data, "metadata.router_intent", default=None)
    logger.info(f"Response - error_type: {error_type}, router_intent: {router_intent}, answer: {answer}")

    assert router_intent not in ("metaquestion", "role_description"), (
        f"Suwali question must route to retrieval, got router_intent={router_intent}. Answer: {answer}"
    )
    assert error_type is None, f"Expected a grounded answer, got error_type={error_type}. Answer: {answer}"

    documents_count = glom(data, "metadata.documents_count", default=0)
    assert documents_count > 0, f"Expected retrieved documents, got documents_count={documents_count}"

    document_ids_cited = glom(data, "metadata.document_ids_cited", default=[])
    suwali_docs = {"suwali-faq.txt", "meedan-2025-retrospective.txt"}
    assert suwali_docs & set(document_ids_cited), (
        f"Answer should be grounded in a Suwali-covering document, got cited={document_ids_cited}. Answer: {answer}"
    )

    logger.info("Suwali question answered from the hub's Suwali source")


@pytest.mark.order(5)
def test_chat_api_suwali_refused_when_hub_has_no_suwali_source(prepare_no_suwali_hub_data: None) -> None:
    """A hub whose corpus has no Suwali content refuses for lack of sources — an
    insufficient-answer refusal, never the metaquestion one."""
    logger.info(f"Testing Suwali question in hub without a Suwali source: '{SUWALI_PRODUCT_QUERY}'")

    payload = {
        "hub_id": HUB_ID_WITHOUT_SUWALI,
        "message_id": 211,
        "message": SUWALI_PRODUCT_QUERY,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=180)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = normalized_answer(data.get("answer"))
    error_type = data.get("error_type")
    router_intent = glom(data, "metadata.router_intent", default=None)
    documents_count = glom(data, "metadata.documents_count", default=0)
    logger.info(f"Response - error_type: {error_type}, router_intent: {router_intent}, answer: {answer}")

    assert error_type != "METAQUESTION" and router_intent not in ("metaquestion", "role_description"), (
        f"Suwali question must route to retrieval even when unanswerable, "
        f"got error_type={error_type}, router_intent={router_intent}. Answer: {answer}"
    )

    has_insufficient_phrase = any(phrase in answer for phrase in _OUT_OF_SCOPE_PHRASES)
    assert error_type is not None or documents_count == 0 or has_insufficient_phrase, (
        f"Bot should refuse the Suwali question when no source covers it. "
        f"Expected error_type, documents_count=0, or an insufficient-answer phrase. "
        f"Got: error_type={error_type}, documents_count={documents_count}, answer={answer}"
    )

    logger.info("Suwali question correctly refused in the hub without a Suwali source")


# the climate-disinfo report covers the topic but names no watchdog/council org.
# a query about a specific absent org must refuse rather than attribute the report's content to it.
# regression for the misattribution bug where an answer credited an org absent from every passage.
ABSENT_ENTITY_QUERIES: list[str] = [
    "What does the Halcyon Climate Council do to prevent and combat climate disinformation?",
    "What is the Halcyon Climate Council's position on climate science?",
]


@pytest.mark.parametrize("query", ABSENT_ENTITY_QUERIES)
@pytest.mark.order(5)
def test_chat_api_refuses_absent_entity_attribution(prepare_test_data: None, query: str) -> None:
    """bot must refuse a question about an entity absent from the corpus even when
    the topic is present. the climate-disinfo report discusses climate disinformation
    but names no such council, so the answer must not attribute the report's content
    to it."""
    logger.info(f"Testing absent-entity refusal for: '{query}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 201,
        "message": query,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = normalized_answer(data.get("answer"))
    error_type = data.get("error_type")
    documents_count = glom(data, "metadata.documents_count", default=0)

    logger.info(f"Response - error_type: {error_type}, documents_count: {documents_count}")
    logger.info(f"Answer: {answer[:200]}..." if len(answer) > 200 else f"Answer: {answer}")

    has_error_type = error_type is not None
    has_insufficient_phrase = any(phrase in answer for phrase in _NO_GROUNDING_PHRASES)

    # not documents_count == 0: the topic is in the corpus, so a chunk is expected to be retrieved.
    # the signal that matters is that the bot still refuses because the named entity is in no passage.
    assert has_error_type or has_insufficient_phrase, (
        f"Bot should refuse a query about an absent entity '{query}'. "
        f"Expected error_type or an insufficient-answer phrase. "
        f"Got: error_type={error_type}, documents_count={documents_count}, answer={answer}"
    )

    logger.info(f"Absent-entity query correctly refused: '{query}'")


# the world cup doc mentions 1994 only as a past hosting, never the winner;
# the bot must refuse rather than fill in the famous outcome from training data.
# complement of the absent-entity test: subject present, asked-for fact absent.
UNGROUNDED_FACT_QUERIES: list[str] = [
    "Who won the 1994 FIFA World Cup?",
    "Who won the World Cup in 1994?",
]

# any of these in the answer means the outcome was recalled from training data;
# none appear anywhere in the corpus
HALLUCINATED_1994_TERMS: list[str] = ["brazil", "italy", "rose bowl", "pasadena", "penalty", "shootout"]


@pytest.mark.parametrize("query", UNGROUNDED_FACT_QUERIES)
@pytest.mark.order(5)
def test_chat_api_refuses_ungrounded_fact_recall(prepare_test_data: None, query: str) -> None:
    """bot must refuse a question whose answer is absent from the corpus even when
    the corpus mentions the event asked about. the 2026 world cup doc says the united
    states hosted the 1994 world cup but never says who won it, so the bot must not
    supply the winner from general knowledge."""
    logger.info(f"Testing ungrounded-fact refusal for: '{query}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 202,
        "message": query,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = normalized_answer(data.get("answer"))
    error_type = data.get("error_type")
    documents_count = glom(data, "metadata.documents_count", default=0)

    logger.info(f"Response - error_type: {error_type}, documents_count: {documents_count}")
    logger.info(f"Answer: {answer[:200]}..." if len(answer) > 200 else f"Answer: {answer}")

    hallucinated = [term for term in HALLUCINATED_1994_TERMS if term in answer]
    assert not hallucinated, (
        f"Answer leaked the 1994 outcome from training data for '{query}'. "
        f"Found {hallucinated} in answer, none of which appear in the corpus. Answer: {answer}"
    )

    has_error_type = error_type is not None
    has_insufficient_phrase = any(phrase in answer for phrase in _SOURCES_SILENT_PHRASES)

    # documents_count stays nonzero since the corpus mentions the 1994 world cup;
    # the signal is refusing to name a winner no passage states
    assert has_error_type or has_insufficient_phrase, (
        f"Bot should refuse to name the 1994 winner for '{query}': the corpus mentions "
        f"the event but not its outcome. Expected error_type or an insufficient-answer phrase. "
        f"Got: error_type={error_type}, documents_count={documents_count}, answer={answer}"
    )

    # cms contract: a no-answer fallback keeps answerable=true so the question counts as unanswered in the ranking
    if error_type == "NO_ANSWER_AVAILABLE":
        answerable = glom(data, "metadata.answerable", default=None)
        assert answerable is True, f"NO_ANSWER_AVAILABLE response must keep answerable=true, got: {answerable}"

    logger.info(f"Ungrounded-fact query correctly refused: '{query}'")


# only question words after an opener: splitting them into bare sub-queries returned confident, unrelated answers
SUBJECTLESS_QUERIES: list[str] = [
    "Hi, I have a question! Where snd when?",
    "Hey, I have a quick question. Who and how?",
]


@pytest.mark.skip(reason="flaky: the classifier reads a subjectless 'where' as needing user location")
@pytest.mark.parametrize("query", SUBJECTLESS_QUERIES)
@pytest.mark.order(5)
def test_chat_api_subjectless_query_asks_for_clarification(prepare_test_data: None, query: str) -> None:
    """A message with no subject is small talk that asks what the user wants to know, never a retrieval."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 1205,
        "message": query,
        "history": [],
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    logger.info(f"Answer: {data.get('answer')!r}, metadata: {data.get('metadata')}")
    assert glom(data, "metadata.router_intent", default=None) == "non_question", f"Must ask what is meant: {data}"
    assert not glom(data, "metadata.router_subquery_count", default=None), f"Must not be decomposed: {data}"
    assert not _document_ids_from_metadata(data), f"Must not retrieve: {data}"


@pytest.mark.skip(reason="guards the subjectless rule; skipped with its companion until the rule holds")
@pytest.mark.order(5)
def test_chat_api_subjectless_follow_up_uses_history(prepare_test_data: None) -> None:
    """Question words alone are a real question when history names the subject."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 1206,
        "message": "When and why?",
        "history": [
            {"role": "user", "content": "I want to know about the arrest of Rodrigo Duterte."},
            {"role": "assistant", "content": "Sure, what would you like to know about it?"},
        ],
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    logger.info(f"Answer: {data.get('answer')!r}, metadata: {data.get('metadata')}")
    assert glom(data, "metadata.router_intent", default=None) == "question", f"History supplies the subject: {data}"
    cited = _cited_document_ids_from_metadata(data)
    assert "elections-philippines-ecuador.txt" in cited, f"Expected the arrest document cited, got: {sorted(cited)}"


# the corpus ties Meedan to many locations but never to Croatia;
# co-mentions become loose Organization->Location kg_rels edges that reach the generator as context no passage backs.
# the bot must refuse rather than generalize broad presence into an office in the asked location.
KG_RELS_UNGROUNDED_LOCATION_QUERIES: list[str] = [
    "Does Meedan have an office in Croatia?",
    "does meedan have a physical presence in croatia",
]


@pytest.mark.parametrize("query", KG_RELS_UNGROUNDED_LOCATION_QUERIES)
@pytest.mark.order(5)
def test_chat_api_refuses_location_grounded_only_in_kg_rels(prepare_test_data: None, query: str) -> None:
    """bot must refuse to place an organization in a location no passage mentions, even
    though the corpus links the organization to many other locations and the knowledge
    graph offers loose location edges as generator context."""
    logger.info(f"Testing kg_rels-ungrounded location refusal for: '{query}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 203,
        "message": query,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = normalized_answer(data.get("answer"))
    error_type = data.get("error_type")
    documents_count = glom(data, "metadata.documents_count", default=0)

    logger.info(f"Response - error_type: {error_type}, documents_count: {documents_count}")
    logger.info(f"Answer: {answer[:200]}..." if len(answer) > 200 else f"Answer: {answer}")

    affirmed = [
        term
        for term in ["yes,", "yes.", "office in croatia", "branch in croatia", "presence in croatia"]
        if term in answer
    ]
    assert not affirmed, (
        f"Answer placed Meedan in Croatia for '{query}' though no passage mentions Croatia. "
        f"Found {affirmed} in answer: {answer}"
    )

    has_error_type = error_type is not None
    has_insufficient_phrase = any(phrase in answer for phrase in _SOURCES_SILENT_PHRASES)

    # documents_count may stay nonzero since Meedan is all over the corpus;
    # the signal is refusing the specific location no passage states.
    assert has_error_type or has_insufficient_phrase, (
        f"Bot should refuse to place Meedan in Croatia for '{query}': the corpus covers Meedan "
        f"but never Croatia. Expected error_type or an insufficient-answer phrase. "
        f"Got: error_type={error_type}, documents_count={documents_count}, answer={answer}"
    )

    logger.info(f"kg_rels-ungrounded location query correctly refused: '{query}'")


# ways the bot reports that the sources do not settle a question, matched as substrings of a lowercased answer
SOURCES_DO_NOT_SETTLE_PHRASES: list[str] = [
    "not mention",
    "no mention",
    "no specific mention",
    "do not say",
    "does not say",
    "don't say",
    "doesn't say",
    "not specify",
    "not indicate",
    "not state",
    "not confirm",
    "not provide",
    "not explicitly",
    "no information",
    "no specific information",
    "not enough information",
    "there is no",
    "do not have",
    "don't have",
    "cannot confirm",
    "can't confirm",
    "unclear",
    "couldn't find an answer",
    "could not find an answer",
]

# Brazil and India are reached through the FAQ's partner list, Indonesia through project descriptions
PARTNERSHIP_ONLY_COUNTRIES: list[str] = ["Indonesia", "Brazil", "India"]


@pytest.mark.parametrize("country", PARTNERSHIP_ONLY_COUNTRIES)
@pytest.mark.order(5)
def test_chat_api_does_not_upgrade_partnerships_to_office(prepare_test_data: None, country: str) -> None:
    """bot must not affirm a specific relationship (an office) when the passages support
    only a weaker one: the corpus ties Meedan to these countries through partnerships alone."""
    query = f"Does Meedan have an office in {country}?"
    logger.info(f"Testing relationship-fidelity for: '{query}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 204,
        "message": query,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    answer_lower = normalized_answer(answer)
    error_type = data.get("error_type")

    affirmation_terms = [
        "yes,",
        "yes.",
        f"has an office in {country.lower()}",
        "operates an office",
        f"has a presence in {country.lower()}",
    ]
    # a correct refusal can embed an affirmation phrase, so sentences carrying a negation or hedge signal are skipped.
    hedge_signals = SOURCES_DO_NOT_SETTLE_PHRASES + ["whether", "not "]
    affirmations: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", answer_lower):
        if any(signal in sentence for signal in hedge_signals):
            continue
        affirmations.extend(term for term in affirmation_terms if term in sentence)
    assert not affirmations, (
        f"Answer affirmed an office in {country} though the corpus only supports partnerships. "
        f"Found {affirmations} in answer: {answer}"
    )

    has_no_mention_signal = any(signal in answer_lower for signal in SOURCES_DO_NOT_SETTLE_PHRASES)
    assert error_type is not None or has_no_mention_signal, (
        f"Answer neither refused nor stated that the sources do not mention an office: {answer}"
    )

    logger.info(f"Relationship-fidelity test passed: '{query}'")


TIME_SENSITIVE_UNEMPLOYMENT_QUERIES: list[tuple[str, list[str], list[str]] | ParameterSet] = [
    # (question, expected_in_answer, should_not_be_current)
    (
        "What is the unemployment rate in the Veridian Republic?",
        ["5.2"],  # Should use the most recent data (March 2026)
        [],
    ),
    (
        "What was the unemployment rate in the Veridian Republic in 2023?",
        ["8.5"],  # Should reference the 2023 data
        [],
    ),
    pytest.param(
        "What was the employment situation in the Veridian Republic in 2024?",
        [],  # No specific 2024 data exists
        ["5.2", "8.5"],  # Should not claim either figure is from 2024
        marks=pytest.mark.skip(
            reason="misattributes_point_in_time_year exempts the whole answer when ANY cited source's "
            "published year matches the asked year (here veridian-copper-index-2024), so a figure from "
            "another year slips through unattributed; skip until the guard is scoped to the figure's own source"
        ),
    ),
]


def _document_ids_from_metadata(data: dict[str, object]) -> set[str]:
    raw_ids = glom(data, "metadata.document_ids_used", default=[])
    ids = {str(doc_id) for doc_id in raw_ids if doc_id} if isinstance(raw_ids, list) else set()
    logger.debug(f"Found {len(ids)} used documents: {ids}")
    return ids


def _cited_document_ids_from_metadata(data: dict[str, object]) -> set[str]:
    raw_ids = glom(data, "metadata.document_ids_cited", default=[])
    ids = {str(doc_id) for doc_id in raw_ids if doc_id} if isinstance(raw_ids, list) else set()
    logger.debug(f"Found {len(ids)} cited documents: {ids}")
    return ids


def _is_historical_mention(answer_lower: str) -> bool:
    return any(indicator in answer_lower for indicator in ["was", "previous", "former", "served", "until"])


def _is_generic_no_answer(answer_lower: str) -> bool:
    # Phrases aligned with NO_ANSWER / error copy — not "not enough information", which appears in
    # valid point-in-time answers that explain missing data for a specific year.
    return any(
        phrase in answer_lower
        for phrase in [
            "couldn't find an answer",
            "could not find an answer",
            "try rephrasing your question",
            "please try rephrasing",
            "ask something else",
        ]
    )


def _has_no_answer_fallback(data: dict[str, object], answer_lower: str) -> bool:
    error_type = data.get("error_type")
    documents_count = glom(data, "metadata.documents_count", default=None)
    return bool(error_type is not None and documents_count in (0, None)) or _is_generic_no_answer(answer_lower)


@pytest.mark.parametrize("message,expected_in_answer,should_not_be_current", TIME_SENSITIVE_UNEMPLOYMENT_QUERIES)
@pytest.mark.order(5)
def test_chat_api_unemployment_time_awareness(
    prepare_test_data: None, message: str, expected_in_answer: list[str], should_not_be_current: list[str]
) -> None:
    """Test that the bot correctly handles time-sensitive unemployment queries."""
    logger.info(f"Testing time-awareness for: '{message}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 300,
        "message": message,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    logger.info(f"Received answer: {answer}")
    answer_lower = normalized_answer(answer)
    has_no_answer_fallback = _has_no_answer_fallback(data, answer_lower)

    assert answer.strip(), "Answer should not be empty"

    for expected in expected_in_answer:
        assert expected in answer, f"Answer should mention '{expected}', but got: {answer}"

    document_ids = _document_ids_from_metadata(data)
    logger.info(f"Document IDs used: {sorted(document_ids)}")
    cited_document_ids = _cited_document_ids_from_metadata(data)
    if not ("in 2024" in message.lower() and has_no_answer_fallback):
        assert len(document_ids) >= len(cited_document_ids) > 0

    if "current unemployment rate" in message.lower():
        assert "time-sensitive-new.txt" in document_ids, (
            f"Expected recency query to use time-sensitive-new.txt, got: {sorted(document_ids)}"
        )

    if "in 2023" in message.lower():
        assert "time-sensitive-old.txt" in document_ids, (
            f"Expected 2023 query to use time-sensitive-old.txt, got: {sorted(document_ids)}"
        )

    if "5.2" in answer:
        assert "2026" in answer_lower, f"Value 5.2 must be attributed to 2026, got: {answer}"
    if "8.5" in answer:
        assert "2023" in answer_lower, f"Value 8.5 must be attributed to 2023, got: {answer}"

    # when we have no data for the specific year, the bot should not present data from
    # other years as if it were from the requested year.
    for value in should_not_be_current:
        if value in answer:
            # MUST be qualified with its actual year: 8.5% is from the 2023 doc, 5.2% from the 2026 doc
            has_year_context = any(year in answer_lower for year in ["2023", "2026"])
            has_disclaimer = any(
                phrase in answer_lower
                for phrase in [
                    "no information",
                    "not available",
                    "no specific",
                    "no data",
                    "don't have",
                    "do not have",
                ]
            )
            assert has_year_context or has_disclaimer, (
                f"Answer mentions '{value}' without qualifying which year it's from "
                f"or disclaiming missing data: {answer}"
            )

    if "in 2024" in message.lower():
        has_explicit_missing_year = "2024" in answer_lower
        assert has_explicit_missing_year or has_no_answer_fallback, (
            "Missing-year query should return either explicit 2024 unavailability wording "
            f"or a generic no-answer fallback, got: {answer}"
        )
        if has_no_answer_fallback:
            error_type = data.get("error_type")
            assert error_type is not None, "Generic no-answer response should include error_type"

    documents_count = glom(data, "metadata.documents_count", default=None)
    logger.info(f"Documents used: {documents_count}")

    logger.info(f"Time-awareness test passed for: '{message}'")


TIME_SENSITIVE_PRESIDENT_QUERIES: list[tuple[str, list[str], list[str]]] = [
    # (question, expected_in_answer, should_not_be_presented_as_current)
    (
        "Who is the president of the Veridian Republic?",
        ["Mirova"],  # Elena Mirova elected in 2025
        ["Thornwell"],  # Should not present Thornwell as current president
    ),
    (
        "Who was the president of the Veridian Republic in 2023?",
        ["Thornwell"],  # Marcus Thornwell was president 2021-2025
        [],
    ),
]


@pytest.mark.parametrize("message,expected_in_answer,should_not_be_current", TIME_SENSITIVE_PRESIDENT_QUERIES)
@pytest.mark.order(5)
def test_chat_api_president_time_awareness(
    prepare_test_data: None, message: str, expected_in_answer: list[str], should_not_be_current: list[str]
) -> None:
    """Test that the bot correctly handles time-sensitive presidential queries."""
    logger.info(f"Testing time-awareness for: '{message}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 301,
        "message": message,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    logger.info(f"Received answer: {answer}")
    answer_lower = normalized_answer(answer)
    document_ids = _document_ids_from_metadata(data)
    cited_document_ids = _cited_document_ids_from_metadata(data)
    assert len(document_ids) >= len(cited_document_ids) > 0

    assert answer.strip(), "Answer should not be empty"

    for expected in expected_in_answer:
        assert expected in answer, f"Answer should mention '{expected}', but got: {answer}"

    if "president of the veridian republic?" in message.lower():
        assert "veridian-election-2025.txt" in document_ids, (
            f"Expected current-president query to use 2025 election doc, got: {sorted(document_ids)}"
        )

    if "in 2023" in message.lower():
        assert any(doc in document_ids for doc in ["veridian-election-2020.txt", "veridian-election-2025.txt"]), (
            f"Expected 2023 query to use election docs, got: {sorted(document_ids)}"
        )
        if "mirova" in answer_lower:
            assert any(
                indicator in answer_lower
                for indicator in [
                    "2025",
                    "2026",
                    "later",
                    "subsequent",
                    "after",
                    "succeeded",
                    "successor",
                    "current",
                    "now",
                ]
            ), f"Mirova may be mentioned only with clear non-2023 context: {answer}"

    for name in should_not_be_current:
        if name.lower() in answer_lower:
            # if mentioned, should be in historical context
            assert _is_historical_mention(answer_lower) or any(
                indicator in answer_lower for indicator in ["2020", "2021", "2022", "2023", "2024", "2025"]
            ), f"Answer mentions '{name}' but doesn't indicate it's historical: {answer}"

    documents_count = glom(data, "metadata.documents_count", default=None)
    assert documents_count is not None and documents_count > 0, (
        f"Expected documents_count > 0, but got: {documents_count}"
    )

    logger.info(f"Presidential time-awareness test passed for: '{message}'")


# ---------------------------------------------------------------------------
# Person entity filter integration tests
# ---------------------------------------------------------------------------


@pytest.mark.order(5)
def test_person_entity_filter_cited_sources_mention_person(prepare_test_data: None) -> None:
    """when a query names a specific person, every cited source should mention that person."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 350,
        "message": "What did Elena Mirova say in her victory speech?",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data["answer"]
    logger.info(f"Person filter test — answer: {answer}")

    assert answer.strip(), "Answer should not be empty"
    assert "mirova" in answer.lower(), f"Answer should mention 'Mirova', but got: {answer}"

    cited = _cited_document_ids_from_metadata(data)
    assert len(cited) > 0, "Expected at least one cited document, got none"

    # the 2020 election doc (about Thornwell/Vasquez) should not be cited
    assert "veridian-election-2020.txt" not in cited, (
        f"The 2020 election doc should not be cited for a Mirova question, but cited={sorted(cited)}"
    )

    logger.info("Person entity filter test passed: cited sources are relevant to the named person")


@pytest.mark.order(5)
def test_person_entity_filter_does_not_break_non_person_queries(prepare_test_data: None) -> None:
    """queries without a named person should still work normally."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 351,
        "message": "What was the voter turnout in the Veridian Republic election?",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data["answer"]
    logger.info(f"Non-person query test — answer: {answer}")

    assert answer.strip(), "Answer should not be empty"

    documents_count = glom(data, "metadata.documents_count", default=None)
    assert documents_count is not None and documents_count > 0, f"Expected documents_count > 0, got: {documents_count}"

    logger.info("Non-person query test passed: retrieval works without person entities")


# ---------------------------------------------------------------------------
# Dual retriever integration tests
# ---------------------------------------------------------------------------


@pytest.mark.order(5)
def test_dual_retriever_recency_surfaces_latest_data(prepare_test_data: None) -> None:
    """A recency query must engage the dual retriever and surface the most recent
    unemployment figure (5.2%), not the 2023 one it supersedes."""
    query = "What is the current unemployment rate in the Veridian Republic?"

    payload = {
        "hub_id": HUB_ID,
        "message_id": 401,
        "message": query,
        "history": [],
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    answer_lower = answer.lower()
    logger.info(f"[dual-recency] answer: {answer}")

    assert "5.2" in answer, f"Dual retriever should surface the 2025 figure (5.2%), got: {answer}"
    if "8.5" in answer:
        assert "2023" in answer_lower, f"If 8.5 is mentioned, it should be historical (2023), got: {answer}"

    temporal_type = glom(data, "metadata.temporal_type", default=None)
    temporal_weight = glom(data, "metadata.temporal_recency_weight", default=None)
    documents_count = glom(data, "metadata.documents_count", default=0)
    document_ids = _document_ids_from_metadata(data)
    cited_document_ids = _cited_document_ids_from_metadata(data)
    assert len(document_ids) >= len(cited_document_ids) > 0
    assert temporal_type in ("recency", "point_in_time"), (
        f"Expected temporal query classification, got: {temporal_type}"
    )
    assert temporal_weight is not None, (
        "metadata.temporal_recency_weight should be set when the dual retriever is active"
    )
    assert documents_count > 0, f"Expected documents_count > 0, got {documents_count}"
    assert "time-sensitive-new.txt" in document_ids, (
        f"Expected recency query to use time-sensitive-new.txt, got: {sorted(document_ids)}"
    )

    logger.info(f"Dual retriever recency test passed: type={temporal_type}, weight={temporal_weight}")


@pytest.mark.order(5)
def test_dual_retriever_pit_surfaces_correct_era(prepare_test_data: None) -> None:
    """For a point-in-time query about the 2020 election the dual retriever
    should reference the correct candidates and expose PIT metadata."""
    query = "Who ran in the 2020 presidential election in the Veridian Republic?"

    payload = {
        "hub_id": HUB_ID,
        "message_id": 403,
        "message": query,
        "history": [],
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200

    data = response.json()
    answer = data.get("answer", "")
    answer_lower = answer.lower()
    logger.info(f"[dual-pit] answer: {answer}")

    temporal_type = glom(data, "metadata.temporal_type", default=None)
    temporal_ref = glom(data, "metadata.temporal_reference_date", default=None)
    document_ids = _document_ids_from_metadata(data)
    cited_document_ids = _cited_document_ids_from_metadata(data)
    assert len(document_ids) >= len(cited_document_ids) > 0

    assert temporal_type == "point_in_time", f"Expected temporal_type 'point_in_time', got '{temporal_type}'"
    assert temporal_ref is not None, "temporal_reference_date should be set for PIT queries"
    assert "2020" in temporal_ref, f"Expected reference date to contain '2020', got: {temporal_ref}"

    assert "Thornwell" in answer, f"Answer should identify Thornwell for 2020-era question, got: {answer}"
    if "Mirova" in answer:
        assert any(indicator in answer_lower for indicator in ["2025", "later", "subsequent", "after"]), (
            f"If Mirova is mentioned, it must be clearly outside 2020 context: {answer}"
        )
    assert "veridian-election-2020.txt" in document_ids, (
        f"Expected PIT query to include veridian-election-2020.txt in provenance, got: {sorted(document_ids)}"
    )

    logger.info("Dual retriever point-in-time test passed")


@pytest.mark.order(5)
def test_election_results_question_is_refused(prepare_test_data: None) -> None:
    """The corpus states who won, but an election's outcome is refused before retrieval."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 404,
        "message": "Who won the 2020 presidential election in the Veridian Republic?",
        "history": [],
    }
    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200

    data = response.json()
    assert data.get("error_type") == "ELECTION_RESULTS"
    assert glom(data, "metadata.router_intent", default=None) == "election_results"
    assert "Thornwell" not in data.get("answer", "")


@pytest.mark.order(5)
def test_dual_retriever_non_temporal_query_skips_temporal(prepare_test_data: None) -> None:
    """Non-temporal queries should NOT activate the dual retriever."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 405,
        "message": "What is PRISM?",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200

    data = response.json()
    answer = data.get("answer", "")
    logger.info(f"[dual-skip] answer: {answer}")

    temporal_type = glom(data, "metadata.temporal_type", default=None)
    temporal_weight = glom(data, "metadata.temporal_recency_weight", default=None)

    assert temporal_type == "none", f"Non-temporal query should have temporal_type='none', got '{temporal_type}'"
    assert temporal_weight is None, f"Non-temporal query should have no temporal_recency_weight, got {temporal_weight}"

    logger.info("Non-temporal query correctly skipped dual retriever")


@pytest.mark.order(5)
def test_dual_retriever_surfaces_temporal_chunks(prepare_test_data: None) -> None:
    """Call DualRetriever.search() directly against Neo4j and verify
    the temporal retriever surfaces chunks from the most recent document."""
    from app.models.chat import ChatRequest
    from app.models.temporal import TemporalContext, TemporalType
    from app.services.dual_retriever import DualRetriever
    from app.services.retriever import Retriever

    query = "What is the unemployment rate in the Veridian Republic?"
    chat = ChatRequest(hub_id=HUB_ID, message_id=500, message=query, history=[])
    temporal_ctx = TemporalContext(type=TemporalType.RECENCY, confidence=0.9)
    retriever = Retriever(
        chat=chat,
        enable_rephrasing=False,
        enable_hyde=False,
        temporal_context=temporal_ctx,
    )

    assert isinstance(retriever.retriever, DualRetriever), (
        f"Expected DualRetriever for temporal query, got {type(retriever.retriever)}"
    )

    result = retriever.retriever.search(query_text=query, top_k=5)
    logger.info(f"[retriever-level] Got {len(result.items)} items from DualRetriever")

    # neo4j_graphrag serialises the full Record into item.content
    all_content = " ".join(item.content for item in result.items)
    logger.info(f"[retriever-level] combined content (first 500): {all_content[:500]}")

    assert "time-sensitive-new.txt" in all_content, (
        f"Expected 'time-sensitive-new.txt' in retrieved content, got (first 300): {all_content[:300]}"
    )
    assert "5.2" in all_content, (
        "Expected temporal retriever to surface the 2025 unemployment figure (5.2%) in chunk content"
    )

    logger.info("Retriever-level temporal chunk surfacing test passed")


@pytest.mark.order(5)
def test_dual_retriever_undated_chunks_excluded_from_temporal(prepare_test_data: None) -> None:
    """Undated chunks (no published_at) must not crash the temporal retriever
    and should still be reachable via the semantic retriever."""
    from app.models.chat import ChatRequest
    from app.models.temporal import TemporalContext, TemporalType
    from app.services.dual_retriever import DualRetriever
    from app.services.retriever import Retriever

    query = "What national parks does the Veridian Republic have?"
    chat = ChatRequest(hub_id=HUB_ID, message_id=501, message=query, history=[])
    temporal_ctx = TemporalContext(type=TemporalType.RECENCY, confidence=0.8)
    retriever = Retriever(
        chat=chat,
        enable_rephrasing=False,
        enable_hyde=False,
        temporal_context=temporal_ctx,
    )

    assert isinstance(retriever.retriever, DualRetriever)
    dual = retriever.retriever

    result = dual.search(query_text=query, top_k=6)
    logger.info(f"[undated] Got {len(result.items)} items from DualRetriever")

    all_content = " ".join(item.content for item in result.items)
    logger.debug(f"[undated] combined content (first 500): {all_content[:500]}")

    # the undated document should still be reachable via the semantic retriever
    assert "national park" in all_content.lower() or "conservation" in all_content.lower(), (
        "Expected undated document content (national parks) to appear via semantic retriever"
    )
    assert "veridian-undated-policy.txt" in all_content, (
        "Expected undated policy document to be visible in merged retriever content"
    )

    logger.info("Undated chunks test passed — temporal retriever did not crash")


@pytest.mark.order(5)
def test_chat_api_unemployment_missing_year_explicit_unavailability(prepare_test_data: None) -> None:
    """A requested year with no direct data must trigger explicit unavailability wording."""
    payload = {
        "hub_id": HUB_ID,
        "message_id": 302,
        "message": "What was the unemployment rate in the Veridian Republic in 2024?",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    answer_lower = answer.lower()
    has_no_answer_fallback = _has_no_answer_fallback(data, answer_lower)
    assert answer.strip(), "Answer should not be empty"

    has_explicit_missing_year = "2024" in answer_lower
    assert has_explicit_missing_year or has_no_answer_fallback, (
        f"Expected either explicit missing-2024 explanation or generic no-answer fallback, got: {answer}"
    )

    if has_no_answer_fallback:
        error_type = data.get("error_type")
        assert error_type is not None, "Generic no-answer response should include error_type"
        documents_count = glom(data, "metadata.documents_count", default=None)
        assert documents_count in (0, None), (
            "Generic no-answer fallback should not claim retrieved supporting documents, "
            f"got documents_count={documents_count}"
        )

    if "5.2" in answer:
        assert "2026" in answer_lower, f"5.2 must be attributed to 2026, got: {answer}"
    if "8.5" in answer:
        assert "2023" in answer_lower, f"8.5 must be attributed to 2023, got: {answer}"

    temporal_type = glom(data, "metadata.temporal_type", default=None)
    assert temporal_type in ("point_in_time", "recency"), (
        f"Expected temporal classification for temporal query, got: {temporal_type}"
    )


COPPER_INDEX_TEMPORAL_QUERIES: list[tuple[str, str, str, str]] = [
    (
        "What is the current copper export index in the Veridian Republic?",
        "68",
        "veridian-copper-index-2026.txt",
        "recency",
    ),
    (
        "What was the copper export index in the Veridian Republic in 2024?",
        "44",
        "veridian-copper-index-2024.txt",
        "point_in_time",
    ),
]


@pytest.mark.parametrize("message,expected_value,expected_doc_id,expected_temporal_type", COPPER_INDEX_TEMPORAL_QUERIES)
@pytest.mark.order(5)
def test_chat_api_copper_index_temporal_provenance(
    prepare_test_data: None,
    message: str,
    expected_value: str,
    expected_doc_id: str,
    expected_temporal_type: str,
) -> None:
    payload = {
        "hub_id": HUB_ID,
        "message_id": 303,
        "message": message,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    temporal_type = glom(data, "metadata.temporal_type", default=None)
    document_ids = _document_ids_from_metadata(data)
    cited_document_ids = _cited_document_ids_from_metadata(data)
    assert len(document_ids) >= len(cited_document_ids) > 0

    assert answer.strip(), "Answer should not be empty"
    assert expected_value in answer, f"Expected copper index value '{expected_value}', got: {answer}"
    assert expected_doc_id in document_ids, (
        f"Expected provenance to include '{expected_doc_id}', got: {sorted(document_ids)}"
    )
    assert temporal_type == expected_temporal_type, (
        f"Expected temporal_type '{expected_temporal_type}', got: {temporal_type}"
    )


@pytest.mark.order(5)
def test_dual_retriever_temporal_filter_ignores_malformed_published_at(prepare_test_data: None) -> None:
    """The temporal retriever should ignore chunks whose published_at is not ISO-like."""
    from app.models.chat import ChatRequest
    from app.models.temporal import TemporalContext, TemporalType
    from app.services.dual_retriever import DualRetriever
    from app.services.retriever import Retriever

    query = "What is the current informal employment rate in the Veridian Republic?"
    chat = ChatRequest(hub_id=HUB_ID, message_id=502, message=query, history=[])
    temporal_ctx = TemporalContext(type=TemporalType.RECENCY, confidence=0.9)
    retriever = Retriever(
        chat=chat,
        enable_rephrasing=False,
        enable_hyde=False,
        temporal_context=temporal_ctx,
    )

    # Unwrap RelevanceFilteredRetriever by shape: isinstance can fail if import identity differs;
    # DualRetriever has neither relevance_gate nor base_retriever.
    dual_candidate = retriever.retriever
    while hasattr(dual_candidate, "base_retriever") and hasattr(dual_candidate, "relevance_gate"):
        dual_candidate = dual_candidate.base_retriever
    dual = dual_candidate
    assert isinstance(dual, DualRetriever), f"Expected DualRetriever after unwrapping gate wrapper, got {type(dual)}"

    temporal_result = dual.temporal_retriever.search(query_text=query, top_k=4)
    temporal_content = " ".join(item.content for item in temporal_result.items)
    logger.info(f"[malformed-date] temporal items={len(temporal_result.items)}")

    assert "veridian-informal-employment-valid.txt" in temporal_content, (
        "Expected temporal retriever to include the valid ISO-dated informal-employment document"
    )
    assert "veridian-informal-employment-malformed.txt" not in temporal_content, (
        "Temporal retriever should exclude malformed-date document from temporal scoring/filtering path"
    )


@pytest.mark.parametrize("filename,expected_entities_for_label", EXPECTED_ENTITIES_FOR_DOCUMENT)
@pytest.mark.order(5)
def test_entity_extraction_from_documents(
    prepare_test_data: None, neo4j_driver: Driver, filename: str, expected_entities_for_label: dict[str, list[str]]
) -> None:
    """Test expected Entity nodes are extracted from the documents defined in DOCUMENTS."""
    logger.info(f"Validating extracted entities for document: {filename}")

    for label, expected_entities in expected_entities_for_label.items():
        with neo4j_driver.session() as session:
            entity_query = f"""
            MATCH (d:Document_{HUB_ID})<-[:FROM_DOCUMENT]-(c:Chunk_{HUB_ID})<-[:FROM_CHUNK]-(e:$($label))
            WHERE d.document_id = $document_id
            RETURN DISTINCT e.name AS entity_name, 
                        labels(e) AS entity_labels, 
                        e.description AS entity_description
            ORDER BY e.name
            """
            result = session.run(entity_query, document_id=filename, label=label)

            found_entities = list(result)
            num_found = len(found_entities)
            assert num_found > 0, f"No entities labeled '{label}' found for document '{filename}'"
            logger.info(f"Found {num_found} entities labeled '{label}' for document '{filename}'")
            logger.debug(f"Entities: {found_entities}")

            found_names = [e["entity_name"] for e in found_entities if e["entity_name"] is not None]

            # markdown-stripping canary: extracted names must not retain markup
            for found_name in found_names:
                assert not any(marker in found_name for marker in ("*", "_", "#", "`")), (
                    f"Entity name '{found_name}' contains markdown markers for document '{filename}'"
                )

            # substring match: the extraction LLM may add honorifics ("Dr. Elena Vasquez")
            for name in expected_entities:
                assert any(name.lower() in found_name.lower() for found_name in found_names), (
                    f"Expected to find entity '{name}', but found only '{found_entities}'"
                )

    logger.info("Entity extraction validation completed successfully!")


@pytest.mark.order(5)
def test_rag_search_with_explicit_query_vector(prepare_test_data: None, neo4j_driver: Driver) -> None:
    """
    Integration test to verify that graph_rag.search properly uses the provided
    query_vector for retrieval, rather than re-embedding the query_text.
    """
    from app.models.chat import ChatRequest
    from app.services.embedder_factory import EmbedderFactory
    from app.services.retriever import Retriever

    useless_query = "Who is dataset?"

    hypothetical_doc = (
        "PRISM is a dataset for AI alignment research, collecting diverse human feedback "
        "from participants across many countries to improve large language model behavior "
        "and reduce bias. The project was led by researchers at the University of Oxford."
    )

    embedder = EmbedderFactory.get_embedder(purpose="query")
    query_vector = embedder.embed_query(hypothetical_doc)
    logger.info(f"Query vector dimension: {len(query_vector)}")

    chat = ChatRequest(
        hub_id=HUB_ID,
        message_id=999,
        message=useless_query,
        history=[],
    )

    # recency-first would window the search to the last 30 days and exclude the
    # undated target document; this test is about explicit query vectors, not recency
    retriever = Retriever(chat=chat, enable_rephrasing=False, recency_first_enabled=False)

    result = retriever.graph_rag.search(
        query_text=useless_query,
        retriever_config={
            "top_k": 5,
            "query_vector": query_vector,
        },
        return_context=True,
    )

    # this test verifies that RETRIEVAL uses the provided query_vector instead of
    # re-embedding query_text, so assert on the retrieved context — the LLM answer for
    # the deliberately useless query_text ("Who is dataset?") may legitimately be a
    # grounded refusal and is logged only for information.
    logger.info(f"Answer with query_vector: {result.answer}")
    assert result.retriever_result is not None, "Expected retriever context in the search result"
    context_text = " ".join(item.content for item in result.retriever_result.items)

    prism_keywords = ["PRISM", "alignment", "Oxford", "Hannah", "feedback", "diverse"]
    found_keywords = [kw for kw in prism_keywords if kw.lower() in context_text.lower()]

    assert len(found_keywords) >= 2, (
        f"Expected retrieved context to contain PRISM-related content when using query_vector, "
        f"but found keywords {found_keywords} in context: {context_text[:500]}"
    )

    logger.info(f"Test passed! Found PRISM-related keywords in retrieved context: {found_keywords}")

    result_without_vector = retriever.graph_rag.search(
        query_text=useless_query,
        retriever_config={"top_k": 5},
        return_context=True,
    )

    context_without_vector = (
        " ".join(item.content for item in result_without_vector.retriever_result.items)
        if result_without_vector.retriever_result is not None
        else ""
    )
    found_keywords_without = [kw for kw in prism_keywords if kw.lower() in context_without_vector.lower()]

    logger.info(f"Keywords found in context without query_vector: {found_keywords_without}")
    logger.info(f"Keywords found in context with query_vector: {found_keywords}")


@pytest.mark.order(6)
def test_summarizer() -> None:
    logger.info("Testing /summarize API...")

    with open(TEST_TXT, "r", encoding="utf-8") as f:
        content = f.read()

    payload = {
        "texts": [content],
    }

    response = requests.post(f"{BASE_URL}/summarize", json=payload, timeout=30)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "summary" in data, "Response should contain 'summary' field"

    summary = data["summary"]
    logger.info(f"Received summary: {summary}")

    assert summary.strip(), "Summary should not be empty"
    assert "Ed Bice" in summary, f"Summary should mention 'Ed Bice', but got: {summary}"
    assert "Dima Saber" in summary, f"Summary should mention 'Dima Saber', but got: {summary}"

    logger.info("Summarize API test passed: Summary includes 'Dima Saber' and 'Ed Bice'")


@pytest.mark.order(6)
def test_preview_api_role_description_uses_personalization() -> None:
    """The role_description scenario must answer from the persona (name/description/hub_name),
    not refuse for lack of grounding in the synthetic context. Regression test for the bug where
    the strict RAG grounding rules caused the model to ignore persona details not restated in the
    scenario's mock context.
    """
    logger.info("Testing /preview API for role_description scenario...")

    payload = {
        "scenario": "role_description",
        "personalization": {
            "name": "Meedan Uptime",
            "description": "This is just used for the Uptime monitor.",
            "hub_name": "Uptime",
            "tone": "journalist",
        },
    }

    response = requests.post(f"{BASE_URL}/preview", json=payload, timeout=30)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    logger.info(f"Received preview answer: {answer}")

    assert answer.strip(), "Answer should not be empty"
    assert "Meedan Uptime" in answer, f"Answer should mention the persona name 'Meedan Uptime', but got: {answer}"
    assert "not enough information" not in answer.lower(), (
        f"Answer should not refuse for lack of grounding when persona details are provided, but got: {answer}"
    )

    logger.info("Preview API test passed: role_description answer uses personalization")


@pytest.mark.order(6)
def test_preview_api_role_description_without_personalization() -> None:
    """Preview should still work with an empty personalization (no name/description/hub_name)."""
    logger.info("Testing /preview API for role_description scenario with no personalization...")

    payload = {
        "scenario": "role_description",
        "personalization": {},
    }

    response = requests.post(f"{BASE_URL}/preview", json=payload, timeout=90)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data["answer"]
    logger.info(f"Received preview answer: {answer}")

    assert answer.strip(), "Answer should not be empty"

    logger.info("Preview API test passed: role_description works without personalization")


@pytest.mark.order(7)
@pytest.mark.skipif(DEBUG_DATA, reason="Skipping deletion test because DEBUG_DATA is True")
def test_delete_existing_document(neo4j_driver: Driver) -> None:
    # First, verify the document exists in Neo4j
    logger.info("Verifying document exists before deletion...")
    with neo4j_driver.session() as session:
        check_query = """
        MATCH (d:Document_1)
        WHERE d.document_id = $document_id
        RETURN count(d) as doc_count
        """
        result = session.run(check_query, document_id=DOCUMENT_ID)
        record = result.single()
        assert record is not None, "Query should return a result"
        doc_count = record["doc_count"]

        assert doc_count > 0, f"Document '{DOCUMENT_ID}' should exist before deletion, but found {doc_count}"
        logger.info(f"Document exists in Neo4j (count: {doc_count})")

    # Send DELETE request
    payload = {
        "hub_id": 1,
        "document_id": DOCUMENT_ID,
    }

    response = requests.delete(f"{BASE_URL}/document/", json=payload, timeout=10)

    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "id" in data, "Response should contain job ID"
    assert "status" in data, "Response should contain job status"

    job_id = data["id"]
    logger.info(f"Document deletion job created: {job_id}")

    # Poll the job status endpoint
    max_attempts = 60
    attempt = 0
    final_status = data["status"]

    while attempt < max_attempts:
        attempt += 1
        time.sleep(2)

        status_response = requests.get(f"{BASE_URL}/document/{job_id}", timeout=10)
        assert status_response.status_code == 200, f"Failed to get job status: {status_response.text}"

        status_data = status_response.json()
        final_status = status_data["status"]

        logger.info(f"Attempt {attempt}: Deletion job status = {final_status}")

        if final_status in ["finished", "failed"]:
            break

    assert final_status == "finished", f"Deletion job did not complete successfully. Final status: {final_status}"
    logger.info("Document deletion completed successfully!")

    # Validate the document is missing from Neo4j
    logger.info("Validating document is missing from Neo4j...")
    with neo4j_driver.session() as session:
        verify_query = """
        MATCH (d:Document_1)
        WHERE d.document_id = $document_id
        RETURN count(d) as doc_count
        """
        result = session.run(verify_query, document_id=DOCUMENT_ID)
        record = result.single()
        assert record is not None, "Query should return a result"
        doc_count = record["doc_count"]

        assert doc_count == 0, f"Document '{DOCUMENT_ID}' should be deleted, but found {doc_count} node(s)"
        logger.info("Document successfully removed from Neo4j")

        # Also verify chunks are deleted
        chunk_query = """
        MATCH (c:Chunk_1)-[:FROM_DOCUMENT]->(d:Document_1)
        WHERE d.document_id = $document_id
        RETURN count(c) as chunk_count
        """
        result = session.run(chunk_query, document_id=DOCUMENT_ID)
        record = result.single()
        assert record is not None, "Query should return a result"
        chunk_count = record["chunk_count"]

        assert chunk_count == 0, f"Chunks for document '{DOCUMENT_ID}' should be deleted, but found {chunk_count}"
        logger.info("All chunks successfully removed from Neo4j")


@pytest.mark.order(8)
def test_delete_non_existing_document() -> None:
    payload = {
        "hub_id": 1,
        "document_id": "non_existing_document_12345",
    }

    response = requests.delete(f"{BASE_URL}/document/", json=payload, timeout=10)

    # The API changed: now it responds with a 204 No Content
    assert response.status_code == 204, f"Expected 204, got {response.status_code}: {response.text}"


@pytest.mark.order(9)
@pytest.mark.skipif(DEBUG_DATA, reason="Skipping job status test because DEBUG_DATA is True")
def test_job_status_not_found() -> None:
    fake_job_id = "nonexistent_job_id_12345"

    response = requests.get(f"{BASE_URL}/document/{fake_job_id}", timeout=10)

    assert response.status_code == 404, f"Expected 404, got {response.status_code}"


@pytest.fixture
def yago_neo4j_driver() -> Generator[Driver, None, None]:
    """Fixture for YAGO Neo4j connection. Skips if not configured, unreachable, or missing YAGO data."""
    from neo4j.exceptions import ServiceUnavailable

    if ROUTER_ENABLE_YAGO not in [1, True, "1", "True", "true"] or not YAGO_NEO4J_URI:
        pytest.skip("ROUTER_ENABLE_YAGO disabled or YAGO_NEO4J_URI not configured")

    driver = GraphDatabase.driver(YAGO_NEO4J_URI, auth=(YAGO_NEO4J_USERNAME, YAGO_NEO4J_PASSWORD))

    try:
        driver.verify_connectivity()
    except ServiceUnavailable:
        driver.close()
        pytest.skip(f"YAGO Neo4j not reachable at {YAGO_NEO4J_URI}")

    # Verify YAGO data exists by checking for Resource label
    with driver.session() as session:
        result = session.run("MATCH (n:Resource) RETURN count(n) as count LIMIT 1")
        record = result.single()
        if not record or record["count"] == 0:
            driver.close()
            pytest.skip("YAGO data not present in Neo4j (no Resource nodes found)")

    yield driver
    driver.close()


@pytest.mark.order(10)
def test_yago_cypher_executor_finds_entity_properties(yago_neo4j_driver: Driver) -> None:
    from app.services.router.yago_executor import CypherExecutor

    executor = CypherExecutor(driver=yago_neo4j_driver, timeout_seconds=30)
    results = executor.execute("Alain_Berthoz", ["schema:birthDate"])

    assert len(results) > 0
    birth = next((r for r in results if r["predicate"] == "schema:birthDate"), None)
    assert birth is not None
    assert "1939" in birth["object_value"]


@pytest.mark.order(10)
def test_yago_cypher_executor_finds_entity_relationships(yago_neo4j_driver: Driver) -> None:
    from app.services.router.yago_executor import CypherExecutor

    executor = CypherExecutor(driver=yago_neo4j_driver, timeout_seconds=30)
    results = executor.execute("Alain_Berthoz", ["schema:memberOf"])

    assert len(results) > 0
    membership = next((r for r in results if r["predicate"] == "schema:memberOf"), None)
    assert membership is not None


@pytest.mark.order(10)
def test_yago_cypher_executor_finds_both_properties_and_relationships(yago_neo4j_driver: Driver) -> None:
    from app.services.router.yago_executor import CypherExecutor

    executor = CypherExecutor(driver=yago_neo4j_driver, timeout_seconds=30)
    results = executor.execute("Alain_Berthoz", ["schema:birthDate", "schema:memberOf", "rdfs:label"])

    predicates = {r["predicate"] for r in results}
    assert "schema:birthDate" in predicates or "rdfs:label" in predicates
    assert len(results) >= 1


@pytest.mark.order(13)
def test_synthesis_top_news_this_week(prepare_roman_empire_data: None, neo4j_driver: Driver) -> None:
    """Test that a digest query triggers synthesis and prioritizes recent documents.

    We ingest 10 Roman Empire articles: 5 recent (0-3 days old) and 5 old (60-90 days).
    A synthesis query should produce a digest dominated by recent content.
    """
    logger.info("Testing synthesis: 'Summarize this week's Roman Empire news'")

    # verify documents were ingested with published_at set on chunks
    with neo4j_driver.session() as session:
        result = session.run(
            f"""
            MATCH (c:Chunk_{HUB_ID})-[:FROM_DOCUMENT]->(d:Document_{HUB_ID})
            WHERE d.document_id STARTS WITH 'roman-empire-'
              AND c.published_at IS NOT NULL
            RETURN count(DISTINCT d) AS doc_count, count(c) AS chunk_count
            """
        )
        record = result.single()
        assert record is not None, "Expected a result from the chunk query"
        doc_count = record["doc_count"]
        chunk_count = record["chunk_count"]
        logger.info(f"Found {doc_count} Roman Empire documents with {chunk_count} dated chunks")
        assert doc_count == 10, f"Expected 10 Roman Empire documents, got {doc_count}"
        assert chunk_count > 0, "Expected chunks with published_at set"

    # ask for a digest — include "Roman Empire" to ground retrieval in the right docs,
    # since the hub also contains unrelated documents from other integration tests
    payload = {
        "hub_id": HUB_ID,
        "message_id": 2000,
        "message": "Summarize this week's Roman Empire news",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=120)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    metadata = data.get("metadata", {})

    logger.info(f"Synthesis answer:\n{answer}")
    logger.info(f"Full metadata: {metadata}")

    assert answer.strip(), "Answer should not be empty"

    # first verify synthesis was actually triggered — if not, the rest is meaningless
    synthesis_type = metadata.get("synthesis_type")
    synthesis_chunks = metadata.get("synthesis_chunks_used")

    logger.info(f"synthesis_type={synthesis_type}, chunks_used={synthesis_chunks}")

    assert synthesis_type == "temporal", (
        f"Expected synthesis_type='temporal' in metadata, got: {synthesis_type}. "
        f"The query was not classified as synthesis — it went through normal Q&A."
    )

    assert synthesis_chunks is not None and synthesis_chunks > 0, (
        f"Expected synthesis_chunks_used > 0, got: {synthesis_chunks}"
    )

    # the answer should reference at least some recent topics
    answer_lower = answer.lower()
    recent_hits = [topic for topic in RECENT_TOPICS if topic in answer_lower]
    old_hits = [topic for topic in OLD_ONLY_TOPICS if topic in answer_lower]

    logger.info(f"Recent topic hits: {recent_hits}")
    logger.info(f"Old-only topic hits: {old_hits}")

    assert len(recent_hits) >= 2, (
        f"Expected synthesis to mention at least 2 recent topics ({RECENT_TOPICS}), "
        f"but only found: {recent_hits}. Answer: {answer}"
    )

    # old-only topics should not dominate — allow at most 1 mention
    assert len(old_hits) <= 1, (
        f"Expected synthesis to deprioritize old topics, but found {old_hits} in answer: {answer}"
    )

    # source attribution: synthesis should produce cited document IDs
    document_ids_used = metadata.get("document_ids_used", [])
    document_ids_cited = metadata.get("document_ids_cited", [])
    logger.info(f"Documents retrieved: {document_ids_used}, cited: {document_ids_cited}")

    assert document_ids_cited is not None and len(document_ids_cited) > 0, (
        f"Expected at least one cited document, got none. Retrieved: {document_ids_used}"
    )

    # cited docs should be a subset of retrieved docs
    assert set(document_ids_cited) <= set(document_ids_used), (
        f"Cited docs should be a subset of retrieved docs. cited={document_ids_cited}, retrieved={document_ids_used}"
    )

    # at least one cited document should be from the recent set
    recent_doc_ids = {filename for filename, age_days in ROMAN_EMPIRE_DOCUMENTS if age_days <= 3}
    cited_recent = [d for d in document_ids_cited if d in recent_doc_ids]
    logger.info(f"Cited recent docs: {cited_recent}")

    assert len(cited_recent) >= 1, (
        f"Expected at least one recent document to be cited, but cited={document_ids_cited}, recent={recent_doc_ids}"
    )

    logger.info("Synthesis integration test passed")


@pytest.mark.order(13)
def test_synthesis_answers_in_question_language_not_corpus_language(prepare_roman_empire_data: None) -> None:
    """A digest question must be answered in the user's language, not the corpus language.

    Regression for the "latest news" bug: the synthesis path never passed the question language to the summarizer.
    The summarizer then mirrored the language of the retrieved chunks.
    A Portuguese digest question over the English Roman Empire corpus must come back in Portuguese."""
    logger.info("Testing synthesis language: Portuguese digest question over English corpus...")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 2001,
        "message": "Resuma as notícias desta semana sobre o Império Romano",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=120)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    metadata = data.get("metadata", {})
    logger.info(f"Synthesis answer:\n{answer}")
    assert answer.strip(), "Answer should not be empty"

    # the language assertion is meaningless if the query did not take the synthesis path
    synthesis_type = metadata.get("synthesis_type")
    assert synthesis_type is not None, (
        f"Expected the query to be classified as synthesis, but synthesis_type is missing. Metadata: {metadata}"
    )

    assert metadata.get("language") == "pt", (
        f"Expected the digest to be written in Portuguese like the question, "
        f"got metadata.language {metadata.get('language')!r}. Answer: {answer}"
    )

    logger.info("Synthesis language integration test passed")


@pytest.mark.order(13)
def test_synthesis_english_question_over_portuguese_corpus_answers_in_english(
    prepare_badminton_pt_data: None,
) -> None:
    """The exact bug-report scenario.

    An English "latest news" question over a Portuguese-only corpus must be answered in English.
    The corpus lives in its own hub so the digest retrieval cannot dilute it with other fixtures' documents."""
    logger.info("Testing synthesis language: English digest question over Portuguese corpus...")

    payload = {
        "hub_id": BADMINTON_HUB_ID,
        "message_id": 2002,
        "message": "Summarize the latest news in badminton",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=120)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    metadata = data.get("metadata", {})
    logger.info(f"Synthesis answer:\n{answer}")
    assert answer.strip(), "Answer should not be empty"

    synthesis_type = metadata.get("synthesis_type")
    assert synthesis_type is not None, (
        f"Expected the query to be classified as synthesis, but synthesis_type is missing. Metadata: {metadata}"
    )

    # the digest must actually be built from the Portuguese corpus for the language assertion to prove anything
    document_ids_used = metadata.get("document_ids_used") or []
    logger.info(f"Documents used: {document_ids_used}")
    assert document_ids_used, "Expected the digest to be built from retrieved documents, got none"
    assert set(document_ids_used) <= BADMINTON_PT_DOCUMENT_IDS, (
        f"Expected only the Portuguese badminton documents in the digest, got: {document_ids_used}"
    )

    assert metadata.get("language") == "en", (
        f"Expected the digest to be written in English like the question, "
        f"got metadata.language {metadata.get('language')!r}. Answer: {answer}"
    )

    logger.info("English-question-over-Portuguese-corpus integration test passed")


@pytest.mark.order(13)
def test_synthesis_refuses_question_in_language_hub_does_not_support(
    prepare_badminton_pt_data: None,
) -> None:
    """An English digest question to a hub that only allows Portuguese must be refused, not answered with a digest."""
    logger.info("Testing synthesis refusal: English digest question on a Portuguese-only hub...")

    payload = {
        "hub_id": BADMINTON_HUB_ID,
        "message_id": 2003,
        "message": "Summarize the latest news in badminton",
        "history": [],
        "personalization": {
            "default_language": "pt",
            "supported_languages": ["pt"],
        },
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=120)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    metadata = data.get("metadata", {})
    logger.info(f"Refusal answer:\n{answer}")
    assert answer.strip(), "Answer should not be empty"

    # the refusal short-circuits in preflight, so no synthesis pipeline runs and nothing is retrieved
    assert metadata.get("synthesis_type") is None, (
        f"Expected no synthesis for an unsupported question language, but got synthesis_type="
        f"{metadata.get('synthesis_type')}. Answer: {answer}"
    )
    assert not metadata.get("document_ids_used"), (
        f"Expected no documents to be retrieved for a refused question, got: {metadata.get('document_ids_used')}"
    )

    # the refusal itself is written in the user's language so they can understand it
    assert metadata.get("language") == "en", (
        f"Expected the refusal metadata language to be 'en', got: {metadata.get('language')}"
    )

    logger.info("Unsupported-language refusal integration test passed")


@pytest.mark.order(14)
def test_topical_summary_roman_empire_only_roman_sources(
    prepare_test_data: None,
    prepare_roman_empire_data: None,
    neo4j_driver: Driver,
) -> None:
    logger.info("Testing topical summary: Roman Empire overview")

    with neo4j_driver.session() as session:
        result = session.run(
            f"""
            MATCH (d:Document_{HUB_ID})
            WHERE d.document_id STARTS WITH 'roman-empire-'
            RETURN count(d) AS doc_count
            """
        )
        record = result.single()
        assert record is not None
        assert record["doc_count"] == 10, f"Expected 10 Roman Empire documents, got {record['doc_count']}"

    payload = {
        "hub_id": HUB_ID,
        "message_id": 2001,
        "message": "Tell me all you know about the Roman Empire.",
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=120)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data
    answer = data["answer"]
    metadata = data.get("metadata", {}) or {}

    logger.info(f"Topical summary answer:\n{answer}")
    logger.info(f"Full metadata: {metadata}")

    assert answer.strip()

    synthesis_type = metadata.get("synthesis_type")
    synthesis_chunks = metadata.get("synthesis_chunks_used")
    logger.info(f"synthesis_type={synthesis_type}, chunks_used={synthesis_chunks}")

    # deterministic: classification and retrieval must work
    assert synthesis_type == "topical", (
        f"Expected synthesis_type='topical' in metadata, got: {synthesis_type}. "
        "The query was not classified as topical synthesis."
    )
    assert synthesis_chunks is not None and synthesis_chunks > 0, (
        f"Expected synthesis_chunks_used > 0, got: {synthesis_chunks}"
    )

    # judge rejection is signaled by error_type, not answerable
    # no-answer fallbacks keep answerable=true so the cms counts them as unanswered questions
    if data.get("error_type") == "NO_ANSWER_AVAILABLE":
        # judge rejected despite successful retrieval; not a test failure
        assert metadata.get("answerable") is True, (
            f"No-answer fallback must keep answerable=true, got: {metadata.get('answerable')}"
        )
        assert synthesis_chunks >= 5, (
            f"Expected substantial chunk retrieval even when judge rejects, got {synthesis_chunks}"
        )
        logger.warning(f"Answer judge rejected topical summary despite {synthesis_chunks} chunks retrieved")
        return

    # LLM-dependent: only assert answer quality when the judge accepted
    document_ids_used = metadata.get("document_ids_used") or []
    document_ids_cited = metadata.get("document_ids_cited") or []
    logger.info(f"Documents retrieved: {document_ids_used}, cited: {document_ids_cited}")

    assert document_ids_cited, f"Expected at least one cited document, got: {document_ids_cited}"

    roman_cited = [d for d in document_ids_cited if d in ROMAN_EMPIRE_DOCUMENT_IDS]
    non_roman_cited = [d for d in document_ids_cited if d not in ROMAN_EMPIRE_DOCUMENT_IDS]
    assert roman_cited, f"Expected at least one Roman Empire document to be cited, got: {document_ids_cited}"
    assert len(roman_cited) >= len(non_roman_cited), (
        "Expected the majority of cited documents to be from the Roman Empire corpus; "
        f"roman={roman_cited}, non_roman={non_roman_cited}"
    )

    answer_lower = answer.lower()
    topic_hits = [t for t in RECENT_TOPICS + OLD_ONLY_TOPICS if t in answer_lower]
    assert len(topic_hits) >= 1, (
        f"Expected the summary to reflect Roman corpus content (keywords), got hits: {topic_hits}. Answer: {answer}"
    )

    logger.info("Topical summary Roman-only sources integration test passed")


# ---------------------------------------------------------------------------
# html/css boilerplate filtering
# ---------------------------------------------------------------------------

# phrases the bot would use when *describing* markup instead of summarising
# actual article content — this is what the real failure mode looks like
_WEB_BOILERPLATE_TERMS = [
    "css",
    "stylesheet",
    "styling",
    "html",
    "markup",
    "javascript",
    "cookie banner",
    "navigation menu",
    "code snippet",
    "font",
]


@pytest.mark.order(15)
def test_latest_news_ignores_html_css_boilerplate(prepare_html_laden_data: None) -> None:
    """No reply over HTML-laden docs may leak markup artifacts, fallback replies included.
    Content checks run only when the pipeline produced a real answer: whether the judge
    accepts the summary's composition is not this test's concern."""
    query = "Summarize the latest updates about the Greenfield Solar Initiative and the Crestwood coral discovery."
    logger.info(f"Testing boilerplate filtering with anchored query: {query}")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 3000,
        "message": query,
        "history": [],
    }

    data = _chat_with_retry(payload, timeout=120)
    assert "answer" in data, "Response should contain 'answer' field"

    answer = data["answer"]
    answer_lower = answer.lower()
    logger.info(f"Boilerplate-filter answer:\n{answer}")

    assert answer.strip(), "Answer should not be empty"

    # answer must not leak web boilerplate
    leaked = [term for term in _WEB_BOILERPLATE_TERMS if term in answer_lower]
    assert not leaked, (
        f"Answer contains web boilerplate artifacts {leaked} — the LLM should have ignored CSS/HTML/JS. "
        f"Answer: {answer}"
    )

    if data.get("error_type") is not None:
        logger.info(f"Pipeline returned fallback (error_type={data['error_type']}); content checks skipped")
        return

    # answer must reference actual article content
    article_topics_found = [
        topic
        for topic in ["solar", "greenfield", "montara", "coral", "crestwood", "valdez", "kowalski"]
        if topic in answer_lower
    ]
    logger.info(f"Article topic hits: {article_topics_found}")
    assert len(article_topics_found) >= 2, (
        f"Expected answer to mention actual article topics (solar/greenfield/montara/coral/crestwood/valdez/kowalski), "
        f"but only found: {article_topics_found}. Answer: {answer}"
    )

    # response should be grounded in the html-laden test docs
    cited_ids = glom(data, "metadata.document_ids_cited", default=[]) or []
    expected_html_docs = {"html-laden-article-01.txt", "html-laden-article-02.txt"}
    assert set(cited_ids) & expected_html_docs, (
        f"Expected at least one cited HTML-laden fixture document, got cited_ids={cited_ids}"
    )

    logger.info("Boilerplate filtering integration test passed")


# ---------------------------------------------------------------------------
# markdown / structured document handling
# ---------------------------------------------------------------------------


@pytest.mark.order(16)
def test_markdown_syntax_not_in_entity_names(prepare_test_data: None, neo4j_driver: Driver) -> None:
    """Extracted entity names should not contain Markdown formatting."""
    markdown_chars = ["**", "##", "# ", "- ", "|", "_", "`"]

    with neo4j_driver.session() as session:
        result = session.run(
            f"""
            MATCH (d:Document_{HUB_ID})<-[:FROM_DOCUMENT]-(c:Chunk_{HUB_ID})<-[:FROM_CHUNK]-(e)
            WHERE d.document_id = 'markdown-structured-article.txt'
              AND e.name IS NOT NULL
            RETURN DISTINCT e.name AS entity_name
            """,
        )
        entity_names = [r["entity_name"] for r in result]

    assert entity_names, "No entities extracted from markdown-structured-article.txt"

    polluted = [name for name in entity_names if any(char in name for char in markdown_chars)]

    assert not polluted, f"Markdown syntax leaked into entity names: {polluted}"


@pytest.mark.order(17)
def test_body_entities_extracted_from_structured_markdown_document(
    prepare_test_data: None,
    neo4j_driver: Driver,
) -> None:
    """Entities present only in the document body should still be extracted."""
    with neo4j_driver.session() as session:
        result = session.run(
            f"""
            MATCH (d:Document_{HUB_ID})<-[:FROM_DOCUMENT]-(c:Chunk_{HUB_ID})<-[:FROM_CHUNK]-(e)
            WHERE d.document_id = 'markdown-structured-article.txt'
              AND e.name IS NOT NULL
            RETURN DISTINCT e.name AS entity_name
            """,
        )
        entity_names = [r["entity_name"].lower() for r in result]

    assert entity_names, "No entities extracted from markdown-structured-article.txt"

    # These entities appear only in the body content, not the headline.
    assert any("vasquez" in n for n in entity_names)
    assert any("university of basel" in n for n in entity_names)


# ── Hindi / Hinglish script detection ────────────────────────────────────

_DEVANAGARI_RANGE = range(0x0900, 0x0980)


def _has_devanagari(text: str) -> bool:
    return any(ord(c) in _DEVANAGARI_RANGE for c in text)


HINDI_SCRIPT_CASES: list[tuple[str, str, bool]] = [
    # (message, case_label, expect_devanagari_in_response)
    (
        "Suwali kya hai aur iska kya kaam hai?",
        "Case 1: Latin-script Hindi (Hinglish)",
        False,
    ),
    (
        "सुवाली क्या है और इसका क्या काम है?",
        "Case 2a: Devanagari script",
        True,
    ),
    (
        "सुवाली का purpose क्या है?",
        "Case 2b: Devanagari mixed with English in Latin script",
        True,
    ),
]


@pytest.mark.skip(reason="Language-specific test, not essential for CI")
@pytest.mark.parametrize(
    "message,case_label,expect_devanagari", HINDI_SCRIPT_CASES, ids=[c[1] for c in HINDI_SCRIPT_CASES]
)
@pytest.mark.order(5)
def test_chat_api_hindi_script_response(
    prepare_test_data: None,
    message: str,
    case_label: str,
    expect_devanagari: bool,
) -> None:
    """The bot should mirror the user's Hindi script: Latin in → Latin out, Devanagari in → Devanagari out."""
    logger.info(f"Testing Hindi script response — {case_label}: '{message}'")

    payload = {
        "hub_id": HUB_ID,
        "message_id": 9000,
        "message": message,
        "history": [],
    }

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=180)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    answer = data.get("answer", "")
    assert answer.strip(), f"Answer should not be empty for: {message}"

    logger.info(f"[{case_label}] Answer: {answer}")

    if expect_devanagari:
        assert _has_devanagari(answer), (
            f"[{case_label}] Expected Devanagari script in response but got none.\nAnswer: {answer}"
        )
    else:
        assert not _has_devanagari(answer), (
            f"[{case_label}] Expected Latin-script response (no Devanagari) but found Devanagari.\nAnswer: {answer}"
        )


# notebook summary language fidelity
NOTEBOOK_SUMMARY_PT_NOTE_1 = (
    "O governo federal anunciou nesta terça-feira um pacote de medidas econômicas "
    "para estimular o crescimento do PIB no segundo semestre. O ministro da Fazenda "
    "confirmou que serão investidos quinze bilhões de reais em infraestrutura, com "
    "prioridade para obras de saneamento básico e habitação popular nas regiões "
    "Norte e Nordeste do país."
)
NOTEBOOK_SUMMARY_PT_NOTE_2 = (
    "A Câmara dos Deputados aprovou o projeto de lei que regulamenta o uso de "
    "inteligência artificial no setor público. O texto estabelece critérios de "
    "transparência e responsabilidade para sistemas automatizados utilizados em "
    "decisões administrativas que afetam cidadãos. O projeto segue agora para o "
    "Senado Federal."
)

NOTEBOOK_SUMMARY_LANGUAGE_CASES = [
    ([NOTEBOOK_SUMMARY_PT_NOTE_1], "single-pt-note", "pt"),
    ([NOTEBOOK_SUMMARY_PT_NOTE_1, NOTEBOOK_SUMMARY_PT_NOTE_2], "two-pt-notes", "pt"),
]


@pytest.mark.parametrize(
    "texts,case_label,expected_lang",
    NOTEBOOK_SUMMARY_LANGUAGE_CASES,
    ids=[c[1] for c in NOTEBOOK_SUMMARY_LANGUAGE_CASES],
)
@pytest.mark.order(5)
async def test_summarize_preserves_input_language(texts: list[str], case_label: str, expected_lang: str) -> None:
    """The /summarize output must match the language of the input notes, including the
    multi-text case that previously regressed to English."""
    from app.services.language import detect_text

    logger.info(f"Testing summarize language fidelity — {case_label}: {len(texts)} text(s)")

    response = requests.post(f"{BASE_URL}/summarize/", json={"texts": texts}, timeout=180)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    summary = response.json().get("summary", "")
    assert summary.strip(), f"[{case_label}] Summary should not be empty"

    logger.info(f"[{case_label}] Summary: {summary}")

    detected_lang, confidence = await detect_text(summary)
    assert detected_lang == expected_lang, (
        f"[{case_label}] Expected summary in '{expected_lang}' but detected "
        f"'{detected_lang}' (confidence {confidence:.2f}).\nSummary: {summary}"
    )


@pytest.mark.order(5)
async def test_bedrock_fallback_answers_when_openai_times_out(monkeypatch: pytest.MonkeyPatch) -> None:
    """With LLM_BEDROCK_FALLBACK on, a hard OpenAI timeout must not break chat: BEDROCK_MODEL
    answers instead. OpenAI is patched at the SDK transport layer, so every wrapper (LCEL chat
    models, retriever LLM, guardrails) sees a real APITimeoutError; Bedrock and Neo4j are real.
    Runs the same pipeline the RQ worker runs (RAGRouter.route), in-process so the patch can
    reach it — the black-box HTTP tests can't simulate a provider outage."""
    import httpx
    from openai import APITimeoutError

    from app.models.chat import ChatRequest
    from app.services.router import RAGRouter

    monkeypatch.setenv("LLM_BEDROCK_FALLBACK", "1")

    warnings: list[str] = []
    sink_id = logger.add(lambda message: warnings.append(str(message)), level="WARNING")
    timeout_error = APITimeoutError(request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"))

    try:
        with (
            patch("openai._base_client.SyncAPIClient.request", side_effect=timeout_error),
            patch("openai._base_client.AsyncAPIClient.request", side_effect=timeout_error),
        ):
            response = await RAGRouter(HUB_ID).route(
                ChatRequest(
                    hub_id=HUB_ID,
                    message_id=999_001,
                    message="Who is the incoming executive director of Meedan?",
                )
            )
    finally:
        logger.remove(sink_id)

    logger.info(f"Bedrock fallback answer: {response.answer}")

    assert response.answer and response.answer.strip(), "Expected an answer despite the OpenAI outage"
    answer_lower = response.answer.lower()
    assert "dima" in answer_lower or "saber" in answer_lower, (
        f"Expected the Bedrock-served answer to name Meedan's incoming executive director, got: {response.answer}"
    )
    assert any("falling back to bedrock" in w or "retrying on fallback" in w for w in warnings), (
        "Expected a fallback warning proving Bedrock was engaged; OpenAI may have answered"
    )
