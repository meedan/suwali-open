from unittest.mock import MagicMock, patch

import pytest

from app.tasks.callback import dispatch_callback
from app.tasks.document import remove_document


@pytest.mark.asyncio
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_success(mock_neo4j_client_class: MagicMock) -> None:
    hub_id = 1
    document_id = "test_doc_123"

    # Mock Neo4j driver and session
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session

    # Mock the document deletion query result
    mock_delete_result = MagicMock()
    mock_delete_record = MagicMock()
    mock_delete_record.__getitem__.return_value = 1  # deletedCount = 1
    mock_delete_record.data.return_value = {"deletedCount": 1}
    mock_delete_result.single.return_value = mock_delete_record

    # Configure session.run to return the delete result
    mock_session.run.return_value = mock_delete_result

    # Execute the function
    await remove_document(hub_id, document_id)

    # Verify Neo4jClient was instantiated and get_driver was called
    mock_neo4j_client_class.assert_called_once()
    mock_neo4j_client_class.return_value.get_driver.assert_called_once_with(hub_id)

    # Verify session was created
    mock_driver.session.assert_called_once()

    # Verify the deletion query was executed
    assert mock_session.run.call_count == 1

    # Verify the document deletion query
    call_args = mock_session.run.call_args
    assert f"MATCH (d:Document_{hub_id}" in call_args[0][0]
    assert "DETACH DELETE d, c" in call_args[0][0]
    # Parameters are passed as second positional argument
    assert call_args[0][1]["document_id"] == document_id


@pytest.mark.asyncio
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_not_found(mock_neo4j_client_class: MagicMock) -> None:
    hub_id = 2
    document_id = "nonexistent_doc"

    # Mock Neo4j driver and session
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session

    # Mock the document deletion query result (no documents deleted)
    mock_delete_result = MagicMock()
    mock_delete_record = MagicMock()
    mock_delete_record.__getitem__.return_value = 0  # deletedCount = 0
    mock_delete_record.data.return_value = {"deletedCount": 0}
    mock_delete_result.single.return_value = mock_delete_record

    # Configure session.run to return the delete result
    mock_session.run.return_value = mock_delete_result

    # Execute the function (should not raise exception)
    await remove_document(hub_id, document_id)

    # Verify the deletion query was executed
    assert mock_session.run.call_count == 1


@pytest.mark.asyncio
@patch("app.tasks.document.Document")
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_query_exception(
    mock_neo4j_client_class: MagicMock, mock_document_class: MagicMock
) -> None:
    hub_id = 3
    document_id = "test_doc_456"

    # Mock Neo4j driver and session
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session

    # Configure Document.remove to raise an exception
    mock_document_instance = MagicMock()
    mock_document_instance.remove.side_effect = Exception("Database connection failed")
    mock_document_class.return_value = mock_document_instance

    # Execute the function (should catch exception and not re-raise)
    await remove_document(hub_id, document_id)

    # Verify Neo4jClient was called
    mock_neo4j_client_class.assert_called_once()
    mock_neo4j_client_class.return_value.get_driver.assert_called_once_with(hub_id)

    # Verify session was created
    mock_driver.session.assert_called_once()

    # Verify Document was instantiated and remove was called
    mock_document_class.assert_called_once_with(mock_session, hub_id)
    mock_document_instance.remove.assert_called_once_with(document_id)


@pytest.mark.asyncio
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_session_run_exception(
    mock_neo4j_client_class: MagicMock,
) -> None:
    hub_id = 4
    document_id = "test_doc_789"

    # Mock Neo4j driver and session
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session

    # Configure session.run to raise an exception
    mock_session.run.side_effect = Exception("Database query failed")

    # Execute the function (should catch exception and not re-raise)
    await remove_document(hub_id, document_id)

    # Verify the deletion query was attempted
    assert mock_session.run.call_count == 1


@pytest.mark.asyncio
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_with_chunks(mock_neo4j_client_class: MagicMock) -> None:
    hub_id = 5
    document_id = "test_doc_abc"

    # Mock Neo4j driver and session
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session

    # Mock the document deletion query result (document with chunks deleted)
    mock_delete_result = MagicMock()
    mock_delete_record = MagicMock()
    mock_delete_record.__getitem__.return_value = 1  # deletedCount = 1
    mock_delete_record.data.return_value = {"deletedCount": 1}
    mock_delete_result.single.return_value = mock_delete_record

    # Configure session.run to return the delete result
    mock_session.run.return_value = mock_delete_result

    # Execute the function
    await remove_document(hub_id, document_id)

    # Verify the deletion query was executed
    assert mock_session.run.call_count == 1

    # Verify the query includes chunk deletion
    call_args = mock_session.run.call_args
    assert "FROM_DOCUMENT" in call_args[0][0]
    assert f"Chunk_{hub_id}" in call_args[0][0]


@pytest.mark.asyncio
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_no_delete_record(mock_neo4j_client_class: MagicMock) -> None:
    hub_id = 6
    document_id = "test_doc_xyz"

    # Mock Neo4j driver and session
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session

    # Mock the document deletion query result (returns None)
    mock_delete_result = MagicMock()
    mock_delete_result.single.return_value = None

    # Configure session.run to return the delete result
    mock_session.run.return_value = mock_delete_result

    # Execute the function (should handle None record gracefully)
    await remove_document(hub_id, document_id)

    # Verify the deletion query was executed
    assert mock_session.run.call_count == 1


@pytest.mark.asyncio
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_driver_exception(mock_neo4j_client_class: MagicMock) -> None:
    hub_id = 7
    document_id = "test_doc_def"

    # Configure Neo4jClient to raise an exception when getting driver
    mock_neo4j_client_class.return_value.get_driver.side_effect = Exception("Failed to get driver")

    # Execute the function (should catch exception and not re-raise)
    await remove_document(hub_id, document_id)

    # Verify Neo4jClient was called
    mock_neo4j_client_class.assert_called_once()
    mock_neo4j_client_class.return_value.get_driver.assert_called_once_with(hub_id)


########################################################################
# Callback enqueueing
########################################################################


@pytest.mark.asyncio
@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_enqueues_callback_on_success(
    mock_neo4j_client_class: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    hub_id = 1
    document_id = "test_doc_cb_success"
    callback_url = "http://example.com/callback"

    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session
    mock_config.return_value.rq_retry_max = 3

    await remove_document(hub_id, document_id, callback_url=callback_url)

    mock_queue_instance = mock_queue_class.return_value
    mock_queue_instance.enqueue.assert_called_once()
    enqueue_args = mock_queue_instance.enqueue.call_args[0]
    assert enqueue_args[0] is dispatch_callback
    assert enqueue_args[1] == callback_url
    assert enqueue_args[2] == {"success": True, "topics": []}


@pytest.mark.asyncio
@patch("app.services.callback_service.Config")
@patch("app.services.callback_service.get_redis_client")
@patch("app.services.callback_service.Queue")
@patch("app.tasks.document.Document")
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_enqueues_callback_on_failure(
    mock_neo4j_client_class: MagicMock,
    mock_document_class: MagicMock,
    mock_queue_class: MagicMock,
    mock_get_redis: MagicMock,
    mock_config: MagicMock,
) -> None:
    hub_id = 1
    document_id = "test_doc_cb_fail"
    callback_url = "http://example.com/callback"

    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session
    mock_document_class.return_value.remove.side_effect = Exception("DB error")
    mock_config.return_value.rq_retry_max = 3

    await remove_document(hub_id, document_id, callback_url=callback_url)

    enqueue_args = mock_queue_class.return_value.enqueue.call_args[0]
    assert enqueue_args[2] == {"success": False, "topics": []}


@pytest.mark.asyncio
@patch("app.tasks.document.Neo4jClient")
async def test_remove_document_no_callback_when_url_empty(mock_neo4j_client_class: MagicMock) -> None:
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_neo4j_client_class.return_value.get_driver.return_value = mock_driver
    mock_driver.session.return_value.__enter__.return_value = mock_session

    # No callback_url — Queue should never be instantiated (no Redis connection attempted)
    await remove_document(1, "test_doc_no_cb")
