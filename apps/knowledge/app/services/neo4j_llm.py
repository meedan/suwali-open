import sys
import time
from pathlib import Path
from typing import Any, Optional, Union

from circuitbreaker import CircuitBreakerError
from guardrails import GuardrailsAsyncOpenAI, GuardrailsOpenAI, GuardrailTripwireTriggered, total_guardrail_token_usage
from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import Runnable
from loguru import logger
from neo4j_graphrag.exceptions import LLMGenerationError
from neo4j_graphrag.llm import OpenAILLM
from neo4j_graphrag.llm.base import LLMInterface
from neo4j_graphrag.llm.openai_llm import BaseOpenAILLM
from neo4j_graphrag.llm.types import LLMResponse
from neo4j_graphrag.message_history import MessageHistory
from neo4j_graphrag.types import LLMMessage
from openai import OpenAIError
from pydantic import BaseModel

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.context import current_hub_id, llm_fallback_used
from app.core.llm_config import TRANSIENT_OPENAI_ERRORS
from app.core.logging import format_llm_messages, log_llm_call, publish_metric

ROLE_TO_MESSAGE_CLASS: dict[str, type[BaseMessage]] = {
    "system": SystemMessage,
    "user": HumanMessage,
    "assistant": AIMessage,
}


class LangChainLLMAdapter(LLMInterface):  # xtype: ignore[misc]
    """Adapts any LangChain chat model (or fallback-wrapped runnable) to neo4j_graphrag's LLMInterface."""

    def __init__(self, chat_model: Runnable[LanguageModelInput, BaseMessage]):
        super().__init__(model_name="langchain-adapter")
        self.chat_model = chat_model

    def _build_messages(
        self,
        input: str,
        message_history: Optional[list[LLMMessage]] = None,
        system_instruction: Optional[str] = None,
    ) -> list[BaseMessage]:
        messages: list[BaseMessage] = []
        if system_instruction:
            messages.append(SystemMessage(content=system_instruction))
        if message_history:
            for msg in message_history:
                role = msg.get("role", "user")
                cls = ROLE_TO_MESSAGE_CLASS.get(role, HumanMessage)
                messages.append(cls(content=msg.get("content", "")))
        messages.append(HumanMessage(content=input))
        return messages

    @LLMCircuitBreaker()
    def invoke(
        self,
        input: str,
        message_history: Optional[list[LLMMessage]] = None,
        system_instruction: Optional[str] = None,
    ) -> LLMResponse:
        start_time = time.perf_counter()
        messages = self._build_messages(input, message_history, system_instruction)
        response = self.chat_model.invoke(messages)
        duration = time.perf_counter() - start_time
        logger.debug(f"LangChainLLMAdapter response in {duration:.2f}s")
        return LLMResponse(content=str(response.content))

    @LLMCircuitBreaker()
    async def ainvoke(
        self,
        input: str,
        message_history: Optional[list[LLMMessage]] = None,
        system_instruction: Optional[str] = None,
    ) -> LLMResponse:
        start_time = time.perf_counter()
        messages = self._build_messages(input, message_history, system_instruction)
        response = await self.chat_model.ainvoke(messages)
        duration = time.perf_counter() - start_time
        logger.debug(f"LangChainLLMAdapter async response in {duration:.2f}s")
        return LLMResponse(content=str(response.content))


def _is_transient_llm_error(err: Exception) -> bool:
    if isinstance(err, CircuitBreakerError):
        return True
    # both wrap sites raise LLMGenerationError inside an except-openai block, so implicit
    # chaining puts the openai error in __context__ even without "raise ... from"
    cause = err.__cause__ or err.__context__
    return isinstance(cause, TRANSIENT_OPENAI_ERRORS)


class LLMWithFallback(LLMInterface):  # xtype: ignore[misc]
    """Delegates to primary; retries on fallback when primary times out, can't connect, or its circuit is open."""

    def __init__(self, primary: LLMInterface, fallback: LLMInterface):
        super().__init__(model_name="llm-with-fallback")
        self.primary = primary
        self.fallback = fallback

    def invoke(
        self,
        input: str,
        message_history: Optional[Union[list[LLMMessage], MessageHistory]] = None,
        system_instruction: Optional[str] = None,
    ) -> LLMResponse:
        try:
            return self.primary.invoke(input, message_history, system_instruction)
        except (LLMGenerationError, CircuitBreakerError) as err:
            if not _is_transient_llm_error(err):
                raise
            logger.warning(f"Primary LLM unavailable ({err!r}), retrying on fallback LLM")
            publish_metric("llm.fallback", 1, unit="Count", hub_id=current_hub_id.get())
            llm_fallback_used.set(True)
            return self.fallback.invoke(input, message_history, system_instruction)

    async def ainvoke(
        self,
        input: str,
        message_history: Optional[Union[list[LLMMessage], MessageHistory]] = None,
        system_instruction: Optional[str] = None,
    ) -> LLMResponse:
        try:
            return await self.primary.ainvoke(input, message_history, system_instruction)
        except (LLMGenerationError, CircuitBreakerError) as err:
            if not _is_transient_llm_error(err):
                raise
            logger.warning(f"Primary LLM unavailable ({err!r}), retrying on fallback LLM")
            publish_metric("llm.fallback", 1, unit="Count", hub_id=current_hub_id.get())
            llm_fallback_used.set(True)
            return await self.fallback.ainvoke(input, message_history, system_instruction)


def _log_llm_exchange(
    llm: BaseOpenAILLM,
    input: Union[str, list[LLMMessage]],
    message_history: Optional[list[LLMMessage]],
    system_instruction: Optional[str],
    content: str,
    duration: float,
) -> None:
    """Best-effort reconstruction of the exact messages sent, for full prompt/response logging."""
    if not Config().enable_llm_logging:
        return
    try:
        messages = (
            llm.get_messages_v2(input)
            if isinstance(input, list)
            else llm.get_messages(input, message_history, system_instruction)
        )
        prompt = format_llm_messages(messages)
    except Exception:
        prompt = f"input={input!r} message_history={message_history!r} system_instruction={system_instruction!r}"
    log_llm_call(llm.model_name, prompt, content, duration_seconds=duration)


class OpenAILLMWithTiming(OpenAILLM):  # xtype: ignore[misc]
    @LLMCircuitBreaker()
    def invoke(
        self,
        input: Union[str, list[LLMMessage]],
        message_history: Optional[list[LLMMessage]] = None,
        system_instruction: Optional[str] = None,
        response_format: Optional[Union[type[BaseModel], dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        start_time = time.perf_counter()
        logger.debug("Sending a synchronous request to OpenAI LLM")
        response = super().invoke(input, message_history, system_instruction, response_format, **kwargs)
        duration = time.perf_counter() - start_time
        logger.debug(f"Received response from OpenAI LLM in {duration:.2f} seconds")
        _log_llm_exchange(self, input, message_history, system_instruction, response.content, duration)
        return response

    @LLMCircuitBreaker()
    async def ainvoke(
        self,
        input: Union[str, list[LLMMessage]],
        message_history: Optional[list[LLMMessage]] = None,
        system_instruction: Optional[str] = None,
        response_format: Optional[Union[type[BaseModel], dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        start_time = time.perf_counter()
        logger.debug("Sending an asynchronous request to OpenAI LLM")
        response = await super().ainvoke(input, message_history, system_instruction, response_format, **kwargs)
        duration = time.perf_counter() - start_time
        logger.debug(f"Received response from OpenAI LLM in {duration:.2f} seconds")
        _log_llm_exchange(self, input, message_history, system_instruction, response.content, duration)
        return response


def _log_guardrail_results(response: Any) -> None:
    try:
        gr_tokens = total_guardrail_token_usage(response)
        if gr_tokens.get("total_tokens"):
            logger.debug(f"Guardrail tokens: {gr_tokens['total_tokens']}")
        if hasattr(response, "guardrail_results"):
            for gr in response.guardrail_results.all_results:
                logger.debug(f"Guardrail '{gr.info.get('guardrail_name')}': triggered={gr.tripwire_triggered}")
    except Exception as err:
        logger.opt(exception=sys.exc_info()).warning(f"Failed to log guardrail metadata: {err}")


class GuardrailsOpenAILLM(BaseOpenAILLM):  # xtype: ignore[misc]
    def __init__(
        self,
        model_name: str,
        model_params: Optional[dict[str, Any]] = None,
        **kwargs: Any,
    ):
        super().__init__(model_name, model_params, **kwargs)
        config = Path(__file__).parent / "guardrails_config.json"
        logger.info(f"Loading Guardrails configuration from {config.absolute()}")
        self.client = GuardrailsOpenAI(config=config, raise_guardrail_errors=True, **kwargs)
        self.async_client = GuardrailsAsyncOpenAI(config=config, raise_guardrail_errors=True, **kwargs)

    @LLMCircuitBreaker()
    def invoke(
        self,
        input: Union[str, list[LLMMessage]],
        message_history: Optional[list[LLMMessage]] = None,
        system_instruction: Optional[str] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        try:
            start_time = time.perf_counter()
            logger.debug("Sending a synchronous request to Guardrails OpenAI LLM")
            if isinstance(input, list):
                messages = self.get_messages_v2(input)
            else:
                messages = self.get_messages(input, message_history, system_instruction)
            response = self.client.chat.completions.create(
                messages=messages,
                model=self.model_name,
                **self.model_params,
            )
            content = response.choices[0].message.content or ""
            duration = time.perf_counter() - start_time
            logger.debug(f"Received response from Guardrails OpenAI LLM in {duration:.2f} seconds")
            _log_guardrail_results(response)
            _log_llm_exchange(self, input, message_history, system_instruction, content, duration)
            return LLMResponse(content=content)
        except OpenAIError as e:
            raise LLMGenerationError(e)
        except GuardrailTripwireTriggered as e:
            logger.opt(exception=sys.exc_info()).error(f"Guardrail tripwire triggered: {e.guardrail_result.info}")
            raise LLMGenerationError("Guardrail tripwire triggered") from e

    @LLMCircuitBreaker()
    async def ainvoke(
        self,
        input: Union[str, list[LLMMessage]],
        message_history: Optional[list[LLMMessage]] = None,
        system_instruction: Optional[str] = None,
        **kwargs: Any,
    ) -> LLMResponse:
        try:
            start_time = time.perf_counter()
            logger.debug("Sending an asynchronous request to Guardrails OpenAI LLM")
            if isinstance(input, list):
                messages = self.get_messages_v2(input)
            else:
                messages = self.get_messages(input, message_history, system_instruction)
            response = await self.async_client.chat.completions.create(
                messages=messages,
                model=self.model_name,
                **self.model_params,
            )
            content = response.choices[0].message.content or ""
            duration = time.perf_counter() - start_time
            logger.debug(f"Received response from Guardrails OpenAI LLM in {duration:.2f} seconds")
            _log_guardrail_results(response)
            _log_llm_exchange(self, input, message_history, system_instruction, content, duration)
            return LLMResponse(content=content)
        except OpenAIError as e:
            raise LLMGenerationError(e)
        except GuardrailTripwireTriggered as e:
            logger.opt(exception=sys.exc_info()).error(f"Guardrail tripwire triggered: {e.guardrail_result.info}")
            raise LLMGenerationError("Guardrail tripwire triggered") from e
