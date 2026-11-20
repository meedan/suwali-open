from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from circuitbreaker import CircuitBreakerError
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from neo4j_graphrag.exceptions import LLMGenerationError
from neo4j_graphrag.llm.types import LLMResponse
from neo4j_graphrag.types import LLMMessage
from openai import APITimeoutError

from app.core.context import hub_id_context, llm_fallback_scope, llm_fallback_used
from app.services.neo4j_llm import LangChainLLMAdapter, LLMWithFallback, _log_llm_exchange


class TestLangChainLLMAdapterMessageBuilding:
    def test_simple_input(self) -> None:
        adapter = LangChainLLMAdapter(MagicMock())
        messages = adapter._build_messages("Hello")
        assert len(messages) == 1
        assert isinstance(messages[0], HumanMessage)
        assert messages[0].content == "Hello"

    def test_with_system_instruction(self) -> None:
        adapter = LangChainLLMAdapter(MagicMock())
        messages = adapter._build_messages("Hello", system_instruction="Be concise")
        assert len(messages) == 2
        assert isinstance(messages[0], SystemMessage)
        assert messages[0].content == "Be concise"
        assert isinstance(messages[1], HumanMessage)

    def test_with_message_history(self) -> None:
        adapter = LangChainLLMAdapter(MagicMock())
        history = [
            LLMMessage(role="user", content="first question"),
            LLMMessage(role="assistant", content="first answer"),
        ]
        messages = adapter._build_messages("follow up", message_history=history)
        assert len(messages) == 3
        assert isinstance(messages[0], HumanMessage)
        assert messages[0].content == "first question"
        assert isinstance(messages[1], AIMessage)
        assert messages[1].content == "first answer"
        assert isinstance(messages[2], HumanMessage)
        assert messages[2].content == "follow up"

    def test_with_system_and_history(self) -> None:
        adapter = LangChainLLMAdapter(MagicMock())
        history = [LLMMessage(role="user", content="hi")]
        messages = adapter._build_messages("follow up", message_history=history, system_instruction="Be helpful")
        assert len(messages) == 3
        assert isinstance(messages[0], SystemMessage)
        assert isinstance(messages[1], HumanMessage)
        assert isinstance(messages[2], HumanMessage)


class TestLangChainLLMAdapterInvoke:
    def test_invoke_delegates_to_chat_model(self) -> None:
        mock_model = MagicMock()
        mock_model.invoke.return_value = MagicMock(content="The answer is 42")
        adapter = LangChainLLMAdapter(mock_model)

        response = adapter.invoke("What is the answer?")

        assert isinstance(response, LLMResponse)
        assert response.content == "The answer is 42"
        mock_model.invoke.assert_called_once()

    def test_invoke_passes_system_instruction(self) -> None:
        mock_model = MagicMock()
        mock_model.invoke.return_value = MagicMock(content="ok")
        adapter = LangChainLLMAdapter(mock_model)

        adapter.invoke("test", system_instruction="Be concise")

        call_args = mock_model.invoke.call_args[0][0]
        assert isinstance(call_args[0], SystemMessage)
        assert call_args[0].content == "Be concise"

    def test_invoke_passes_message_history(self) -> None:
        mock_model = MagicMock()
        mock_model.invoke.return_value = MagicMock(content="ok")
        adapter = LangChainLLMAdapter(mock_model)

        history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
        adapter.invoke("follow up", message_history=history)

        call_args = mock_model.invoke.call_args[0][0]
        assert len(call_args) == 3
        assert isinstance(call_args[0], HumanMessage)
        assert isinstance(call_args[1], AIMessage)
        assert isinstance(call_args[2], HumanMessage)

    async def test_ainvoke_delegates_to_native_async(self) -> None:
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(return_value=MagicMock(content="async result"))
        adapter = LangChainLLMAdapter(mock_model)

        result = await adapter.ainvoke("test")

        mock_model.ainvoke.assert_called_once()
        assert result.content == "async result"


def _timeout_error() -> LLMGenerationError:
    # mirrors the wrap sites: LLMGenerationError raised inside an except-openai block,
    # so implicit chaining sets __context__ (what _is_transient_llm_error inspects)
    try:
        raise APITimeoutError(request=MagicMock())
    except APITimeoutError as openai_err:
        try:
            raise LLMGenerationError(openai_err)
        except LLMGenerationError as wrapped:
            return wrapped


class TestLLMWithFallback:
    def test_returns_primary_response(self) -> None:
        primary = MagicMock()
        primary.invoke.return_value = LLMResponse(content="primary")
        fallback = MagicMock()
        llm = LLMWithFallback(primary, fallback)

        assert llm.invoke("q").content == "primary"
        fallback.invoke.assert_not_called()

    def test_falls_back_on_timeout(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = _timeout_error()
        fallback = MagicMock()
        fallback.invoke.return_value = LLMResponse(content="fallback")
        llm = LLMWithFallback(primary, fallback)

        assert llm.invoke("q").content == "fallback"
        fallback.invoke.assert_called_once()

    def test_falls_back_on_timeout_as_cause(self) -> None:
        err = LLMGenerationError("wrapped")
        err.__cause__ = APITimeoutError(request=MagicMock())
        primary = MagicMock()
        primary.invoke.side_effect = err
        fallback = MagicMock()
        fallback.invoke.return_value = LLMResponse(content="fallback")
        llm = LLMWithFallback(primary, fallback)

        assert llm.invoke("q").content == "fallback"

    def test_falls_back_on_open_circuit(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = CircuitBreakerError(MagicMock())
        fallback = MagicMock()
        fallback.invoke.return_value = LLMResponse(content="fallback")
        llm = LLMWithFallback(primary, fallback)

        assert llm.invoke("q").content == "fallback"

    def test_reraises_non_transient_errors(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = LLMGenerationError("Guardrail tripwire triggered")
        fallback = MagicMock()
        llm = LLMWithFallback(primary, fallback)

        with pytest.raises(LLMGenerationError):
            llm.invoke("q")
        fallback.invoke.assert_not_called()

    async def test_ainvoke_falls_back_on_timeout(self) -> None:
        primary = MagicMock()
        primary.ainvoke = AsyncMock(side_effect=_timeout_error())
        fallback = MagicMock()
        fallback.ainvoke = AsyncMock(return_value=LLMResponse(content="fallback"))
        llm = LLMWithFallback(primary, fallback)

        result = await llm.ainvoke("q")

        assert result.content == "fallback"

    async def test_ainvoke_reraises_non_transient_errors(self) -> None:
        primary = MagicMock()
        primary.ainvoke = AsyncMock(side_effect=LLMGenerationError("bad request"))
        fallback = MagicMock()
        fallback.ainvoke = AsyncMock()
        llm = LLMWithFallback(primary, fallback)

        with pytest.raises(LLMGenerationError):
            await llm.ainvoke("q")
        fallback.ainvoke.assert_not_called()

    def test_publishes_fallback_metric_with_hub_id_on_timeout(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = _timeout_error()
        fallback = MagicMock()
        fallback.invoke.return_value = LLMResponse(content="fallback")
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric") as mock_publish, hub_id_context(42):
            llm.invoke("q")

        mock_publish.assert_called_once_with("llm.fallback", 1, unit="Count", hub_id=42)

    def test_publishes_fallback_metric_with_none_hub_id_outside_context(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = _timeout_error()
        fallback = MagicMock()
        fallback.invoke.return_value = LLMResponse(content="fallback")
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric") as mock_publish:
            llm.invoke("q")

        mock_publish.assert_called_once_with("llm.fallback", 1, unit="Count", hub_id=None)

    def test_publishes_fallback_metric_on_open_circuit(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = CircuitBreakerError(MagicMock())
        fallback = MagicMock()
        fallback.invoke.return_value = LLMResponse(content="fallback")
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric") as mock_publish, hub_id_context("hub-7"):
            llm.invoke("q")

        mock_publish.assert_called_once_with("llm.fallback", 1, unit="Count", hub_id="hub-7")

    def test_does_not_publish_metric_on_primary_success(self) -> None:
        primary = MagicMock()
        primary.invoke.return_value = LLMResponse(content="primary")
        fallback = MagicMock()
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric") as mock_publish, hub_id_context(1):
            llm.invoke("q")

        mock_publish.assert_not_called()

    def test_does_not_publish_metric_on_non_transient_error(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = LLMGenerationError("Guardrail tripwire triggered")
        fallback = MagicMock()
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric") as mock_publish, hub_id_context(1):
            with pytest.raises(LLMGenerationError):
                llm.invoke("q")

        mock_publish.assert_not_called()

    async def test_ainvoke_publishes_fallback_metric_with_hub_id(self) -> None:
        primary = MagicMock()
        primary.ainvoke = AsyncMock(side_effect=_timeout_error())
        fallback = MagicMock()
        fallback.ainvoke = AsyncMock(return_value=LLMResponse(content="fallback"))
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric") as mock_publish, hub_id_context(99):
            await llm.ainvoke("q")

        mock_publish.assert_called_once_with("llm.fallback", 1, unit="Count", hub_id=99)

    async def test_ainvoke_does_not_publish_metric_on_non_transient_error(self) -> None:
        primary = MagicMock()
        primary.ainvoke = AsyncMock(side_effect=LLMGenerationError("bad request"))
        fallback = MagicMock()
        fallback.ainvoke = AsyncMock()
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric") as mock_publish, hub_id_context(1):
            with pytest.raises(LLMGenerationError):
                await llm.ainvoke("q")

        mock_publish.assert_not_called()

    def test_flags_fallback_in_scope(self) -> None:
        primary = MagicMock()
        primary.invoke.side_effect = _timeout_error()
        fallback = MagicMock()
        fallback.invoke.return_value = LLMResponse(content="fallback")
        llm = LLMWithFallback(primary, fallback)

        with patch("app.services.neo4j_llm.publish_metric"), llm_fallback_scope():
            llm.invoke("q")
            assert llm_fallback_used.get() is True

    def test_leaves_flag_unset_when_primary_succeeds(self) -> None:
        primary = MagicMock()
        primary.invoke.return_value = LLMResponse(content="primary")
        llm = LLMWithFallback(primary, MagicMock())

        with llm_fallback_scope():
            llm.invoke("q")
            assert llm_fallback_used.get() is False


class TestLogLlmExchange:
    @staticmethod
    def _mock_llm() -> MagicMock:
        llm = MagicMock()
        llm.model_name = "gpt-4o-mini"
        llm.get_messages.return_value = [{"role": "user", "content": "hi"}]
        return llm

    @patch("app.services.neo4j_llm.log_llm_call")
    @patch("app.services.neo4j_llm.Config")
    def test_disabled_skips_logging(self, mock_config_class: MagicMock, mock_log_llm_call: MagicMock) -> None:
        mock_config_class.return_value.enable_llm_logging = False
        llm = self._mock_llm()

        _log_llm_exchange(llm, "hi", None, None, "response", 1.5)

        mock_log_llm_call.assert_not_called()
        llm.get_messages.assert_not_called()

    @patch("app.services.neo4j_llm.log_llm_call")
    @patch("app.services.neo4j_llm.Config")
    def test_enabled_logs_reconstructed_prompt(
        self, mock_config_class: MagicMock, mock_log_llm_call: MagicMock
    ) -> None:
        mock_config_class.return_value.enable_llm_logging = True
        llm = self._mock_llm()

        _log_llm_exchange(llm, "hi", None, None, "response", 1.5)

        mock_log_llm_call.assert_called_once_with("gpt-4o-mini", "[user] hi", "response", duration_seconds=1.5)

    @patch("app.services.neo4j_llm.log_llm_call")
    @patch("app.services.neo4j_llm.Config")
    def test_enabled_uses_v2_messages_for_list_input(
        self, mock_config_class: MagicMock, mock_log_llm_call: MagicMock
    ) -> None:
        mock_config_class.return_value.enable_llm_logging = True
        llm = self._mock_llm()
        llm.get_messages_v2.return_value = [{"role": "user", "content": "list input"}]

        _log_llm_exchange(llm, [LLMMessage(role="user", content="list input")], None, None, "response", 0.5)

        llm.get_messages_v2.assert_called_once()
        llm.get_messages.assert_not_called()
        mock_log_llm_call.assert_called_once_with("gpt-4o-mini", "[user] list input", "response", duration_seconds=0.5)

    @patch("app.services.neo4j_llm.log_llm_call")
    @patch("app.services.neo4j_llm.Config")
    def test_enabled_falls_back_to_raw_repr_when_reconstruction_fails(
        self, mock_config_class: MagicMock, mock_log_llm_call: MagicMock
    ) -> None:
        mock_config_class.return_value.enable_llm_logging = True
        llm = self._mock_llm()
        llm.get_messages.side_effect = Exception("boom")

        _log_llm_exchange(llm, "hi", None, "be nice", "response", 1.5)

        mock_log_llm_call.assert_called_once()
        model_name, prompt, response = mock_log_llm_call.call_args[0]
        assert model_name == "gpt-4o-mini"
        assert "input='hi'" in prompt
        assert "system_instruction='be nice'" in prompt
        assert response == "response"
        assert mock_log_llm_call.call_args[1] == {"duration_seconds": 1.5}
