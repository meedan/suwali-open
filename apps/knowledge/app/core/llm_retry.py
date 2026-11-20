"""Retry structured LLM calls when the model returns unusable output.

Transport failures are handled by the OpenAI/Bedrock SDKs and llm_bedrock_fallback.
This helper re-invokes the chain once after parse/schema errors that the deterministic
repairs in output_parsing could not salvage. Call it inside @LLMCircuitBreaker() so
inner retries that later succeed look like success to the breaker.

Truncation rejection is composed here (after the model, before the parser). Call sites
pass prompt/model/parser pieces — do not insert reject_truncated_completion themselves.
"""

import json
import sys
from collections.abc import Awaitable, Callable, Iterator, Sequence
from contextlib import contextmanager
from typing import Any, TypeVar

from circuitbreaker import CircuitBreakerError
from guardrails import GuardrailTripwireTriggered
from langchain_core.exceptions import OutputParserException
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableLambda
from loguru import logger
from openai import BadRequestError
from pydantic import ValidationError

from app.core.context import current_hub_id
from app.core.logging import publish_metric
from app.core.output_parsing import TruncatedCompletionError, strip_reasoning, truncated_finish_reason

T = TypeVar("T")

DEFAULT_OUTPUT_RETRY_ATTEMPTS = 2  # total tries

_RETRYABLE_OUTPUT_ERRORS = (OutputParserException, ValidationError, json.JSONDecodeError)
_NON_RETRYABLE_ERRORS = (
    TruncatedCompletionError,
    CircuitBreakerError,
    BadRequestError,
    GuardrailTripwireTriggered,
)


def _is_non_retryable(exc: BaseException) -> bool:
    if isinstance(exc, _NON_RETRYABLE_ERRORS):
        return True
    if exc.__cause__ is not None and _is_non_retryable(exc.__cause__):
        return True
    if exc.__context__ is not None and _is_non_retryable(exc.__context__):
        return True
    return False


def is_retryable_llm_output_error(exc: BaseException) -> bool:
    """True when the LLM returned a completion that failed to parse as the expected schema."""
    if _is_non_retryable(exc):
        return False
    if isinstance(exc, _RETRYABLE_OUTPUT_ERRORS):
        return True
    if exc.__cause__ is not None and is_retryable_llm_output_error(exc.__cause__):
        return True
    if exc.__context__ is not None and is_retryable_llm_output_error(exc.__context__):
        return True
    return False


def _truncation_guard(*, reject: bool, truncated_reason: list[str | None]) -> RunnableLambda[BaseMessage, BaseMessage]:
    # LangChain copies ContextVars around each step, so a mutable slot is how the
    # retry wrapper learns that this attempt hit a token limit.
    def _guard(message: BaseMessage) -> BaseMessage:
        reason = truncated_finish_reason(message)
        if reason is None:
            return message
        truncated_reason[0] = reason
        if reject:
            raise TruncatedCompletionError(f"LLM completion truncated by token limit (finish_reason={reason})")
        return message

    return RunnableLambda(_guard)


def structured_output_chain(
    model: Any,
    parser: Any,
    *,
    prompt: Any | None = None,
    extra_after_strip: Sequence[Any] = (),
    reject_truncated: bool = True,
    truncated_reason: list[str | None] | None = None,
) -> Any:
    """prompt | model | truncation_guard | strip_reasoning | *extra_after_strip | parser."""
    reason_slot = truncated_reason if truncated_reason is not None else [None]
    head = prompt | model if prompt is not None else model
    chain = head | _truncation_guard(reject=reject_truncated, truncated_reason=reason_slot) | strip_reasoning
    for step in extra_after_strip:
        chain = chain | step
    return chain | parser


def _reraise_if_truncated(exc: BaseException, truncated_reason: list[str | None]) -> None:
    reason = truncated_reason[0]
    if reason is not None:
        raise TruncatedCompletionError(f"LLM completion truncated by token limit (finish_reason={reason})") from exc


def _build_retry_chain(
    model: Any,
    parser: Any,
    *,
    prompt: Any | None,
    extra_after_strip: Sequence[Any],
    reject_truncated: bool,
) -> tuple[Any, list[str | None]]:
    truncated_reason: list[str | None] = [None]
    chain = structured_output_chain(
        model,
        parser,
        prompt=prompt,
        extra_after_strip=extra_after_strip,
        reject_truncated=reject_truncated,
        truncated_reason=truncated_reason,
    )
    return chain, truncated_reason


@contextmanager
def _truncation_attempt(truncated_reason: list[str | None]) -> Iterator[None]:
    truncated_reason[0] = None
    try:
        yield
    except TruncatedCompletionError:
        raise
    except Exception as e:
        _reraise_if_truncated(e, truncated_reason)
        raise


def execute_with_output_retry(
    func: Callable[..., T],
    *args: Any,
    component: str,
    attempts: int = DEFAULT_OUTPUT_RETRY_ATTEMPTS,
    **kwargs: Any,
) -> T:
    """Invoke func, retrying once on unusable LLM output. Re-raises after exhaustion."""
    last_exception: BaseException | None = None
    for attempt in range(attempts):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if not is_retryable_llm_output_error(e):
                raise
            last_exception = e
            if attempt == attempts - 1:
                raise
            logger.opt(exception=sys.exc_info()).warning(
                f"{component} output unusable on attempt {attempt + 1}/{attempts}; retrying: {e}"
            )
            publish_metric("llm.output_retry", 1, unit="Count", hub_id=current_hub_id.get())

    if last_exception:
        raise last_exception
    raise RuntimeError("Unexpected state in execute_with_output_retry")


async def aexecute_with_output_retry(
    func: Callable[..., Awaitable[T]],
    *args: Any,
    component: str,
    attempts: int = DEFAULT_OUTPUT_RETRY_ATTEMPTS,
    **kwargs: Any,
) -> T:
    """Async counterpart of execute_with_output_retry."""
    last_exception: BaseException | None = None
    for attempt in range(attempts):
        try:
            return await func(*args, **kwargs)
        except Exception as e:
            if not is_retryable_llm_output_error(e):
                raise
            last_exception = e
            if attempt == attempts - 1:
                raise
            logger.opt(exception=sys.exc_info()).warning(
                f"{component} output unusable on attempt {attempt + 1}/{attempts}; retrying: {e}"
            )
            publish_metric("llm.output_retry", 1, unit="Count", hub_id=current_hub_id.get())

    if last_exception:
        raise last_exception
    raise RuntimeError("Unexpected state in aexecute_with_output_retry")


def invoke_with_output_retry(
    payload: Any,
    *,
    model: Any,
    parser: Any,
    component: str,
    prompt: Any | None = None,
    extra_after_strip: Sequence[Any] = (),
    reject_truncated: bool = True,
    attempts: int = DEFAULT_OUTPUT_RETRY_ATTEMPTS,
) -> Any:
    chain, truncated_reason = _build_retry_chain(
        model,
        parser,
        prompt=prompt,
        extra_after_strip=extra_after_strip,
        reject_truncated=reject_truncated,
    )

    def _invoke() -> Any:
        with _truncation_attempt(truncated_reason):
            return chain.invoke(payload)

    return execute_with_output_retry(_invoke, component=component, attempts=attempts)


async def ainvoke_with_output_retry(
    payload: Any,
    *,
    model: Any,
    parser: Any,
    component: str,
    prompt: Any | None = None,
    extra_after_strip: Sequence[Any] = (),
    reject_truncated: bool = True,
    attempts: int = DEFAULT_OUTPUT_RETRY_ATTEMPTS,
) -> Any:
    chain, truncated_reason = _build_retry_chain(
        model,
        parser,
        prompt=prompt,
        extra_after_strip=extra_after_strip,
        reject_truncated=reject_truncated,
    )

    async def _ainvoke() -> Any:
        with _truncation_attempt(truncated_reason):
            return await chain.ainvoke(payload)

    return await aexecute_with_output_retry(_ainvoke, component=component, attempts=attempts)
