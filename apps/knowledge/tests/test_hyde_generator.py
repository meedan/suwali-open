from datetime import date
from unittest.mock import MagicMock, patch

from app.core.constants import JSON_STRAIGHT_QUOTES_INSTRUCTION
from app.services.hyde_generator import HydeGenerator, HydeOutput


def _configure_parser(parser_patch: MagicMock) -> MagicMock:
    mock_parser_instance = MagicMock()
    mock_parser_instance.get_format_instructions.return_value = "mock-format"
    parser_patch.return_value = mock_parser_instance
    return mock_parser_instance


def test_instructions_keep_abbreviations_unexpanded() -> None:
    """A wrong expansion embeds a hypothetical about a different topic, steering retrieval
    away from the documents that use the bare acronym. The guard must sit in the prompt
    because "include plausible specific details" otherwise invites inventing one."""
    assert "Copy any abbreviation, acronym, or initialism from the question exactly as written" in (
        HydeGenerator.INSTRUCTIONS
    )
    assert "Do NOT expand it or guess what it stands for" in HydeGenerator.INSTRUCTIONS


@patch("app.services.hyde_generator.LLMConfig")
@patch("app.services.hyde_generator.create_chat_model")
@patch("app.services.hyde_generator.PydanticOutputParser")
@patch("app.services.hyde_generator.PromptTemplate.from_template")
@patch("app.services.hyde_generator.invoke_with_output_retry")
def test_generate_returns_hypothetical_document(
    mock_invoke: MagicMock,
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
) -> None:
    """The pipeline should return the hypothetical document supplied by the mocked LLM."""
    mock_parser_instance = _configure_parser(mock_parser_factory)
    expected_output = HydeOutput(
        hypothetical_document="The Fremen are a desert people native to the planet Arrakis.",
        reasoning="Generated a passage about Fremen based on the query context.",
    )
    mock_invoke.return_value = expected_output

    generator = HydeGenerator()
    result = generator.generate("What are the Fremen?")

    mock_prompt_from_template.assert_called_once_with(HydeGenerator.INSTRUCTIONS)
    mock_parser_factory.assert_called_once_with(pydantic_object=HydeOutput)
    mock_parser_instance.get_format_instructions.assert_called_once()
    mock_create.assert_called_once()
    mock_invoke.assert_called_once()
    payload = mock_invoke.call_args[0][0]
    assert payload == {
        "query": "What are the Fremen?",
        "today": date.today().isoformat(),
        "language_instruction": "",
        "output_format": f"mock-format\n{JSON_STRAIGHT_QUOTES_INSTRUCTION}",
    }
    assert mock_invoke.call_args.kwargs["prompt"] is mock_prompt_from_template.return_value
    assert mock_invoke.call_args.kwargs["model"] is mock_create.return_value
    assert mock_invoke.call_args.kwargs["parser"] is mock_parser_instance
    assert mock_invoke.call_args.kwargs["component"] == "HyDE"

    assert result == expected_output.hypothetical_document


@patch("app.services.hyde_generator.LLMConfig")
@patch("app.services.hyde_generator.create_chat_model")
@patch("app.services.hyde_generator.PydanticOutputParser")
@patch("app.services.hyde_generator.PromptTemplate.from_template")
@patch("app.services.hyde_generator.invoke_with_output_retry")
def test_generate_with_language_includes_instruction(
    mock_invoke: MagicMock,
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
) -> None:
    """When a non-English language is specified, the language instruction should be included."""
    _configure_parser(mock_parser_factory)
    expected_output = HydeOutput(
        hypothetical_document="Los Fremen son un pueblo del desierto.",
        reasoning="Generated a passage in Spanish.",
    )
    mock_invoke.return_value = expected_output

    generator = HydeGenerator()
    result = generator.generate("¿Quiénes son los Fremen?", lang="es")

    call_args = mock_invoke.call_args[0][0]
    assert "ES" in call_args["language_instruction"]
    assert result == expected_output.hypothetical_document


@patch("app.services.hyde_generator.LLMConfig")
@patch("app.services.hyde_generator.create_chat_model")
@patch("app.services.hyde_generator.PydanticOutputParser")
@patch("app.services.hyde_generator.PromptTemplate.from_template")
@patch("app.services.hyde_generator.invoke_with_output_retry")
def test_generate_with_english_language_no_instruction(
    mock_invoke: MagicMock,
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
) -> None:
    """When English language is specified, no language instruction should be included."""
    _configure_parser(mock_parser_factory)
    expected_output = HydeOutput(
        hypothetical_document="The Fremen are a desert people.",
        reasoning="Generated in English.",
    )
    mock_invoke.return_value = expected_output

    generator = HydeGenerator()
    result = generator.generate("What are the Fremen?", lang="en")

    call_args = mock_invoke.call_args[0][0]
    assert call_args["language_instruction"] == ""
    assert result == expected_output.hypothetical_document


@patch("app.services.hyde_generator.LLMConfig")
@patch("app.services.hyde_generator.create_chat_model")
@patch("app.services.hyde_generator.PydanticOutputParser")
@patch("app.services.hyde_generator.PromptTemplate.from_template")
@patch("app.services.hyde_generator.invoke_with_output_retry")
def test_generate_passes_today_date(
    mock_invoke: MagicMock,
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
) -> None:
    """The invoke call should include today's date so temporal queries generate grounded hypothetical docs."""
    _configure_parser(mock_parser_factory)
    mock_invoke.return_value = HydeOutput(
        hypothetical_document="The next election is in 2026.",
        reasoning="Generated with date awareness.",
    )

    generator = HydeGenerator()
    generator.generate("When is the next election?")

    call_args = mock_invoke.call_args[0][0]
    assert "today" in call_args
    assert call_args["today"] == date.today().isoformat()


@patch("app.services.hyde_generator.LLMConfig")
@patch("app.services.hyde_generator.create_chat_model")
@patch("app.services.hyde_generator.PydanticOutputParser")
@patch("app.services.hyde_generator.PromptTemplate.from_template")
@patch("app.services.hyde_generator.invoke_with_output_retry")
def test_generate_returns_none_on_exception(
    mock_invoke: MagicMock,
    mock_prompt_from_template: MagicMock,
    mock_parser_factory: MagicMock,
    mock_create: MagicMock,
    mock_llm_config: MagicMock,
) -> None:
    """Any exception in the chained pipeline should result in None."""
    _configure_parser(mock_parser_factory)
    mock_invoke.side_effect = RuntimeError("underlying LLM failure")

    generator = HydeGenerator()
    result = generator.generate("What are the Fremen?")

    mock_invoke.assert_called_once()
    assert result is None
