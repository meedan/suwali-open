from unittest.mock import MagicMock, patch

import pytest

from app.core.ingestion_validation import (
    EmptyTextValidator,
    IngestionValidationContext,
    IngestionValidationError,
    MaxTextSizeValidator,
    ValidationCode,
    run_validations,
)


def _context(text: str) -> IngestionValidationContext:
    return IngestionValidationContext(text=text, document_id="doc1", hub_id=1, file_url="https://example.com/x.pdf")


def test_empty_text_validator_fails_on_blank_text() -> None:
    result = EmptyTextValidator().validate(_context("   "))
    assert result.passed is False
    assert "doc1" in result.message


def test_empty_text_validator_passes_on_nonblank_text() -> None:
    result = EmptyTextValidator().validate(_context("some text"))
    assert result.passed is True


@patch("app.core.ingestion_validation.Config")
def test_max_text_size_validator_fails_when_over_limit(mock_config: MagicMock) -> None:
    mock_config.return_value.max_text_ingestion_size = 3
    result = MaxTextSizeValidator().validate(_context("this text has way more than three tokens in it"))
    assert result.passed is False
    assert "doc1" in result.message


@patch("app.core.ingestion_validation.Config")
def test_max_text_size_validator_passes_when_under_limit(mock_config: MagicMock) -> None:
    mock_config.return_value.max_text_ingestion_size = 1000
    result = MaxTextSizeValidator().validate(_context("a short document"))
    assert result.passed is True


def test_run_validations_raises_with_code_on_first_failure() -> None:
    with pytest.raises(IngestionValidationError) as exc_info:
        run_validations(_context(""))

    assert exc_info.value.code == ValidationCode.NO_TEXT_FOUND


def test_run_validations_passes_when_all_validators_pass() -> None:
    run_validations(_context("perfectly fine document text"))


@patch("app.core.ingestion_validation.Config")
def test_run_validations_short_circuits_on_first_failing_validator(mock_config: MagicMock) -> None:
    mock_config.return_value.max_text_ingestion_size = 1000
    never_called = MagicMock()
    never_called.validate.side_effect = AssertionError("should not be reached")

    failing = EmptyTextValidator()
    with pytest.raises(IngestionValidationError, match="doc1"):
        run_validations(_context(""), validators=[failing, never_called])

    never_called.validate.assert_not_called()
