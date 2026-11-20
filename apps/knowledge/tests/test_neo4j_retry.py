"""Tests for Neo4j retry utilities."""
# mypy: disable-error-code="no-untyped-call,no-any-return"

from unittest.mock import MagicMock, patch

import pytest
from neo4j.exceptions import ServiceUnavailable, SessionExpired, TransientError

from app.core.neo4j_retry import (
    execute_with_retry,
    is_connection_reset_error,
    is_missing_vector_index_error,
    neo4j_retry,
)


class TestIsConnectionResetError:
    def test_service_unavailable(self) -> None:
        exc = ServiceUnavailable("Connection failed")
        assert is_connection_reset_error(exc) is True

    def test_session_expired(self) -> None:
        exc = SessionExpired("Session expired")
        assert is_connection_reset_error(exc) is True

    def test_transient_error(self) -> None:
        exc = TransientError("Transient error")
        assert is_connection_reset_error(exc) is True

    def test_connection_reset_error(self) -> None:
        exc = ConnectionResetError("Connection reset by peer")
        assert is_connection_reset_error(exc) is True

    def test_connection_error(self) -> None:
        exc = ConnectionError("Connection error")
        assert is_connection_reset_error(exc) is True

    def test_oserror(self) -> None:
        exc = OSError("Socket error")
        assert is_connection_reset_error(exc) is True

    def test_value_error_not_retryable(self) -> None:
        exc = ValueError("Invalid value")
        assert is_connection_reset_error(exc) is False

    def test_connection_reset_in_message(self) -> None:
        exc = Exception("Failed to read: Connection reset by peer")
        assert is_connection_reset_error(exc) is True

    def test_broken_pipe_in_message(self) -> None:
        exc = Exception("Write failed: Broken pipe")
        assert is_connection_reset_error(exc) is True

    def test_nested_cause(self) -> None:
        inner = ConnectionResetError("Connection reset by peer")
        outer = Exception("Wrapper exception")
        outer.__cause__ = inner
        assert is_connection_reset_error(outer) is True

    def test_nested_context(self) -> None:
        inner = ServiceUnavailable("Service unavailable")
        try:
            raise inner
        except ServiceUnavailable:
            try:
                raise RuntimeError("Runtime error")
            except RuntimeError as e:
                assert is_connection_reset_error(e) is True


class TestIsMissingVectorIndexError:
    def test_missing_index_message(self) -> None:
        exc = Exception("No index with name text_vectors_100 found")
        assert is_missing_vector_index_error(exc) is True

    def test_missing_index_message_case_insensitive(self) -> None:
        exc = Exception("NO INDEX WITH NAME text_vectors_100 FOUND")
        assert is_missing_vector_index_error(exc) is True

    def test_no_such_vector_schema_index_message(self) -> None:
        """Neo4j itself raises this phrasing at query time, e.g. via db.index.vector.queryNodes,
        as opposed to the "no index with name" phrasing neo4j_graphrag raises at construction time."""
        exc = Exception(
            "{code: Neo.ClientError.Procedure.ProcedureCallFailed} "
            "{message: Failed to invoke procedure `db.index.vector.queryNodes`: Caused by: "
            "java.lang.IllegalArgumentException: There is no such vector schema index: text_vectors_100}"
        )
        assert is_missing_vector_index_error(exc) is True

    def test_no_such_fulltext_schema_index_message(self) -> None:
        exc = Exception("There is no such fulltext schema index: text_fulltext_index_100")
        assert is_missing_vector_index_error(exc) is True

    def test_unrelated_error_not_matched(self) -> None:
        exc = ValueError("Invalid value")
        assert is_missing_vector_index_error(exc) is False

    def test_nested_cause(self) -> None:
        inner = IndexError("list index out of range")
        outer = Exception("No index with name text_vectors_100 found")
        outer.__cause__ = inner
        assert is_missing_vector_index_error(outer) is True

    def test_nested_context_on_wrapper(self) -> None:
        inner = Exception("No index with name text_vectors_100 found")
        try:
            raise inner
        except Exception:
            try:
                raise RuntimeError("Retriever construction failed")
            except RuntimeError as e:
                assert is_missing_vector_index_error(e) is True


class TestNeo4jRetryDecorator:
    def test_success_on_first_attempt(self) -> None:
        mock_func = MagicMock(return_value="success")

        @neo4j_retry(max_retries=3)
        def test_func() -> str:
            return mock_func()

        result = test_func()
        assert result == "success"
        assert mock_func.call_count == 1

    def test_retry_on_transient_error(self) -> None:
        mock_func = MagicMock(side_effect=[ServiceUnavailable("Failed"), "success"])

        @neo4j_retry(max_retries=3, base_delay=0.01)
        def test_func() -> str:
            return mock_func()

        result = test_func()
        assert result == "success"
        assert mock_func.call_count == 2

    def test_retry_exhausted(self) -> None:
        mock_func = MagicMock(side_effect=ServiceUnavailable("Always fails"))

        @neo4j_retry(max_retries=2, base_delay=0.01)
        def test_func() -> str:
            return mock_func()

        with pytest.raises(ServiceUnavailable):
            test_func()

        assert mock_func.call_count == 3  # Initial + 2 retries

    def test_no_retry_on_non_transient_error(self) -> None:
        mock_func = MagicMock(side_effect=ValueError("Invalid"))

        @neo4j_retry(max_retries=3, base_delay=0.01)
        def test_func() -> str:
            return mock_func()

        with pytest.raises(ValueError):
            test_func()

        assert mock_func.call_count == 1

    def test_exponential_backoff(self) -> None:
        mock_func = MagicMock(side_effect=[ServiceUnavailable("F1"), ServiceUnavailable("F2"), "success"])
        sleep_calls: list[float] = []

        @neo4j_retry(max_retries=3, base_delay=0.1, exponential_base=2.0)
        def test_func() -> str:
            return mock_func()

        with patch("time.sleep", side_effect=lambda x: sleep_calls.append(x)):
            result = test_func()

        assert result == "success"
        assert len(sleep_calls) == 2
        assert sleep_calls[0] == pytest.approx(0.1, rel=0.01)  # 0.1 * 2^0
        assert sleep_calls[1] == pytest.approx(0.2, rel=0.01)  # 0.1 * 2^1

    def test_max_delay_cap(self) -> None:
        mock_func = MagicMock(
            side_effect=[
                ServiceUnavailable("F1"),
                ServiceUnavailable("F2"),
                ServiceUnavailable("F3"),
                "success",
            ]
        )
        sleep_calls: list[float] = []

        @neo4j_retry(max_retries=4, base_delay=5.0, max_delay=8.0, exponential_base=2.0)
        def test_func() -> str:
            return mock_func()

        with patch("time.sleep", side_effect=lambda x: sleep_calls.append(x)):
            result = test_func()

        assert result == "success"
        assert len(sleep_calls) == 3
        # All delays should be capped at 8.0
        for delay in sleep_calls:
            assert delay <= 8.0


class TestExecuteWithRetry:
    def test_success_on_first_attempt(self) -> None:
        mock_func = MagicMock(return_value="success")

        result = execute_with_retry(mock_func, max_retries=3)
        assert result == "success"
        assert mock_func.call_count == 1

    def test_retry_on_transient_error(self) -> None:
        mock_func = MagicMock(side_effect=[SessionExpired("Expired"), "success"])

        result = execute_with_retry(mock_func, max_retries=3, base_delay=0.01)
        assert result == "success"
        assert mock_func.call_count == 2

    def test_passes_args_and_kwargs(self) -> None:
        mock_func = MagicMock(return_value="success")

        result = execute_with_retry(mock_func, "arg1", "arg2", max_retries=3, kwarg1="value1")
        assert result == "success"
        mock_func.assert_called_once_with("arg1", "arg2", kwarg1="value1")

    def test_retry_exhausted_raises(self) -> None:
        mock_func = MagicMock(side_effect=TransientError("Always fails"))

        with pytest.raises(TransientError):
            execute_with_retry(mock_func, max_retries=2, base_delay=0.01)

        assert mock_func.call_count == 3

    def test_connection_reset_in_nested_exception(self) -> None:
        """Test that ConnectionResetError wrapped in another exception triggers retry."""
        inner_exc = ConnectionResetError(104, "Connection reset by peer")
        outer_exc = Exception("Neo4j operation failed")
        outer_exc.__cause__ = inner_exc

        mock_func = MagicMock(side_effect=[outer_exc, "success"])

        result = execute_with_retry(mock_func, max_retries=3, base_delay=0.01)
        assert result == "success"
        assert mock_func.call_count == 2


class TestRetryWithRealNeo4jExceptions:
    """Test retry behavior with realistic Neo4j exception scenarios."""

    def test_defunct_connection_error(self) -> None:
        """Test the specific error pattern from the user's issue."""
        # Simulate the exact error: ConnectionResetError wrapped in a Neo4j exception
        inner = ConnectionResetError(104, "Connection reset by peer")
        exc = Exception(
            "Failed to read from defunct connection IPv4Address(('server', 7687)): "
            "ConnectionResetError(104, 'Connection reset by peer')"
        )
        exc.__cause__ = inner

        mock_func = MagicMock(side_effect=[exc, "recovered"])

        result = execute_with_retry(mock_func, max_retries=2, base_delay=0.01)
        assert result == "recovered"
        assert mock_func.call_count == 2

    def test_defunct_connection_without_chained_cause(self) -> None:
        """Test defunct connection detected by message alone (no __cause__ chain)."""
        exc = Exception("Failed to read from defunct connection IPv4Address(('server', 7687))")

        mock_func = MagicMock(side_effect=[exc, "recovered"])

        result = execute_with_retry(mock_func, max_retries=2, base_delay=0.01)
        assert result == "recovered"
        assert mock_func.call_count == 2

    def test_multiple_transient_failures_then_success(self) -> None:
        """Test recovery after multiple transient failures."""
        mock_func = MagicMock(
            side_effect=[
                ServiceUnavailable("First failure"),
                SessionExpired("Second failure"),
                "finally success",
            ]
        )

        result = execute_with_retry(mock_func, max_retries=3, base_delay=0.01)
        assert result == "finally success"
        assert mock_func.call_count == 3


class TestDefunctConnectionDetection:
    """Test that 'defunct' keyword in error messages is detected as retryable."""

    def test_defunct_in_message_detected(self) -> None:
        exc = Exception("Failed to read from defunct connection")
        assert is_connection_reset_error(exc) is True

    def test_defunct_with_ip_details_detected(self) -> None:
        exc = Exception(
            "Failed to read from defunct connection "
            "IPv4Address(('p-52b13b8d-ff59-0004.production-orch-0687.neo4j.io', 7687)) "
            "(ResolvedIPv4Address(('54.229.145.35', 7687))): "
            "ConnectionResetError(104, 'Connection reset by peer')"
        )
        assert is_connection_reset_error(exc) is True

    def test_defunct_nested_in_search_validation_error(self) -> None:
        """Defunct error wrapped by neo4j_graphrag SearchValidationError."""
        from neo4j_graphrag.exceptions import SearchValidationError

        inner = Exception("Failed to read from defunct connection")
        outer = SearchValidationError([])
        outer.__cause__ = inner
        assert is_connection_reset_error(outer) is True

    def test_service_unavailable_with_defunct_cause(self) -> None:
        """ServiceUnavailable wrapping a defunct connection error."""
        inner = ConnectionResetError(104, "Connection reset by peer")
        outer = ServiceUnavailable("Failed to read from defunct connection IPv4Address(('server', 7687))")
        outer.__cause__ = inner
        assert is_connection_reset_error(outer) is True
