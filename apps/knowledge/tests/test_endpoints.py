import re
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.core.context import pipeline_step
from app.main import app
from app.models.chat import ChatResponse, ErrorType
from app.services.redis_client import get_redis_client

client = TestClient(app)


def test_health_endpoint() -> None:
    mock_redis = MagicMock()
    mock_redis.ping.return_value = True

    # Mock Queue and related RQ components
    with (
        patch("app.routes.health.Queue") as mock_queue_class,
        patch("app.routes.health.Worker") as mock_worker_class,
        patch("app.routes.health.FailedJobRegistry") as mock_failed_registry_class,
    ):
        # Mock queue with 5 jobs
        mock_queue = MagicMock()
        mock_queue.__len__ = MagicMock(return_value=5)
        mock_queue_class.return_value = mock_queue

        # Mock 2 active workers
        mock_worker1 = MagicMock()
        mock_worker1.state = "busy"
        mock_worker2 = MagicMock()
        mock_worker2.state = "idle"
        mock_worker_class.all.return_value = [mock_worker1, mock_worker2]

        # Mock failed registry with 3 failed jobs
        mock_failed_registry = MagicMock()
        mock_failed_registry.__len__ = MagicMock(return_value=3)
        mock_failed_registry_class.return_value = mock_failed_registry

        app.dependency_overrides[get_redis_client] = lambda: mock_redis

        try:
            response = client.get("/health/")
            assert response.status_code == 200
            data = response.json()
            assert "status" in data
            assert data["status"] == "ok"
            assert data["enqueued_jobs"] == 10  # 5 per queue × 2 queues
            assert data["failed_jobs"] == 6  # 3 per queue × 2 queues
            assert data["active_workers"] == 2
            mock_redis.ping.assert_called_once()
        finally:
            app.dependency_overrides.clear()


def test_health_endpoint_redis_failure() -> None:
    mock_redis = MagicMock()
    mock_redis.ping.side_effect = Exception("Redis connection failed")
    app.dependency_overrides[get_redis_client] = lambda: mock_redis

    try:
        response = client.get("/health/")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] == "error"
        assert data["enqueued_jobs"] == 0
        assert data["failed_jobs"] == 0
        assert data["active_workers"] == 0
        mock_redis.ping.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_health_endpoint_with_suspended_workers() -> None:
    mock_redis = MagicMock()
    mock_redis.ping.return_value = True

    with (
        patch("app.routes.health.Queue") as mock_queue_class,
        patch("app.routes.health.Worker") as mock_worker_class,
        patch("app.routes.health.FailedJobRegistry") as mock_failed_registry_class,
    ):
        mock_queue = MagicMock()
        mock_queue.__len__ = MagicMock(return_value=10)
        mock_queue_class.return_value = mock_queue

        # Mock 3 workers, but one is suspended
        mock_worker1 = MagicMock()
        mock_worker1.state = "busy"
        mock_worker2 = MagicMock()
        mock_worker2.state = "idle"
        mock_worker3 = MagicMock()
        mock_worker3.state = "suspended"
        mock_worker_class.all.return_value = [mock_worker1, mock_worker2, mock_worker3]

        mock_failed_registry = MagicMock()
        mock_failed_registry.__len__ = MagicMock(return_value=0)
        mock_failed_registry_class.return_value = mock_failed_registry

        app.dependency_overrides[get_redis_client] = lambda: mock_redis

        try:
            response = client.get("/health/")
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert data["enqueued_jobs"] == 20  # 10 per queue × 2 queues
            assert data["failed_jobs"] == 0
            assert data["active_workers"] == 2  # Only non-suspended workers
        finally:
            app.dependency_overrides.clear()


def test_health_endpoint_rq_metrics_failure() -> None:
    mock_redis = MagicMock()
    mock_redis.ping.return_value = True

    with patch("app.routes.health.Queue") as mock_queue_class:
        # Queue initialization raises an exception
        mock_queue_class.side_effect = Exception("RQ Queue error")

        app.dependency_overrides[get_redis_client] = lambda: mock_redis

        try:
            response = client.get("/health/")
            assert response.status_code == 200
            data = response.json()
            # Should still return ok status since Redis is working
            # but metrics should be 0 since we couldn't get them
            assert data["status"] == "ok"
            assert data["enqueued_jobs"] == 0
            assert data["failed_jobs"] == 0
            assert data["active_workers"] == 0
        finally:
            app.dependency_overrides.clear()


@patch("app.routes.chat.RAGRouter")
def test_chat_endpoint(mock_router_class: MagicMock) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Hi"))

    response = client.post("/chat", json={"hub_id": 1, "message_id": 1, "message": "Hello"})
    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "Hi"


@patch("app.routes.chat.RAGRouter")
def test_chat_with_history_endpoint(mock_router_class: MagicMock) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Hi"))

    response = client.post(
        "/chat",
        json={
            "hub_id": 1,
            "message_id": 1,
            "message": "Hello",
            "history": [{"role": "assistant", "content": "Hello"}, {"role": "user", "content": "How are you?"}],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "Hi"


@patch("app.routes.chat.RAGRouter")
def test_chat_with_personalization_endpoint(mock_router_class: MagicMock) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Personalized response"))

    response = client.post(
        "/chat",
        json={
            "hub_id": 1,
            "message_id": 1,
            "message": "Hello",
            "personalization": {
                "name": "TestBot",
                "description": "A helpful bot",
                "tone": "journalist",
            },
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "Personalized response"

    # Verify the router was called with personalization settings
    mock_router.route.assert_called_once()
    call_args = mock_router.route.call_args
    chat_request = call_args[0][0]  # First positional argument
    assert chat_request.personalization is not None
    assert chat_request.personalization.name == "TestBot"
    assert chat_request.personalization.description == "A helpful bot"
    assert chat_request.personalization.tone == "journalist"


@patch("app.routes.chat.RAGRouter")
def test_chat_with_personalization_and_external_resources(mock_router_class: MagicMock) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Response with resources"))

    response = client.post(
        "/chat",
        json={
            "hub_id": 1,
            "message_id": 1,
            "message": "What can you help me with?",
            "personalization": {
                "name": "HelpBot",
                "description": "Provides support and guidance",
                "tone": "advocate",
                "external_resources": [
                    {
                        "title": "https://example.com/guide",
                        "description": "Complete user documentation",
                        "scenarios": ["role_description"],
                    },
                    {
                        "title": "https://example.com/faq",
                        "description": None,
                        "scenarios": None,
                    },
                ],
            },
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "Response with resources"

    # Verify the router was called with personalization and external resources
    mock_router.route.assert_called_once()
    call_args = mock_router.route.call_args
    chat_request = call_args[0][0]  # First positional argument
    assert chat_request.personalization is not None
    assert chat_request.personalization.name == "HelpBot"
    assert chat_request.personalization.external_resources is not None
    assert len(chat_request.personalization.external_resources) == 2
    assert chat_request.personalization.external_resources[0].title == "https://example.com/guide"
    assert chat_request.personalization.external_resources[0].scenarios == ["role_description"]
    assert chat_request.personalization.external_resources[1].description is None


@patch("app.routes.chat.RAGRouter")
def test_chat_with_all_persona_tones(mock_router_class: MagicMock) -> None:
    """Test that all persona tones are accepted by the endpoint"""
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Tone response"))

    tones = ["journalist", "advocate", "executive"]

    for tone in tones:
        response = client.post(
            "/chat",
            json={
                "hub_id": 1,
                "message_id": 1,
                "message": "Test message",
                "personalization": {
                    "name": f"{tone.capitalize()}Bot",
                    "description": f"Testing {tone} tone",
                    "tone": tone,
                },
            },
        )
        assert response.status_code == 200, f"Failed for tone: {tone}"
        data = response.json()
        assert data["answer"] == "Tone response"


def test_chat_with_invalid_personalization_tone() -> None:
    """Test that an invalid tone is rejected"""
    response = client.post(
        "/chat",
        json={
            "hub_id": 1,
            "message_id": 1,
            "message": "Test message",
            "personalization": {
                "name": "InvalidBot",
                "description": "Testing invalid tone",
                "tone": "invalid_tone",
            },
        },
    )
    assert response.status_code == 422  # Validation error


@patch("app.routes.chat.RAGRouter")
def test_chat_without_personalization_still_works(mock_router_class: MagicMock) -> None:
    """Ensure backward compatibility - chat works without personalization"""
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Default response"))

    response = client.post(
        "/chat",
        json={
            "hub_id": 1,
            "message_id": 1,
            "message": "Hello without personalization",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "Default response"

    # Verify personalization is None
    call_args = mock_router.route.call_args
    chat_request = call_args[0][0]  # First positional argument
    assert chat_request.personalization is None


@patch("app.routes.chat.RAGRouter")
def test_chat_debug_returns_request_log(mock_router_class: MagicMock) -> None:
    async def route(_: Any) -> ChatResponse:
        with pipeline_step("internal_kb"):
            logger.info("Searching sources")
        return ChatResponse(answer="Answer")

    mock_router_class.return_value.route = route

    response = client.post("/chat", json={"hub_id": 1, "message_id": 1, "message": "Hello", "debug": True})

    assert response.status_code == 200
    log = response.json()["log"]
    assert any(re.fullmatch(r"\+\d+ms \[internal_kb\] Searching sources", line) for line in log)
    assert re.fullmatch(r"\+\d+ms Chat message processed in \d+ms", log[-1])


@patch("app.routes.chat.RAGRouter")
def test_chat_without_debug_returns_no_log(mock_router_class: MagicMock) -> None:
    mock_router_class.return_value.route = AsyncMock(return_value=ChatResponse(answer="Answer"))

    response = client.post("/chat", json={"hub_id": 1, "message_id": 1, "message": "Hello"})

    assert response.status_code == 200
    assert response.json()["log"] is None


@patch("app.routes.chat.process_chat")
@patch("app.routes.chat.Queue")
@patch("app.routes.chat.Config")
def test_chat_endpoint_with_callback_url_forwards_debug(
    mock_config: MagicMock,
    mock_queue_class: MagicMock,
    mock_process_chat: MagicMock,
) -> None:
    mock_config.return_value.rq_retry_max = 0
    mock_job = mock_queue_class.return_value.enqueue.return_value
    mock_job.id = "job-abc"
    mock_job.get_status.return_value = "queued"
    app.dependency_overrides[get_redis_client] = lambda: MagicMock()
    try:
        response = client.post(
            "/chat",
            json={
                "hub_id": 1,
                "message_id": 42,
                "message": "Hello",
                "callback_url": "http://example.com/callback",
                "debug": True,
            },
        )
        assert response.status_code == 200
        assert mock_queue_class.return_value.enqueue.call_args[0][11] is True
    finally:
        app.dependency_overrides.clear()


@patch("app.routes.chat.process_chat")
@patch("app.routes.chat.Queue")
@patch("app.routes.chat.Config")
def test_chat_endpoint_with_callback_url_enqueues_job(
    mock_config: MagicMock,
    mock_queue_class: MagicMock,
    mock_process_chat: MagicMock,
) -> None:
    mock_config.return_value.rq_job_timeout = 600
    mock_config.return_value.rq_retry_max = 3

    mock_redis = MagicMock()
    app.dependency_overrides[get_redis_client] = lambda: mock_redis

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = "job-abc"
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    try:
        response = client.post(
            "/chat",
            json={
                "hub_id": 1,
                "message_id": 42,
                "message": "Hello",
                "callback_url": "http://example.com/callback",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "job-abc"
        assert data["status"] == "queued"

        mock_queue.enqueue.assert_called_once()
        call_args = mock_queue.enqueue.call_args
        assert call_args[0][0] == mock_process_chat
        assert call_args[0][7] is None
        assert call_args[0][8] == []
    finally:
        app.dependency_overrides.clear()


@patch("app.routes.chat.process_chat")
@patch("app.routes.chat.Queue")
@patch("app.routes.chat.Config")
def test_chat_endpoint_with_callback_url_forwards_existing_topics(
    mock_config: MagicMock,
    mock_queue_class: MagicMock,
    mock_process_chat: MagicMock,
) -> None:
    mock_config.return_value.rq_job_timeout = 600
    mock_config.return_value.rq_retry_max = 3

    mock_redis = MagicMock()
    app.dependency_overrides[get_redis_client] = lambda: mock_redis

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = "job-topics"
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    try:
        response = client.post(
            "/chat",
            json={
                "hub_id": 1,
                "message_id": 42,
                "message": "What about elections?",
                "callback_url": "http://example.com/callback",
                "existing_topics": ["Elections", "Climate Policy"],
            },
        )
        assert response.status_code == 200

        call_args = mock_queue.enqueue.call_args
        assert call_args[0][8] == ["Elections", "Climate Policy"]
    finally:
        app.dependency_overrides.clear()


@patch("app.routes.chat.process_chat")
@patch("app.routes.chat.Queue")
@patch("app.routes.chat.Config")
@pytest.mark.parametrize(
    ("conversation_context", "expected"),
    [
        (None, None),
        ([], []),
        ([{"id": "1", "text": "Lives in Lagos"}], [{"id": "1", "text": "Lives in Lagos"}]),
    ],
)
def test_chat_endpoint_with_callback_url_forwards_conversation_context(
    mock_config: MagicMock,
    mock_queue_class: MagicMock,
    mock_process_chat: MagicMock,
    conversation_context: list[dict[str, str]] | None,
    expected: list[dict[str, str]] | None,
) -> None:
    mock_config.return_value.rq_job_timeout = 600
    mock_config.return_value.rq_retry_max = 3

    mock_redis = MagicMock()
    app.dependency_overrides[get_redis_client] = lambda: mock_redis

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = "job-context"
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    payload: dict[str, Any] = {
        "hub_id": 1,
        "message_id": 42,
        "message": "When are the elections?",
        "callback_url": "http://example.com/callback",
    }
    if conversation_context is not None:
        payload["conversation_context"] = conversation_context

    try:
        response = client.post("/chat", json=payload)
        assert response.status_code == 200

        call_args = mock_queue.enqueue.call_args
        assert call_args[0][9] == expected
    finally:
        app.dependency_overrides.clear()


@patch("app.routes.chat.process_chat")
@patch("app.routes.chat.Queue")
@patch("app.routes.chat.Config")
def test_chat_endpoint_with_callback_url_passes_recency_first_enabled(
    mock_config: MagicMock,
    mock_queue_class: MagicMock,
    mock_process_chat: MagicMock,
) -> None:
    mock_config.return_value.rq_job_timeout = 600
    mock_config.return_value.rq_retry_max = 3

    mock_redis = MagicMock()
    app.dependency_overrides[get_redis_client] = lambda: mock_redis

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = "job-recency"
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    try:
        response = client.post(
            "/chat",
            json={
                "hub_id": 1,
                "message_id": 42,
                "message": "Hello",
                "callback_url": "http://example.com/callback",
                "recency_first_enabled": True,
            },
        )
        assert response.status_code == 200

        call_args = mock_queue.enqueue.call_args
        assert call_args[0][7] is True
    finally:
        app.dependency_overrides.clear()


@patch("app.routes.chat.process_chat")
@patch("app.routes.chat.Queue")
@patch("app.routes.chat.Config")
@pytest.mark.parametrize("location_gate_enabled", [True, False, None])
def test_chat_endpoint_with_callback_url_passes_location_gate_enabled(
    mock_config: MagicMock,
    mock_queue_class: MagicMock,
    mock_process_chat: MagicMock,
    location_gate_enabled: bool | None,
) -> None:
    mock_config.return_value.rq_job_timeout = 600
    mock_config.return_value.rq_retry_max = 3

    mock_redis = MagicMock()
    app.dependency_overrides[get_redis_client] = lambda: mock_redis

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = "job-location-gate"
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    payload: dict[str, Any] = {
        "hub_id": 1,
        "message_id": 42,
        "message": "When are the elections?",
        "callback_url": "http://example.com/callback",
        "conversation_context": [],
    }
    if location_gate_enabled is not None:
        payload["location_gate_enabled"] = location_gate_enabled

    try:
        response = client.post("/chat", json=payload)
        assert response.status_code == 200

        call_args = mock_queue.enqueue.call_args
        assert call_args[0][10] is location_gate_enabled
    finally:
        app.dependency_overrides.clear()


@patch("app.routes.chat.RAGRouter")
def test_chat_endpoint_without_callback_url_runs_sync(mock_router_class: MagicMock) -> None:
    """Ensure backward compatibility - chat without callback_url runs synchronously."""
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(return_value=ChatResponse(answer="Sync answer"))

    response = client.post(
        "/chat",
        json={"hub_id": 1, "message_id": 1, "message": "Hello"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "Sync answer"
    mock_router.route.assert_called_once()


@patch("app.routes.chat.RAGRouter")
def test_chat_endpoint_exception(mock_router_class: MagicMock) -> None:
    mock_router = mock_router_class.return_value
    mock_router.route = AsyncMock(
        return_value=ChatResponse(
            answer="An unexpected error occurred. Please try again later.", error_type=ErrorType.INTERNAL_ERROR
        )
    )
    response = client.post("/chat", json={"hub_id": 1, "message_id": 42, "message": "What is Lupus?"})
    assert response.status_code == 200
    data = response.json()
    assert data["error_type"] == "INTERNAL_ERROR"
    assert "An unexpected error occurred" in data["answer"]


@pytest.mark.parametrize(
    "expected_hub_id,expected_document_id,expected_file_url,expected_text,expected_status",
    [
        (1, "Tm90ZWJvb2svMQo=", "", "This is a test", "queued"),
        (2, "RG9jdW1lbnQvMgO=", "s3://bucket/file.pdf", "", "queued"),
        (3, "Tm90ZWJvb2svMwo=", "https://example.com/doc.pdf", "Another test document", "started"),
        (4, "RG9jdW1lbnQvNAo=", "", "Text only document", "finished"),
    ],
)
@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_index_document_endpoint_text(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
    expected_hub_id: int,
    expected_document_id: str,
    expected_file_url: str,
    expected_text: str,
    expected_status: str,
) -> None:
    expected_job_id = uuid4().hex

    # Mock the config
    mock_config_instance = mock_config.return_value
    mock_config_instance.rq_retry_max = 5

    # Mock the Redis client
    mock_redis_client = MagicMock()
    mock_get_redis_client.return_value = mock_redis_client

    # Mock the RQ Queue and Job
    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = expected_job_id
    mock_job.get_status.return_value = expected_status
    mock_queue.enqueue.return_value = mock_job

    response = client.post(
        "/document/",
        json={
            "hub_id": expected_hub_id,
            "document_id": expected_document_id,
            "file_url": expected_file_url,
            "text": expected_text,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == expected_job_id
    assert data["status"] == expected_status

    mock_queue.enqueue.assert_called_once()
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][0].__name__ == "process_document"
    assert call_args[0][1] == expected_hub_id
    assert call_args[0][2] == expected_document_id
    assert call_args[0][3] == expected_file_url
    assert call_args[0][4] == expected_text
    assert call_args[0][5] == "", 'original_url should default to ""'
    assert call_args[0][6] == "", 'title should default to ""'
    assert call_args[0][7] == "", 'published_at should default to ""'
    assert call_args[0][8] == "", 'callback_url should default to ""'
    assert call_args[0][9] == 1, "priority_tier should default to 1"
    assert call_args[0][10] == [], "existing_topics should default to []"
    assert call_args[0][11] is False, "text_is_markdown should default to False"
    assert call_args[0][12] == "", "document_type should default to empty"


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_index_document_endpoint_passes_explicit_priority_tier(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    expected_job_id = uuid4().hex

    mock_config_instance = mock_config.return_value
    mock_config_instance.rq_retry_max = 5

    mock_redis_client = MagicMock()
    mock_get_redis_client.return_value = mock_redis_client

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = expected_job_id
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    response = client.post(
        "/document/",
        json={
            "hub_id": 1,
            "document_id": "doc-tier-2",
            "file_url": "",
            "text": "tiered content",
            "priority_tier": 2,
        },
    )

    assert response.status_code == 200
    assert response.json()["id"] == expected_job_id

    call_args = mock_queue.enqueue.call_args
    assert call_args[0][9] == 2


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_index_document_endpoint_forwards_existing_topics(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    mock_config.return_value.rq_retry_max = 5
    mock_get_redis_client.return_value = MagicMock()

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = uuid4().hex
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    response = client.post(
        "/document/",
        json={
            "hub_id": 1,
            "document_id": "doc-topics",
            "file_url": "",
            "text": "content with topics",
            "existing_topics": ["Elections", "Climate Policy"],
        },
    )

    assert response.status_code == 200
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][10] == ["Elections", "Climate Policy"]


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_index_document_endpoint_forwards_text_is_markdown(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    mock_config.return_value.rq_retry_max = 5
    mock_get_redis_client.return_value = MagicMock()

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = uuid4().hex
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    response = client.post(
        "/document/",
        json={
            "hub_id": 1,
            "document_id": "doc-markdown",
            "file_url": "",
            "text": "# Heading\n\nSome markdown content",
            "text_is_markdown": True,
        },
    )

    assert response.status_code == 200
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][11] is True


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_index_document_endpoint_forwards_document_type(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    mock_config.return_value.rq_retry_max = 5
    mock_get_redis_client.return_value = MagicMock()

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = uuid4().hex
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    response = client.post(
        "/document/",
        json={
            "hub_id": 1,
            "document_id": "doc-contribution",
            "file_url": "",
            "text": "editorial content",
            "document_type": "contribution",
        },
    )

    assert response.status_code == 200
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][12] == "contribution"


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_index_document_endpoint_forwards_summary(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    mock_config.return_value.rq_retry_max = 5
    mock_get_redis_client.return_value = MagicMock()

    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = uuid4().hex
    mock_job.get_status.return_value = "queued"
    mock_queue.enqueue.return_value = mock_job

    response = client.post(
        "/document/",
        json={
            "hub_id": 1,
            "document_id": "doc-with-summary",
            "file_url": "https://example.com/file.pdf",
            "text": "",
            "summary": "Context from the team",
        },
    )

    assert response.status_code == 200
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][13] == "Context from the team"


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_index_document_rejects_invalid_document_type(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    response = client.post(
        "/document/",
        json={
            "hub_id": 1,
            "document_id": "doc-invalid-type",
            "file_url": "",
            "text": "content",
            "document_type": "article",
        },
    )

    assert response.status_code == 422
    mock_queue_class.assert_not_called()


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
def test_get_job_status_success(
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    job_id = uuid4().hex
    expected_status = "finished"

    # Mock the Redis client
    mock_redis_client = MagicMock()
    mock_get_redis_client.return_value = mock_redis_client

    # Mock the Queue and Job
    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = job_id
    mock_job.get_status.return_value = expected_status
    mock_queue.fetch_job.return_value = mock_job

    response = client.get(f"/document/{job_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == job_id
    assert data["status"] == expected_status

    mock_queue.fetch_job.assert_called_once_with(job_id)


@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
def test_get_job_status_not_found(
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
) -> None:
    job_id = uuid4().hex

    # Mock the Redis client
    mock_redis_client = MagicMock()
    mock_get_redis_client.return_value = mock_redis_client

    # Mock the Queue to return None (job not found in both queues)
    mock_queue = mock_queue_class.return_value
    mock_queue.fetch_job.return_value = None

    response = client.get(f"/document/{job_id}")

    assert response.status_code == 404
    data = response.json()
    assert data["detail"] == "Job not found"

    # Job should be searched in both ingestion and removal queues
    assert mock_queue.fetch_job.call_count == 2


def _mock_topics_driver(mock_neo4j_client_class: MagicMock) -> MagicMock:
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=MagicMock())
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    return mock_driver


@patch("app.routes.document.Neo4jClient")
@patch("app.routes.document.Document")
def test_update_topics_endpoint_success(mock_document_class: MagicMock, mock_neo4j_client_class: MagicMock) -> None:
    _mock_topics_driver(mock_neo4j_client_class)
    mock_document_class.return_value.set_topics.return_value = True

    response = client.put(
        "/document/topics/", json={"hub_id": 3, "document_id": "doc1", "topics": ["Elections", "Public Health"]}
    )

    assert response.status_code == 200
    assert response.json() == {"updated": True, "error": None}
    mock_neo4j_client_class.return_value.get_driver.assert_called_once_with(3)
    assert mock_document_class.call_args[0][1] == 3
    mock_document_class.return_value.set_topics.assert_called_once_with("doc1", ["Elections", "Public Health"])


@patch("app.routes.document.Neo4jClient")
@patch("app.routes.document.Document")
def test_update_topics_endpoint_document_not_found(
    mock_document_class: MagicMock, mock_neo4j_client_class: MagicMock
) -> None:
    _mock_topics_driver(mock_neo4j_client_class)
    mock_document_class.return_value.set_topics.return_value = False

    response = client.put("/document/topics/", json={"hub_id": 3, "document_id": "missing", "topics": []})

    assert response.status_code == 404
    assert response.json() == {"updated": False, "error": "Document not found"}


@patch("app.routes.document.Neo4jClient")
@patch("app.routes.document.Document")
def test_update_topics_endpoint_neo4j_failure(
    mock_document_class: MagicMock, mock_neo4j_client_class: MagicMock
) -> None:
    _mock_topics_driver(mock_neo4j_client_class)
    mock_document_class.return_value.set_topics.side_effect = Exception("boom")

    response = client.put("/document/topics/", json={"hub_id": 3, "document_id": "doc1", "topics": ["Elections"]})

    assert response.status_code == 500
    assert response.json() == {"updated": False, "error": "Failed to update document topics"}


@patch("app.routes.document.Neo4jClient")
def test_update_topics_endpoint_rejects_non_positive_hub_id(mock_neo4j_client_class: MagicMock) -> None:
    response = client.put("/document/topics/", json={"hub_id": 0, "document_id": "doc1", "topics": []})

    assert response.status_code == 422
    assert response.json() == {"updated": False, "error": "hub_id must be a positive integer"}
    mock_neo4j_client_class.return_value.get_driver.assert_not_called()


@pytest.mark.parametrize(
    "body",
    [
        {"hub_id": 3, "document_id": "doc1"},
        {"hub_id": 3, "document_id": "doc1", "topics": "Elections"},
    ],
)
@patch("app.routes.document.Neo4jClient")
def test_update_topics_endpoint_rejects_invalid_payload(
    mock_neo4j_client_class: MagicMock, body: dict[str, Any]
) -> None:
    response = client.put("/document/topics/", json=body)

    assert response.status_code == 422
    mock_neo4j_client_class.return_value.get_driver.assert_not_called()


@patch("app.routes.document.Neo4jClient")
@patch("app.routes.document.Document")
@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_delete_endpoint_success(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
    mock_document_class: MagicMock,
    mock_neo4j_client_class: MagicMock,
) -> None:
    expected_job_id = uuid4().hex
    expected_status = "queued"

    # Mock the config
    mock_config_instance = mock_config.return_value
    mock_config_instance.rq_job_timeout = 1800

    # Mock the Redis client
    mock_redis_client = MagicMock()
    mock_get_redis_client.return_value = mock_redis_client

    # Mock Neo4j client and Document service
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_document = mock_document_class.return_value
    mock_document.exists.return_value = True

    # Mock the RQ Queue and Job
    mock_queue = mock_queue_class.return_value
    mock_job = MagicMock()
    mock_job.id = expected_job_id
    mock_job.get_status.return_value = expected_status
    mock_queue.enqueue.return_value = mock_job

    response = client.request("DELETE", "/document/", json={"hub_id": 1, "document_id": "test_doc_id"})

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == expected_job_id
    assert data["status"] == expected_status

    mock_document.exists.assert_called_once_with("test_doc_id")
    mock_queue.enqueue.assert_called_once()
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][0].__name__ == "remove_document"
    assert call_args[0][1] == 1  # hub_id
    assert call_args[0][2] == "test_doc_id"  # document_id


@patch("app.routes.document.Neo4jClient")
@patch("app.routes.document.Document")
@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_delete_endpoint_document_not_found(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
    mock_document_class: MagicMock,
    mock_neo4j_client_class: MagicMock,
) -> None:
    # Mock the config
    mock_config_instance = mock_config.return_value
    mock_config_instance.rq_job_timeout = 1800

    # Mock the Redis client
    mock_redis_client = MagicMock()
    mock_get_redis_client.return_value = mock_redis_client

    # Mock Neo4j client and Document service - document does not exist
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_document = mock_document_class.return_value
    mock_document.exists.return_value = False

    response = client.request("DELETE", "/document/", json={"hub_id": 1, "document_id": "nonexistent_doc"})

    assert response.status_code == 204

    mock_document.exists.assert_called_once_with("nonexistent_doc")
    mock_queue_class.return_value.enqueue.assert_not_called()


@patch("app.routes.document.Neo4jClient")
@patch("app.routes.document.Document")
@patch("app.routes.document.Queue")
@patch("app.routes.document.get_redis_client")
@patch("app.routes.document.Config")
def test_delete_endpoint_exception(
    mock_config: MagicMock,
    mock_get_redis_client: MagicMock,
    mock_queue_class: MagicMock,
    mock_document_class: MagicMock,
    mock_neo4j_client_class: MagicMock,
) -> None:
    # Mock the config
    mock_config_instance = mock_config.return_value
    mock_config_instance.rq_job_timeout = 1800

    # Mock the Redis client
    mock_redis_client = MagicMock()
    mock_get_redis_client.return_value = mock_redis_client

    # Mock Neo4j client and Document service
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_document = mock_document_class.return_value
    mock_document.exists.return_value = True

    # Mock the Queue to raise an exception when enqueue is called
    mock_queue = mock_queue_class.return_value
    mock_queue.enqueue.side_effect = Exception("Redis connection failed")

    response = client.request("DELETE", "/document/", json={"hub_id": 1, "document_id": "test_doc_id"})

    assert response.status_code == 400
    assert "Deletion for document_id test_doc_id failed: Redis connection failed" in response.json()["detail"]


@patch("app.routes.summarize.Summarizer")
def test_summarize_endpoint_single_text(mock_summarizer_class: MagicMock) -> None:
    mock_summarizer = mock_summarizer_class.return_value
    mock_summarizer.run = MagicMock(return_value="This is a concise summary of the text.")

    response = client.post(
        "/summarize/",
        json={"texts": ["This is a long text that needs to be summarized. It contains important information."]},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["summary"] == "This is a concise summary of the text."
    assert "metadata" in data
    assert data["metadata"]["texts_count"] == 1
    assert data["metadata"]["total_characters"] > 0
    assert data["metadata"]["summary_length"] > 0
    assert data["metadata"]["processing_time_seconds"] >= 0


@patch("app.routes.summarize.Summarizer")
def test_summarize_endpoint_multiple_texts(mock_summarizer_class: MagicMock) -> None:
    mock_summarizer = mock_summarizer_class.return_value
    mock_summarizer.run = MagicMock(return_value="This is a summary of all the texts combined.")

    response = client.post(
        "/summarize/",
        json={
            "texts": [
                "First text with some content.",
                "Second text with more information.",
                "Third text with additional details.",
            ]
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["summary"] == "This is a summary of all the texts combined."
    assert data["metadata"]["texts_count"] == 3


@patch("app.routes.summarize.language.detect_text", new_callable=AsyncMock)
@patch("app.routes.summarize.Summarizer")
def test_summarize_endpoint_detects_language_when_not_provided(
    mock_summarizer_class: MagicMock, mock_detect_text: AsyncMock
) -> None:
    mock_detect_text.return_value = ("fr", 0.95)
    mock_summarizer = mock_summarizer_class.return_value
    mock_summarizer.run = MagicMock(return_value="Résumé du texte.")

    response = client.post(
        "/summarize/",
        json={"texts": ["Ceci est un texte en français à résumer."]},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["metadata"]["language"] == "fr"
    mock_detect_text.assert_called_once()
    mock_summarizer_class.assert_called_once_with(
        ["Ceci est un texte en français à résumer."], language="fr", markdown=True
    )


@patch("app.routes.summarize.language.detect_text", new_callable=AsyncMock)
@patch("app.routes.summarize.Summarizer")
def test_summarize_endpoint_detected_language_overrides_default_language(
    mock_summarizer_class: MagicMock, mock_detect_text: AsyncMock
) -> None:
    mock_detect_text.return_value = ("fr", 0.95)
    mock_summarizer = mock_summarizer_class.return_value
    mock_summarizer.run = MagicMock(return_value="Résumé du texte.")

    response = client.post(
        "/summarize/",
        json={"texts": ["Ceci est un texte en français à résumer."], "default_language": "es"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["metadata"]["language"] == "fr"
    mock_detect_text.assert_called_once()
    mock_summarizer_class.assert_called_once_with(
        ["Ceci est un texte en français à résumer."], language="fr", markdown=True
    )


@patch("app.routes.summarize.language.detect_text", new_callable=AsyncMock)
@patch("app.routes.summarize.Summarizer")
def test_summarize_endpoint_falls_back_to_default_language_when_detection_fails(
    mock_summarizer_class: MagicMock, mock_detect_text: AsyncMock
) -> None:
    mock_detect_text.return_value = (None, 0.0)
    mock_summarizer = mock_summarizer_class.return_value
    mock_summarizer.run = MagicMock(return_value="This is a summary.")

    response = client.post(
        "/summarize/",
        json={"texts": ["Some English text to summarize."], "default_language": "es"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["metadata"]["language"] == "es"
    mock_detect_text.assert_called_once()
    mock_summarizer_class.assert_called_once_with(["Some English text to summarize."], language="es", markdown=True)


@patch("app.routes.summarize.Summarizer")
def test_summarize_endpoint_exception(mock_summarizer_class: MagicMock) -> None:
    mock_summarizer = mock_summarizer_class.return_value
    mock_summarizer.run.side_effect = Exception("LLM call failed")

    response = client.post(
        "/summarize/",
        json={"texts": ["Some text to summarize"]},
    )

    assert response.status_code == 400
    assert "Summarization failed: LLM call failed" in response.json()["detail"]


def test_summarize_endpoint_empty_texts_list() -> None:
    response = client.post(
        "/summarize/",
        json={"texts": []},
    )

    assert response.status_code == 422  # Validation error


def test_summarize_endpoint_text_contains_empty_string() -> None:
    response = client.post(
        "/summarize/",
        json={"texts": ["Valid text", "", "Another valid text"]},
    )

    assert response.status_code == 422  # Validation error
    data = response.json()
    assert "texts list cannot contain empty strings" in str(data)


def test_summarize_endpoint_exceeds_character_limit() -> None:
    # Create a text that exceeds 50K characters
    large_text = "a" * 51000

    response = client.post(
        "/summarize/",
        json={"texts": [large_text]},
    )

    assert response.status_code == 422  # Validation error
    data = response.json()
    assert "exceeds maximum of 50,000 characters" in str(data)


def test_summarize_endpoint_exceeds_item_limit() -> None:
    # Create 101 texts
    texts = [f"Text number {i}" for i in range(101)]

    response = client.post(
        "/summarize/",
        json={"texts": texts},
    )

    assert response.status_code == 422  # Validation error


@patch("app.routes.summarize.Summarizer")
@patch("app.services.document.Neo4jClient")
def test_summarize_endpoint_reads_text_from_neo4j(
    mock_neo4j_client_class: MagicMock, mock_summarizer_class: MagicMock
) -> None:
    with patch("app.services.document.Document.get_text", return_value="reconstructed chunk text") as mock_get_text:
        mock_summarizer_class.return_value.run = MagicMock(return_value="Summary of the document.")

        response = client.post("/summarize/", json={"hub_id": 2, "document_id": "RG9jdW1lbnQvMQ=="})

        assert response.status_code == 200
        assert response.json()["summary"] == "Summary of the document."
        mock_neo4j_client_class.return_value.get_driver.assert_called_once_with(2)
        mock_get_text.assert_called_once_with("RG9jdW1lbnQvMQ==")
        mock_summarizer_class.assert_called_once()
        assert mock_summarizer_class.call_args.args == (["reconstructed chunk text"],)


@patch("app.routes.summarize.Summarizer")
@patch("app.services.document.Neo4jClient")
def test_summarize_endpoint_document_without_chunks_returns_empty(
    mock_neo4j_client_class: MagicMock, mock_summarizer_class: MagicMock
) -> None:
    with patch("app.services.document.Document.get_text", return_value=""):
        response = client.post("/summarize/", json={"hub_id": 1, "document_id": "RG9jdW1lbnQvMQ=="})

        assert response.status_code == 200
        assert response.json()["summary"] == ""
        mock_summarizer_class.assert_not_called()


@patch("app.routes.summarize.Summarizer")
def test_summarize_endpoint_no_texts_nor_document_returns_empty(mock_summarizer_class: MagicMock) -> None:
    response = client.post("/summarize/", json={"hub_id": 1})

    assert response.status_code == 200
    assert response.json()["summary"] == ""
    mock_summarizer_class.assert_not_called()


def test_summarize_endpoint_document_id_without_hub_id_returns_422() -> None:
    response = client.post("/summarize/", json={"document_id": "RG9jdW1lbnQvMQ=="})

    assert response.status_code == 422
    assert "hub_id is required when document_id is set" in str(response.json())


@patch("app.services.document.Neo4jClient")
def test_summarize_endpoint_neo4j_error_returns_400(mock_neo4j_client_class: MagicMock) -> None:
    mock_neo4j_client_class.return_value.get_driver.side_effect = Exception("connection refused")

    response = client.post("/summarize/", json={"hub_id": 1, "document_id": "RG9jdW1lbnQvMQ=="})

    assert response.status_code == 400


@patch("app.routes.summarize.Summarizer")
@patch("app.services.document.Neo4jClient")
def test_summarize_endpoint_document_exceeds_character_limit(
    mock_neo4j_client_class: MagicMock, mock_summarizer_class: MagicMock
) -> None:
    with patch("app.services.document.Document.get_text", return_value="a" * 51000):
        response = client.post("/summarize/", json={"hub_id": 1, "document_id": "RG9jdW1lbnQvMQ=="})

        assert response.status_code == 422
        assert "exceeds maximum of 50,000 characters" in response.json()["detail"]
        mock_summarizer_class.assert_not_called()


@patch("app.routes.preview.generate_preview_response")
def test_preview_endpoint_basic(mock_generate: MagicMock) -> None:
    mock_generate.return_value = "I'm TestBot. I help users find information."

    response = client.post(
        "/preview/",
        json={
            "scenario": "role_description",
            "personalization": {
                "name": "TestBot",
                "description": "I help users find information.",
                "tone": "journalist",
            },
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "I'm TestBot. I help users find information."
    mock_generate.assert_called_once()


@patch("app.routes.preview.generate_preview_response")
def test_preview_endpoint_all_scenarios(mock_generate: MagicMock) -> None:
    mock_generate.return_value = "Preview response"
    scenarios = ["role_description", "unanswerable_question", "error_occurred"]

    for scenario in scenarios:
        response = client.post(
            "/preview/",
            json={
                "scenario": scenario,
                "personalization": {"name": "TestBot", "tone": "journalist"},
            },
        )
        assert response.status_code == 200, f"Failed for scenario: {scenario}"
        data = response.json()
        assert "answer" in data


@patch("app.routes.preview.generate_preview_response")
def test_preview_endpoint_empty_answer_is_an_error(mock_generate: MagicMock) -> None:
    mock_generate.return_value = ""

    response = client.post(
        "/preview/",
        json={"scenario": "conversation_closed", "personalization": {"name": "TestBot"}},
    )

    assert response.status_code == 502


def test_preview_endpoint_invalid_scenario() -> None:
    response = client.post(
        "/preview/",
        json={
            "scenario": "invalid_scenario",
            "personalization": {"name": "TestBot"},
        },
    )
    assert response.status_code == 422


@patch("app.routes.embed.EmbedderFactory")
def test_embed_endpoint_success(mock_factory: MagicMock) -> None:
    mock_embedder = MagicMock()
    mock_embedder.embed_query.return_value = [0.1, 0.2, 0.3]
    mock_factory.get_embed_api_embedder.return_value = mock_embedder

    response = client.post("/embed/", json={"text": "test text"})

    assert response.status_code == 200
    data = response.json()
    assert data["embedding"] == [0.1, 0.2, 0.3]
    assert data["error_type"] is None
    mock_embedder.embed_query.assert_called_once_with("test text")


@patch("app.routes.embed.EmbedderFactory")
@patch("app.routes.embed._get_max_text_length", return_value=100)
def test_embed_endpoint_text_too_long(mock_max_length: MagicMock, mock_factory: MagicMock) -> None:
    long_text = "x" * 150

    response = client.post("/embed/", json={"text": long_text})

    assert response.status_code == 422
    data = response.json()
    assert data["error_type"] == "QUESTION_TOO_LONG"
    assert data["embedding"] is None


@patch("app.routes.embed.EmbedderFactory")
@patch("app.routes.embed._get_max_text_length", return_value=5000)
def test_embed_endpoint_embedder_error(mock_max_length: MagicMock, mock_factory: MagicMock) -> None:
    from app.core.errors import EmbeddingTextTooLongError

    mock_embedder = MagicMock()
    mock_embedder.embed_query.side_effect = EmbeddingTextTooLongError("Cohere limit exceeded")
    mock_factory.get_embed_api_embedder.return_value = mock_embedder

    response = client.post("/embed/", json={"text": "some text"})

    assert response.status_code == 422
    data = response.json()
    assert data["error_type"] == "QUESTION_TOO_LONG"
    assert data["embedding"] is None


@patch("app.routes.topics.TopicExtractor")
def test_topics_endpoint_with_text(mock_extractor_class: MagicMock) -> None:
    mock_extractor_class.return_value.extract = AsyncMock(return_value=["Elections", "Climate Policy"])

    response = client.post(
        "/topics/",
        json={"hub_id": 1, "text": "A long article about the general election", "existing_topics": ["Elections"]},
    )

    assert response.status_code == 200
    assert response.json()["topics"] == ["Elections", "Climate Policy"]
    mock_extractor_class.return_value.extract.assert_called_once_with(
        "A long article about the general election", ["Elections"]
    )


@patch("app.routes.topics.TopicExtractor")
@patch("app.services.document.Neo4jClient")
def test_topics_endpoint_reads_text_from_neo4j(
    mock_neo4j_client_class: MagicMock, mock_extractor_class: MagicMock
) -> None:
    with patch("app.services.document.Document.get_text", return_value="reconstructed chunk text") as mock_get_text:
        mock_extractor_class.return_value.extract = AsyncMock(return_value=["Health"])

        response = client.post("/topics/", json={"hub_id": 2, "document_id": "RG9jdW1lbnQvMQ=="})

        assert response.status_code == 200
        assert response.json()["topics"] == ["Health"]
        mock_get_text.assert_called_once_with("RG9jdW1lbnQvMQ==")
        mock_extractor_class.return_value.extract.assert_called_once_with("reconstructed chunk text", [])


def test_topics_endpoint_no_text_returns_empty() -> None:
    response = client.post("/topics/", json={"hub_id": 1})
    assert response.status_code == 200
    assert response.json()["topics"] == []


@patch("app.services.document.Neo4jClient")
def test_topics_endpoint_neo4j_error_returns_400(mock_neo4j_client_class: MagicMock) -> None:
    mock_neo4j_client_class.return_value.get_driver.side_effect = Exception("connection refused")

    response = client.post("/topics/", json={"hub_id": 1, "document_id": "RG9jdW1lbnQvMQ=="})

    assert response.status_code == 400


@patch("app.routes.language.detect_message", new_callable=AsyncMock, return_value=("es", 0.95))
def test_language_endpoint_passes_hub_languages_as_context(mock_detect: AsyncMock) -> None:
    response = client.post(
        "/language",
        json={"text": "hola, una pregunta", "default_language": "en", "supported_languages": ["en", "es"]},
    )
    assert response.status_code == 200
    assert response.json() == {"language": "es"}
    _, context = mock_detect.call_args.args
    assert context.default_language == "en"
    assert context.supported_languages == ("en", "es")


@patch("app.routes.language.detect_message", new_callable=AsyncMock, return_value=None)
def test_language_endpoint_returns_null_when_undetected(mock_detect: AsyncMock) -> None:
    response = client.post("/language", json={"text": "123"})
    assert response.status_code == 200
    assert response.json() == {"language": None}
