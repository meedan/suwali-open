import os
from unittest.mock import MagicMock, patch

import pytest

from app.services.neo4j_pool_manager import (
    CONNECTION_ACQUISITION_TIMEOUT,
    CONNECTION_TIMEOUT,
    LIVENESS_CHECK_TIMEOUT,
    MAX_CONNECTION_LIFETIME,
    MAX_CONNECTION_POOL_SIZE,
)


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"1": {"uri": "bolt://localhost:7687", "username": "neo4j", "password": "password"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_get_driver(mock_text_index: MagicMock, mock_create_index: MagicMock, mock_driver: MagicMock) -> None:
    from app.services.neo4j_client import Neo4jClient
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    # Clear the pool manager's drivers for clean test
    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()

    client = Neo4jClient()
    driver = client.get_driver(1)

    assert driver == mock_instance
    mock_driver.assert_called_once_with(
        "bolt://localhost:7687",
        auth=("neo4j", "password"),
        max_connection_lifetime=MAX_CONNECTION_LIFETIME,
        connection_timeout=CONNECTION_TIMEOUT,
        connection_acquisition_timeout=CONNECTION_ACQUISITION_TIMEOUT,
        max_connection_pool_size=MAX_CONNECTION_POOL_SIZE,
        liveness_check_timeout=LIVENESS_CHECK_TIMEOUT,
    )
    mock_instance.verify_connectivity.assert_called()
    mock_create_index.assert_called_once()
    mock_text_index.assert_called_once()


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"1": {"uri": "bolt://localhost:7687", "username": "neo4j", "password": "password"}}'},
)
def test_close_driver() -> None:
    from app.services.neo4j_client import Neo4jClient
    from app.services.neo4j_pool_manager import neo4j_pool

    # Mock the pool manager's close method
    with patch.object(neo4j_pool, "close_hub_connection") as mock_close:
        client = Neo4jClient()
        client.close(1)
        mock_close.assert_called_once_with(1)


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_creates_driver_with_indexes(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    # Create a fresh pool manager instance for testing
    pool_manager = Neo4jPoolManager()

    # Clear any existing drivers for clean test
    pool_manager._drivers.clear()

    driver = pool_manager.get_driver(2)

    assert driver == mock_instance
    mock_driver.assert_called_once_with(
        "bolt://localhost:7688",
        auth=("neo4j", "password2"),
        max_connection_lifetime=MAX_CONNECTION_LIFETIME,
        connection_timeout=CONNECTION_TIMEOUT,
        connection_acquisition_timeout=CONNECTION_ACQUISITION_TIMEOUT,
        max_connection_pool_size=MAX_CONNECTION_POOL_SIZE,
        liveness_check_timeout=LIVENESS_CHECK_TIMEOUT,
    )
    mock_instance.verify_connectivity.assert_called()
    mock_vector_index.assert_called_once()
    mock_text_index.assert_called_once()


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_ensures_recency_prefilter_indexes(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()

    pool_manager.get_driver(2)

    run_queries = [call.args[0] for call in mock_session.run.call_args_list]
    assert any(
        "CREATE INDEX chunk_published_at_index_2 IF NOT EXISTS" in q and "FOR (c:Chunk_2) ON (c.published_at)" in q
        for q in run_queries
    )
    assert any(
        "CREATE INDEX chunk_priority_tier_index_2 IF NOT EXISTS" in q and "FOR (c:Chunk_2) ON (c.priority_tier)" in q
        for q in run_queries
    )
    assert any(
        "CREATE CONSTRAINT topic_name_unique_2 IF NOT EXISTS" in q and "FOR (t:Topic_2) REQUIRE t.name IS UNIQUE" in q
        for q in run_queries
    )


def _neo4j_client_error(code: str) -> Exception:
    from neo4j.exceptions import Neo4jError

    return Neo4jError._hydrate_neo4j(code=code, message="test error")


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_ensure_indexes_tolerates_concurrent_range_index_creation(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    """A worker that loses the CREATE INDEX IF NOT EXISTS race gets EquivalentSchemaRuleAlreadyExists;
    the index exists, so ensure_indexes_for_hub must carry on with the remaining statements."""
    from app.services.neo4j_pool_manager import EQUIVALENT_SCHEMA_RULE_EXISTS, Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session
    mock_session.run.return_value.consume.side_effect = _neo4j_client_error(EQUIVALENT_SCHEMA_RULE_EXISTS)

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()
    pool_manager._drivers[2] = mock_instance

    pool_manager.ensure_indexes_for_hub(2)

    assert mock_session.run.call_count == 4


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_ensure_indexes_raises_other_range_index_errors(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    from neo4j.exceptions import ClientError

    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session
    mock_session.run.return_value.consume.side_effect = _neo4j_client_error("Neo.ClientError.Statement.SyntaxError")

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()
    pool_manager._drivers[2] = mock_instance

    with pytest.raises(ClientError):
        pool_manager.ensure_indexes_for_hub(2)


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_ensure_indexes_retries_schema_statement_after_deadlock(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    """Workers racing to create a new constraint can deadlock on the label lock; the loser retries once
    and carries on with the remaining statements."""
    from app.services.neo4j_pool_manager import DEADLOCK_DETECTED, Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session
    mock_session.run.return_value.consume.side_effect = [_neo4j_client_error(DEADLOCK_DETECTED), None, None, None, None]

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()
    pool_manager._drivers[2] = mock_instance

    pool_manager.ensure_indexes_for_hub(2)

    run_queries = [call.args[0] for call in mock_session.run.call_args_list]
    assert len(run_queries) == 5
    assert run_queries[0] == run_queries[1]


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_ensure_indexes_raises_repeated_deadlock(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    from neo4j.exceptions import TransientError

    from app.services.neo4j_pool_manager import DEADLOCK_DETECTED, Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session
    mock_session.run.return_value.consume.side_effect = _neo4j_client_error(DEADLOCK_DETECTED)

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()
    pool_manager._drivers[2] = mock_instance

    with pytest.raises(TransientError):
        pool_manager.ensure_indexes_for_hub(2)

    assert mock_session.run.call_count == 2


@patch.dict(
    os.environ,
    {
        "NEO4J_HUB_CONFIG": '{"3":{"uri": "bolt://localhost:7689", "username": "neo4j", "password": "password3"}}',
        "NEO4J_HUB_DEFAULT_CONFIG": '{"uri": "bolt://localhost:7700", "username": "neo4j", "password": "default"}',
    },
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_falls_back_to_default_config(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()

    # hub_id 999 is not in NEO4J_HUB_CONFIG, so it should fall back to NEO4J_HUB_DEFAULT_CONFIG
    driver = pool_manager.get_driver(999)

    assert driver == mock_instance
    mock_driver.assert_called_once_with(
        "bolt://localhost:7700",
        auth=("neo4j", "default"),
        max_connection_lifetime=MAX_CONNECTION_LIFETIME,
        connection_timeout=CONNECTION_TIMEOUT,
        connection_acquisition_timeout=CONNECTION_ACQUISITION_TIMEOUT,
        max_connection_pool_size=MAX_CONNECTION_POOL_SIZE,
        liveness_check_timeout=LIVENESS_CHECK_TIMEOUT,
    )


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
def test_pool_manager_ensure_indexes_for_hub_recreates_on_cached_driver(
    mock_text_index: MagicMock, mock_vector_index: MagicMock, mock_driver: MagicMock
) -> None:
    """ensure_indexes_for_hub must re-run index creation even when a driver is already cached,
    since a cached driver alone doesn't guarantee the index still exists in Neo4j."""
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()

    # First call creates and caches the driver, running index creation once.
    pool_manager.get_driver(2)
    assert mock_vector_index.call_count == 1

    # A second, explicit call must recreate indexes even though the driver is cached.
    pool_manager.ensure_indexes_for_hub(2)
    assert mock_vector_index.call_count == 2
    assert mock_text_index.call_count == 2
    mock_driver.assert_called_once()  # driver itself is not recreated


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.drop_index_if_exists")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
@patch("app.services.neo4j_pool_manager.retrieve_vector_index_info")
def test_pool_manager_recreates_vector_index_missing_filterable_properties(
    mock_retrieve_vector_index: MagicMock,
    mock_text_index: MagicMock,
    mock_vector_index: MagicMock,
    mock_drop_index: MagicMock,
    mock_driver: MagicMock,
) -> None:
    """An existing vector index that predates filterable_properties support must be
    dropped and recreated so ``published_at`` filtering can use in-index search."""
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    # Simulate an existing index whose options don't declare published_at as filterable.
    mock_retrieve_vector_index.return_value = {"properties": ["embedding"]}

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()

    pool_manager.get_driver(2)

    mock_drop_index.assert_called_once_with(mock_instance, "text_vectors_2")
    mock_vector_index.assert_called_once()
    assert mock_vector_index.call_args.kwargs["filterable_properties"] == ["published_at"]


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"2": {"uri": "bolt://localhost:7688", "username": "neo4j", "password": "password2"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.drop_index_if_exists")
@patch("app.services.neo4j_pool_manager.create_vector_index")
@patch("app.services.neo4j_pool_manager.create_fulltext_index")
@patch("app.services.neo4j_pool_manager.retrieve_vector_index_info")
def test_pool_manager_keeps_vector_index_with_filterable_properties(
    mock_retrieve_vector_index: MagicMock,
    mock_text_index: MagicMock,
    mock_vector_index: MagicMock,
    mock_drop_index: MagicMock,
    mock_driver: MagicMock,
) -> None:
    """An existing vector index that already declares published_at as filterable
    must not be dropped/recreated."""
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    mock_retrieve_vector_index.return_value = {"properties": ["embedding", "published_at"]}

    pool_manager = Neo4jPoolManager()
    pool_manager._drivers.clear()

    pool_manager.get_driver(2)

    mock_drop_index.assert_not_called()
    mock_vector_index.assert_not_called()


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"1": {"uri": "bolt://localhost:7687", "username": "neo4j", "password": "password"}}'},
)
def test_client_ensure_indexes_delegates_to_pool() -> None:
    from app.services.neo4j_client import Neo4jClient
    from app.services.neo4j_pool_manager import neo4j_pool

    with patch.object(neo4j_pool, "ensure_indexes_for_hub") as mock_ensure:
        client = Neo4jClient()
        client.ensure_indexes(1)
        mock_ensure.assert_called_once_with(1)


def test_recover_missing_vector_index_recreates_indexes() -> None:
    """The shared recovery helper used by both Retriever and Ingestor must recreate the hub's
    indexes so callers can safely retry once."""
    from app.services.neo4j_client import Neo4jClient, recover_missing_vector_index

    error = Exception("There is no such vector schema index: text_vectors_1")
    with patch.object(Neo4jClient, "ensure_indexes") as mock_ensure:
        recover_missing_vector_index(1, error, "test context")
        mock_ensure.assert_called_once_with(1)


@patch.dict(
    os.environ,
    {
        "NEO4J_HUB_CONFIG": '{"3": {"uri": "bolt://localhost:7689", "username": "neo4j", "password": "password3"}}',
        "NEO4J_HUB_DEFAULT_CONFIG": "",
    },
)
def test_pool_manager_missing_hub_config_and_no_default() -> None:
    import pytest

    from app.services.neo4j_pool_manager import Neo4jPoolManager

    pool_manager = Neo4jPoolManager()

    # Clear any existing drivers for clean test
    pool_manager._drivers.clear()

    # hub_id 999 is not in NEO4J_HUB_CONFIG and no default is configured
    with pytest.raises(ValueError, match="NEO4J_HUB_DEFAULT_CONFIG is not set"):
        pool_manager.get_driver(999)


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"4": {"uri": "bolt://localhost:7690", "username": "neo4j", "password": "password4"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
@patch("app.services.neo4j_pool_manager.create_vector_index")
def test_pool_manager_reuses_existing_connection(mock_create_index: MagicMock, mock_driver: MagicMock) -> None:
    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.return_value = None
    mock_session = MagicMock()
    mock_instance.session.return_value.__enter__.return_value = mock_session

    pool_manager = Neo4jPoolManager()

    # Clear any existing drivers for clean test
    pool_manager._drivers.clear()

    # First call should create the driver
    driver1 = pool_manager.get_driver(4)

    # Second call should reuse the existing driver
    driver2 = pool_manager.get_driver(4)

    assert driver1 == driver2 == mock_instance
    # GraphDatabase.driver should only be called once
    mock_driver.assert_called_once()
    # verify_connectivity should be called once (during first get_driver call when connecting the first time)
    assert mock_instance.verify_connectivity.call_count == 1
    # create_vector_index should only be called once (during first connection)
    mock_create_index.assert_called_once()


@patch.dict(
    os.environ,
    {"NEO4J_HUB_CONFIG": '{"5": {"uri": "bolt://localhost:7691", "username": "neo4j", "password": "password5"}}'},
)
@patch("app.services.neo4j_pool_manager.GraphDatabase.driver")
def test_pool_manager_handles_connection_failure(mock_driver: MagicMock) -> None:
    import pytest
    from neo4j.exceptions import ServiceUnavailable

    from app.services.neo4j_pool_manager import Neo4jPoolManager

    mock_instance = MagicMock()
    mock_driver.return_value = mock_instance
    mock_instance.verify_connectivity.side_effect = ServiceUnavailable("Connection failed")

    pool_manager = Neo4jPoolManager()

    # Clear any existing drivers for clean test
    pool_manager._drivers.clear()

    with pytest.raises(Exception, match="Connection failed"):
        pool_manager.get_driver(5)


def test_parse_neo4j_record_str_with_string_values() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record id='doc123' name='Test Document' hub_id=1>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"id": "doc123", "name": "Test Document", "hub_id": 1}


def test_parse_neo4j_record_str_with_integer_values() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record count=42 hub_id=5 index=0>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"count": 42, "hub_id": 5, "index": 0}


def test_parse_neo4j_record_str_with_mixed_values() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record id='abc123' count=100 name='Test' hub_id=7>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"id": "abc123", "count": 100, "name": "Test", "hub_id": 7}


def test_parse_neo4j_record_str_with_multiline_text() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record text='This is a\nmultiline\nstring' id=123>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"text": "This is a\nmultiline\nstring", "id": 123}


def test_parse_neo4j_record_str_with_double_quoted_text() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = (
        '<Record retrieved_chunks="Line one\\nLine two with \\"quotes\\"" document_ids_used=\'doc1|doc2\' count=2>'
    )
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result["retrieved_chunks"] == 'Line one\nLine two with "quotes"'
    assert result["document_ids_used"] == "doc1|doc2"
    assert result["count"] == 2


def test_parse_neo4j_record_long_str_with_double_quote() -> None:
    from app.services.neo4j_client import Neo4jClient

    long_text = "A" * 5000
    record_str = f'<Record retrieved_chunks="{long_text}" id=42>'
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"retrieved_chunks": long_text, "id": 42}
    assert len(result["retrieved_chunks"]) == 5000


def test_parse_neo4j_record_str_with_mixed_quotes() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = '<Record title="Hello \\"World\\"" note=\'It\\\'s fine\' count=3>'
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"title": 'Hello "World"', "note": "It's fine", "count": 3}


def test_parse_neo4j_record_str_with_empty_string() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record value='' count=0>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"value": "", "count": 0}


def test_parse_neo4j_record_str_with_special_characters() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record url='https://example.com/path?param=value' name='Doc #1: Test & Review'>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"url": "https://example.com/path?param=value", "name": "Doc #1: Test & Review"}


def test_parse_neo4j_record_str_with_quoted_text_containing_equals() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record equation='x=y+z' result=42>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"equation": "x=y+z", "result": 42}


def test_parse_neo4j_record_str_with_extra_whitespace() -> None:
    from app.services.neo4j_client import Neo4jClient

    # Internal whitespace is handled, but leading whitespace is not (must start with <Record)
    record_str = "<Record   id='test'   count=5  >"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"id": "test", "count": 5}


def test_parse_neo4j_record_str_rejects_leading_whitespace() -> None:
    import pytest

    from app.services.neo4j_client import Neo4jClient

    # Leading whitespace before <Record should be rejected
    record_str = "  <Record id='test' count=5>"
    with pytest.raises(ValueError, match="Not a valid Neo4j record string"):
        Neo4jClient.parse_neo4j_record_str(record_str)


def test_parse_neo4j_record_str_empty_record() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {}


def test_parse_neo4j_record_str_invalid_format() -> None:
    import pytest

    from app.services.neo4j_client import Neo4jClient

    # Missing <Record prefix
    with pytest.raises(ValueError, match="Not a valid Neo4j record string"):
        Neo4jClient.parse_neo4j_record_str("id='test' count=5")

    # Wrong prefix
    with pytest.raises(ValueError, match="Not a valid Neo4j record string"):
        Neo4jClient.parse_neo4j_record_str("<Node id='test'>")

    # Empty string
    with pytest.raises(ValueError, match="Not a valid Neo4j record string"):
        Neo4jClient.parse_neo4j_record_str("")


def test_parse_neo4j_record_str_with_zero_values() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record count=0 index=0 value=0>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"count": 0, "index": 0, "value": 0}


def test_parse_neo4j_record_str_with_large_numbers() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record bignum=999999999 id='test'>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"bignum": 999999999, "id": "test"}


def test_parse_neo4j_record_str_with_single_quotes_in_text() -> None:
    from app.services.neo4j_client import Neo4jClient

    # Neo4j typically escapes single quotes, but test basic case
    record_str = "<Record name='It\\'s a test' count=1>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    # The regex pattern will match up to the first closing quote
    # This tests the actual behavior of the parser
    assert "name" in result
    assert result["count"] == 1


def test_parse_neo4j_record_str_with_underscore_keys() -> None:
    from app.services.neo4j_client import Neo4jClient

    record_str = "<Record document_id='doc123' hub_id=1 created_at='2025-01-01'>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"document_id": "doc123", "hub_id": 1, "created_at": "2025-01-01"}


def test_parse_neo4j_record_str_with_long_text() -> None:
    from app.services.neo4j_client import Neo4jClient

    long_text = "A" * 5000
    record_str = f"<Record content='{long_text}' id=42>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"content": long_text, "id": 42}
    assert len(result["content"]) == 5000


def test_parse_neo4j_record_str_with_double_quote() -> None:
    from app.services.neo4j_client import Neo4jClient

    long_text = "A" * 5000
    record_str = f'<Record retrieved_chunks="{long_text}" id=42>'
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result == {"retrieved_chunks": long_text, "id": 42}
    assert len(result["retrieved_chunks"]) == 5000


def test_parse_neo4j_record_str_with_hex_escape() -> None:
    from app.services.neo4j_client import Neo4jClient

    # Neo4j Record repr() escapes \x1e (record separator) as literal \x1e
    record_str = r"<Record context='chunk1\x1echunk2\x1echunk3' count=3>"
    result = Neo4jClient.parse_neo4j_record_str(record_str)

    assert result["count"] == 3
    context = result["context"]
    assert "\x1e" in context, "hex escape should be converted to actual byte"
    chunks = context.split("\x1e")
    assert chunks == ["chunk1", "chunk2", "chunk3"]
