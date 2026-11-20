from unittest.mock import MagicMock, patch

from app.core.constants import JSON_STRAIGHT_QUOTES_INSTRUCTION
from app.services.rephraser import QueryRephraser, QueryRephraserOutput


def _configure_parser(parser_patch: MagicMock) -> MagicMock:
    mock_parser_instance = MagicMock()
    mock_parser_instance.get_format_instructions.return_value = "mock-format"
    parser_patch.return_value = mock_parser_instance
    return mock_parser_instance


@patch("app.services.rephraser.LLMConfig")
@patch("app.services.rephraser.create_chat_model")
@patch("app.services.rephraser.PydanticOutputParser")
@patch("app.services.rephraser.PromptTemplate.from_template")
@patch("app.services.rephraser.invoke_with_output_retry")
def test_rephrase_returns_variations(
    mock_invoke: MagicMock,
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
) -> None:
    """The pipeline should return the variations supplied by the mocked LLM."""
    mock_parser_instance = _configure_parser(mock_parser_factory)
    expected_output = QueryRephraserOutput(
        variations=["alt. phrasing 1", "alt. phrasing 2"], reasoning="mocked reasoning"
    )
    mock_invoke.return_value = expected_output

    rephraser = QueryRephraser()
    variations = rephraser.rephrase("Original query", num_variations=2)

    mock_prompt_from_template.assert_called_once_with(QueryRephraser.INSTRUCTIONS)
    mock_parser_factory.assert_called_once_with(pydantic_object=QueryRephraserOutput)
    mock_parser_instance.get_format_instructions.assert_called_once()
    mock_create.assert_called_once()
    mock_invoke.assert_called_once()
    payload = mock_invoke.call_args[0][0]
    assert payload == {
        "query": "Original query",
        "num_variations": 2,
        "output_format": f"mock-format\n{JSON_STRAIGHT_QUOTES_INSTRUCTION}",
    }
    assert mock_invoke.call_args.kwargs["prompt"] is mock_prompt_from_template.return_value
    assert mock_invoke.call_args.kwargs["model"] is mock_create.return_value
    assert mock_invoke.call_args.kwargs["parser"] is mock_parser_instance
    assert mock_invoke.call_args.kwargs["component"] == "Rephraser"

    assert variations == expected_output.variations


@patch("app.services.rephraser.LLMConfig")
@patch("app.services.rephraser.create_chat_model")
@patch("app.services.rephraser.PydanticOutputParser")
@patch("app.services.rephraser.PromptTemplate.from_template")
@patch("app.services.rephraser.invoke_with_output_retry")
def test_rephrase_returns_empty_on_exception(
    mock_invoke: MagicMock,
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
) -> None:
    """Any exception in the chained pipeline should result in an empty list."""
    mock_parser_instance = _configure_parser(mock_parser_factory)
    mock_invoke.side_effect = RuntimeError("underlying LLM failure")

    rephraser = QueryRephraser()
    variations = rephraser.rephrase("Original query with default count")

    mock_invoke.assert_called_once()
    payload = mock_invoke.call_args[0][0]
    assert payload == {
        "query": "Original query with default count",
        "num_variations": 2,
        "output_format": f"mock-format\n{JSON_STRAIGHT_QUOTES_INSTRUCTION}",
    }
    assert variations == []
    mock_parser_instance.get_format_instructions.assert_called_once()


def test_instructions_keep_user_premises_out_of_variations() -> None:
    """A rephrased query built around a value the user asserted retrieves the answer that confirms
    it; the rule keeps the asserted value out of the variations."""
    assert "do not carry that value into the variations as a premise" in QueryRephraser.INSTRUCTIONS
