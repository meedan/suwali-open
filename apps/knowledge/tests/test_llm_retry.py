from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from circuitbreaker import CircuitBreakerError
from langchain_core.exceptions import OutputParserException
from langchain_core.messages import AIMessage
from langchain_core.output_parsers import JsonOutputParser, PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnableLambda
from openai import BadRequestError
from pydantic import BaseModel, ValidationError

from app.core.circuit import LLMCircuitBreaker
from app.core.llm_retry import (
    aexecute_with_output_retry,
    ainvoke_with_output_retry,
    execute_with_output_retry,
    invoke_with_output_retry,
    is_retryable_llm_output_error,
)
from app.core.output_parsing import TruncatedCompletionError


class _Parsed(BaseModel):
    answer: str


def _validation_error() -> ValidationError:
    with pytest.raises(ValidationError) as exc_info:
        _Parsed.model_validate({})
    return exc_info.value


def _bad_request_error() -> BadRequestError:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    return BadRequestError("bad request", response=httpx.Response(400, request=request), body=None)


class TestIsRetryableLlmOutputError:
    def test_output_parser_exception_retryable(self) -> None:
        assert is_retryable_llm_output_error(OutputParserException("bad json")) is True

    def test_validation_error_retryable(self) -> None:
        assert is_retryable_llm_output_error(_validation_error()) is True

    def test_json_decode_error_retryable(self) -> None:
        assert is_retryable_llm_output_error(__import__("json").JSONDecodeError("msg", "doc", 0)) is True

    def test_nested_cause_retryable(self) -> None:
        outer = RuntimeError("wrapper")
        outer.__cause__ = OutputParserException("bad json")
        assert is_retryable_llm_output_error(outer) is True

    def test_truncated_completion_not_retryable(self) -> None:
        assert is_retryable_llm_output_error(TruncatedCompletionError("truncated")) is False

    def test_truncated_completion_wrapped_not_retryable(self) -> None:
        outer = RuntimeError("wrapper")
        outer.__cause__ = TruncatedCompletionError("truncated")
        assert is_retryable_llm_output_error(outer) is False

    def test_circuit_breaker_error_not_retryable(self) -> None:
        assert is_retryable_llm_output_error(CircuitBreakerError(MagicMock())) is False

    def test_value_error_not_retryable(self) -> None:
        assert is_retryable_llm_output_error(ValueError("nope")) is False

    def test_bad_request_not_retryable(self) -> None:
        assert is_retryable_llm_output_error(_bad_request_error()) is False


class TestExecuteWithOutputRetry:
    @patch("app.core.llm_retry.publish_metric")
    def test_retries_then_succeeds(self, mock_publish_metric: MagicMock) -> None:
        func = MagicMock(side_effect=[OutputParserException("bad json"), "ok"])

        assert execute_with_output_retry(func, component="HyDE") == "ok"
        assert func.call_count == 2
        mock_publish_metric.assert_called_once_with("llm.output_retry", 1, unit="Count", hub_id=None)

    def test_exhaustion_reraises(self) -> None:
        func = MagicMock(side_effect=OutputParserException("bad json"))

        with pytest.raises(OutputParserException, match="bad json"):
            execute_with_output_retry(func, component="HyDE")
        assert func.call_count == 2

    def test_attempts_one_never_retries(self) -> None:
        func = MagicMock(side_effect=OutputParserException("bad json"))

        with pytest.raises(OutputParserException, match="bad json"):
            execute_with_output_retry(func, component="HyDE", attempts=1)
        assert func.call_count == 1

    def test_non_retryable_raises_immediately(self) -> None:
        func = MagicMock(side_effect=TruncatedCompletionError("truncated"))

        with pytest.raises(TruncatedCompletionError, match="truncated"):
            execute_with_output_retry(func, component="HyDE")
        assert func.call_count == 1


class TestAexecuteWithOutputRetry:
    @pytest.mark.asyncio
    async def test_retries_then_succeeds(self) -> None:
        func = AsyncMock(side_effect=[OutputParserException("bad json"), "ok"])

        assert await aexecute_with_output_retry(func, component="Synthesizer") == "ok"
        assert func.await_count == 2

    @pytest.mark.asyncio
    async def test_exhaustion_reraises(self) -> None:
        func = AsyncMock(side_effect=OutputParserException("bad json"))

        with pytest.raises(OutputParserException, match="bad json"):
            await aexecute_with_output_retry(func, component="Synthesizer")
        assert func.await_count == 2

    @pytest.mark.asyncio
    async def test_circuit_breaker_error_not_retried(self) -> None:
        func = AsyncMock(side_effect=CircuitBreakerError(MagicMock()))

        with pytest.raises(CircuitBreakerError):
            await aexecute_with_output_retry(func, component="Synthesizer")
        assert func.await_count == 1


class TestCircuitComposition:
    @pytest.mark.asyncio
    async def test_inner_retry_success_does_not_open_breaker(self) -> None:
        breaker = LLMCircuitBreaker()
        attempts = {"n": 0}

        async def flaky() -> str:
            attempts["n"] += 1
            if attempts["n"] == 1:
                raise OutputParserException("bad json")
            return "ok"

        @breaker
        async def wrapped() -> str:
            return await aexecute_with_output_retry(flaky, component="Test")

        assert await wrapped() == "ok"
        assert await wrapped() == "ok"
        assert await wrapped() == "ok"
        assert await wrapped() == "ok"

    @pytest.mark.asyncio
    async def test_exhausted_retry_counts_as_one_circuit_failure(self) -> None:
        breaker = LLMCircuitBreaker()
        calls = {"n": 0}

        async def always_bad() -> str:
            calls["n"] += 1
            raise OutputParserException("bad json")

        @breaker
        async def wrapped() -> str:
            return await aexecute_with_output_retry(always_bad, component="Test")

        for _ in range(3):
            with pytest.raises(OutputParserException, match="bad json"):
                await wrapped()

        with pytest.raises(CircuitBreakerError):
            await wrapped()
        # three outer failures of two inner attempts each, then the open breaker blocks
        assert calls["n"] == 6

    @pytest.mark.asyncio
    async def test_open_breaker_is_not_retried_by_helper(self) -> None:
        func = AsyncMock(side_effect=CircuitBreakerError(MagicMock()))

        with pytest.raises(CircuitBreakerError):
            await aexecute_with_output_retry(func, component="Test", attempts=2)
        assert func.await_count == 1


def _counting_model(messages: list[AIMessage]) -> tuple[RunnableLambda[object, AIMessage], dict[str, int]]:
    calls = {"n": 0}

    def _model(_prompt: object) -> AIMessage:
        idx = min(calls["n"], len(messages) - 1)
        calls["n"] += 1
        return messages[idx]

    return RunnableLambda(_model), calls


class TestStructuredInvokeTruncation:
    def test_length_finish_reason_not_retried(self) -> None:
        model, calls = _counting_model(
            [AIMessage(content='{"answer": "cut off', response_metadata={"finish_reason": "length"})]
        )

        with pytest.raises(TruncatedCompletionError, match="truncated"):
            invoke_with_output_retry(
                {"q": "hi"},
                prompt=PromptTemplate.from_template("{q}"),
                model=model,
                parser=PydanticOutputParser(pydantic_object=_Parsed),
                component="Test",
            )
        assert calls["n"] == 1

    def test_max_tokens_stop_reason_not_retried(self) -> None:
        model, calls = _counting_model(
            [AIMessage(content='{"answer": "cut off', response_metadata={"stop_reason": "max_tokens"})]
        )

        with pytest.raises(TruncatedCompletionError, match="truncated"):
            invoke_with_output_retry(
                {"q": "hi"},
                prompt=PromptTemplate.from_template("{q}"),
                model=model,
                parser=PydanticOutputParser(pydantic_object=_Parsed),
                component="Test",
            )
        assert calls["n"] == 1

    def test_malformed_json_retries_once_then_succeeds(self) -> None:
        model, calls = _counting_model(
            [
                AIMessage(content="not json", response_metadata={"finish_reason": "stop"}),
                AIMessage(content='{"answer": "ok"}', response_metadata={"finish_reason": "stop"}),
            ]
        )

        result = invoke_with_output_retry(
            {"q": "hi"},
            prompt=PromptTemplate.from_template("{q}"),
            model=model,
            parser=PydanticOutputParser(pydantic_object=_Parsed),
            component="Test",
        )
        assert result == _Parsed(answer="ok")
        assert calls["n"] == 2

    def test_malformed_json_exhausts_after_one_retry(self) -> None:
        model, calls = _counting_model([AIMessage(content="not json", response_metadata={"finish_reason": "stop"})])

        with pytest.raises(OutputParserException):
            invoke_with_output_retry(
                {"q": "hi"},
                prompt=PromptTemplate.from_template("{q}"),
                model=model,
                parser=PydanticOutputParser(pydantic_object=_Parsed),
                component="Test",
            )
        assert calls["n"] == 2

    def test_schema_validation_retries_once(self) -> None:
        model, calls = _counting_model(
            [
                AIMessage(content='{"other": 1}', response_metadata={"finish_reason": "stop"}),
                AIMessage(content='{"answer": "ok"}', response_metadata={"finish_reason": "stop"}),
            ]
        )

        result = invoke_with_output_retry(
            {"q": "hi"},
            prompt=PromptTemplate.from_template("{q}"),
            model=model,
            parser=PydanticOutputParser(pydantic_object=_Parsed),
            component="Test",
        )
        assert result == _Parsed(answer="ok")
        assert calls["n"] == 2

    def test_allow_truncated_salvages_json(self) -> None:
        model, calls = _counting_model(
            [
                AIMessage(
                    content='{"entities": [{"name": "Meedan"}]',
                    response_metadata={"finish_reason": "length"},
                )
            ]
        )

        result = invoke_with_output_retry(
            {"q": "hi"},
            prompt=PromptTemplate.from_template("{q}"),
            model=model,
            parser=JsonOutputParser(),
            reject_truncated=False,
            component="Entity glossary",
        )
        assert result == {"entities": [{"name": "Meedan"}]}
        assert calls["n"] == 1

    def test_allow_truncated_unsalvageable_not_retried(self) -> None:
        model, calls = _counting_model(
            [AIMessage(content="definitely not json", response_metadata={"finish_reason": "length"})]
        )

        with pytest.raises(TruncatedCompletionError, match="truncated"):
            invoke_with_output_retry(
                {"q": "hi"},
                prompt=PromptTemplate.from_template("{q}"),
                model=model,
                parser=JsonOutputParser(),
                reject_truncated=False,
                component="Entity glossary",
            )
        assert calls["n"] == 1

    @pytest.mark.asyncio
    async def test_ainvoke_length_finish_reason_not_retried(self) -> None:
        model, calls = _counting_model(
            [AIMessage(content='{"answer": "cut off', response_metadata={"finish_reason": "length"})]
        )

        with pytest.raises(TruncatedCompletionError, match="truncated"):
            await ainvoke_with_output_retry(
                {"q": "hi"},
                prompt=PromptTemplate.from_template("{q}"),
                model=model,
                parser=PydanticOutputParser(pydantic_object=_Parsed),
                component="Test",
            )
        assert calls["n"] == 1

    @pytest.mark.asyncio
    async def test_ainvoke_malformed_json_retries_once(self) -> None:
        model, calls = _counting_model(
            [
                AIMessage(content="not json", response_metadata={"finish_reason": "stop"}),
                AIMessage(content='{"answer": "ok"}', response_metadata={"finish_reason": "stop"}),
            ]
        )

        result = await ainvoke_with_output_retry(
            {"q": "hi"},
            prompt=PromptTemplate.from_template("{q}"),
            model=model,
            parser=PydanticOutputParser(pydantic_object=_Parsed),
            component="Test",
        )
        assert result == _Parsed(answer="ok")
        assert calls["n"] == 2
