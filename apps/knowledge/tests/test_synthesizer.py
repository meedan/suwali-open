from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import Runnable, RunnableLambda

from app.core.constants import ABBREVIATION_EXPANSION_RULE, ANSWER_TARGET_MAX_CHARS
from app.core.llm_retry import structured_output_chain
from app.core.output_parsing import TruncatedCompletionError, repair_garbled_json
from app.models.chat import ErrorType
from app.services.router.models import SubQuery, SubQueryResult
from app.services.router.synthesizer import (
    NO_ANSWER_SYNTHESIS_STATUSES,
    ResponseSynthesizer,
    SynthesizedOutput,
    _script_rule,
)


def test_multi_source_prompt_includes_answer_length_budget() -> None:
    assert f"under {ANSWER_TARGET_MAX_CHARS} characters" in ResponseSynthesizer.SYNTHESIS_PROMPT


def test_multi_source_prompt_forbids_acronym_expansion() -> None:
    # a bare acronym in a source answer is not licence for the synthesizer to spell it out
    assert ABBREVIATION_EXPANSION_RULE in ResponseSynthesizer.SYNTHESIS_PROMPT


def test_script_rule_empty_without_script() -> None:
    assert _script_rule(None) == ""


def test_script_rule_names_script_and_forbids_transliteration() -> None:
    rule = _script_rule("Deva")
    assert "Deva script" in rule
    assert "Do NOT transliterate" in rule


@patch("app.services.router.synthesizer.create_chat_model")
@patch("app.services.router.synthesizer.PromptTemplate")
@patch("app.services.router.synthesizer.ainvoke_with_output_retry")
@pytest.mark.asyncio
async def test_subquery_prompt_includes_answer_length_budget(
    mock_ainvoke: AsyncMock,
    mock_prompt_template: MagicMock,
    mock_create_chat_model: MagicMock,
) -> None:
    mock_ainvoke.return_value = SynthesizedOutput(answer="ok", confidence=0.9)

    sub_results = [
        SubQueryResult(sub_query=SubQuery(query="q1", reasoning="r1"), answer="a1"),
        SubQueryResult(sub_query=SubQuery(query="q2", reasoning="r2"), answer="a2"),
    ]
    await ResponseSynthesizer()._synthesize_subquery_results("orig", sub_results, language=None)

    rendered_template = mock_prompt_template.from_template.call_args[0][0]
    assert f"under {ANSWER_TARGET_MAX_CHARS} characters" in rendered_template


@patch("app.services.router.synthesizer.create_chat_model")
@patch("app.services.router.synthesizer.PromptTemplate")
@patch("app.services.router.synthesizer.ainvoke_with_output_retry")
@pytest.mark.asyncio
async def test_subquery_prompt_forbids_acronym_expansion_and_renders_script_rule(
    mock_ainvoke: AsyncMock,
    mock_prompt_template: MagicMock,
    mock_create_chat_model: MagicMock,
) -> None:
    mock_ainvoke.return_value = SynthesizedOutput(answer="ok", confidence=0.9)

    sub_results = [
        SubQueryResult(sub_query=SubQuery(query="q1", reasoning="r1"), answer="a1"),
        SubQueryResult(sub_query=SubQuery(query="q2", reasoning="r2"), answer="a2"),
    ]
    await ResponseSynthesizer()._synthesize_subquery_results("orig", sub_results, language="hi", script="Deva")

    rendered_template = mock_prompt_template.from_template.call_args[0][0]
    assert ABBREVIATION_EXPANSION_RULE in rendered_template

    await_args = mock_ainvoke.await_args
    assert await_args is not None
    invoke_args = await_args[0][0]
    assert "Deva script" in invoke_args["script_rule"]
    assert "Do NOT transliterate" in invoke_args["script_rule"]


def _parsing_chain() -> Runnable[BaseMessage, SynthesizedOutput]:
    # post-model portion of the production synthesizer chain, composed the same way
    return cast(
        Runnable[BaseMessage, SynthesizedOutput],
        structured_output_chain(
            RunnableLambda(lambda message: message),
            PydanticOutputParser(pydantic_object=SynthesizedOutput),
            extra_after_strip=(repair_garbled_json,),
        ),
    )


def test_synthesized_output_survives_garbled_metadata_tail() -> None:
    """A completion that breaks off inside sources_used still yields the salvaged answer."""
    garbled = (
        '{"answer": "Limit high-mercury fish such as shark and swordfish.", "sources_used": ["Sub-Query 2 results], "'
    )

    result = _parsing_chain().invoke(AIMessage(content=garbled, response_metadata={"finish_reason": "stop"}))

    assert result.answer == "Limit high-mercury fish such as shark and swordfish."
    assert result.confidence is None


def test_token_limit_truncation_rejected_not_salvaged() -> None:
    """A completion cut off by the token limit is rejected instead of salvaged mid-answer."""
    truncated = '{"answer": "It is safe to take two tablets daily, however you must not'

    with pytest.raises(TruncatedCompletionError, match="truncated"):
        _parsing_chain().invoke(AIMessage(content=truncated, response_metadata={"finish_reason": "length"}))


def test_no_answer_synthesis_statuses_cover_failure_paths() -> None:
    assert NO_ANSWER_SYNTHESIS_STATUSES == frozenset({"no_subquery_results", "no_results"})


@patch("app.services.router.synthesizer.get_error_message")
def test_no_answer_response_uses_get_error_message(mock_get_error_message: MagicMock) -> None:
    mock_get_error_message.return_value = "Desculpe, não encontrei uma resposta."

    result = ResponseSynthesizer()._no_answer_response("pt")

    mock_get_error_message.assert_called_once_with(ErrorType.NO_ANSWER_AVAILABLE, "pt")
    assert result == "Desculpe, não encontrei uma resposta."
    assert "I don't have enough information" not in result


@pytest.mark.asyncio
@patch("app.services.router.synthesizer.get_error_message")
async def test_synthesize_from_subqueries_no_results_localized(
    mock_get_error_message: MagicMock,
) -> None:
    mock_get_error_message.return_value = "Desculpe, não encontrei uma resposta."

    answer, metadata = await ResponseSynthesizer().synthesize_from_subqueries(
        original_query="O que a imprensa britânica tem relatado?",
        sub_results=[],
        language="pt",
    )

    mock_get_error_message.assert_called_once_with(ErrorType.NO_ANSWER_AVAILABLE, "pt")
    assert answer == "Desculpe, não encontrei uma resposta."
    assert metadata["synthesis_status"] == "no_subquery_results"
    assert metadata["subquery_answered_count"] == 0


def test_format_subquery_answers_marks_not_found() -> None:
    sub_results = [
        SubQueryResult(sub_query=SubQuery(query="Who is Meedan's CEO?", reasoning="r1"), answer="Ed Bice."),
        SubQueryResult(sub_query=SubQuery(query="How do I make carbonara?", reasoning="r2"), answer=None),
    ]
    formatted = ResponseSynthesizer()._format_subquery_answers(sub_results)
    assert "Ed Bice." in formatted
    assert "NOT FOUND - the sources contain no information for this sub-question" in formatted
    assert "How do I make carbonara?" in formatted


@pytest.mark.asyncio
@patch("app.services.router.synthesizer.create_chat_model")
@patch("app.services.router.synthesizer.PromptTemplate")
@patch("app.services.router.synthesizer.ainvoke_with_output_retry")
async def test_synthesize_from_subqueries_partial_calls_llm(
    mock_ainvoke: AsyncMock,
    mock_prompt_template: MagicMock,
    mock_create_chat_model: MagicMock,
) -> None:
    mock_ainvoke.return_value = SynthesizedOutput(
        answer="Ed Bice is CEO. Carbonara is not in the sources.", confidence=0.8
    )

    sub_results = [
        SubQueryResult(sub_query=SubQuery(query="Who is Meedan's CEO?", reasoning="r1"), answer="Ed Bice."),
        SubQueryResult(sub_query=SubQuery(query="How do I make carbonara?", reasoning="r2"), answer=None),
    ]
    answer, metadata = await ResponseSynthesizer().synthesize_from_subqueries(
        original_query="Who is Meedan's CEO and how do I make carbonara?",
        sub_results=sub_results,
        language="en",
    )

    mock_ainvoke.assert_awaited_once()
    rendered_template = mock_prompt_template.from_template.call_args[0][0]
    assert "NOT FOUND" in rendered_template
    assert "Never invent that missing information" in rendered_template
    await_args = mock_ainvoke.await_args
    assert await_args is not None
    prompt_answers = await_args[0][0]["subquery_answers"]
    assert "NOT FOUND" in prompt_answers
    assert await_args.kwargs["extra_after_strip"] == (repair_garbled_json,)
    assert metadata["synthesis_status"] == "partial_subquery"
    assert metadata["subquery_count"] == 2
    assert metadata["subquery_answered_count"] == 1
    assert "Carbonara is not in the sources" in answer


@pytest.mark.asyncio
@patch("app.services.router.synthesizer.create_chat_model")
@patch("app.services.router.synthesizer.PromptTemplate")
@patch("app.services.router.synthesizer.ainvoke_with_output_retry")
async def test_synthesize_from_subqueries_all_answered_is_multi(
    mock_ainvoke: AsyncMock,
    mock_prompt_template: MagicMock,
    mock_create_chat_model: MagicMock,
) -> None:
    mock_ainvoke.return_value = SynthesizedOutput(answer="both", confidence=0.9)

    sub_results = [
        SubQueryResult(sub_query=SubQuery(query="q1", reasoning="r1"), answer="a1"),
        SubQueryResult(sub_query=SubQuery(query="q2", reasoning="r2"), answer="a2"),
    ]
    _, metadata = await ResponseSynthesizer().synthesize_from_subqueries("orig", sub_results, language=None)

    assert metadata["synthesis_status"] == "multi_subquery"
    assert metadata["subquery_answered_count"] == 2
