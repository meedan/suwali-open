from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum

import tiktoken

from app.core.config import Config

_TOKENIZER = tiktoken.get_encoding("cl100k_base")


class ValidationCode(str, Enum):
    NO_TEXT_FOUND = "NO_TEXT_FOUND"
    TEXT_TOO_LARGE = "TEXT_TOO_LARGE"
    PDF_PASSWORD_PROTECTED = "PDF_PASSWORD_PROTECTED"  # nosec B105 - validation error code, not a credential


@dataclass
class IngestionValidationContext:
    text: str
    document_id: str
    hub_id: int
    file_url: str = ""


@dataclass
class ValidationResult:
    passed: bool
    message: str = ""


class IngestionValidationError(Exception):
    """Raised when a document fails pre-ingestion validation.

    Deterministic: retrying ingestion will not change the outcome, since the
    input itself is rejected. Callers should surface `.code` to the CMS API
    callback rather than treating this like a transient failure.
    """

    def __init__(self, code: ValidationCode, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class IngestionValidator(ABC):
    code: ValidationCode

    @abstractmethod
    def validate(self, context: IngestionValidationContext) -> ValidationResult: ...


class EmptyTextValidator(IngestionValidator):
    code = ValidationCode.NO_TEXT_FOUND

    def validate(self, context: IngestionValidationContext) -> ValidationResult:
        if not context.text or not context.text.strip():
            return ValidationResult(
                passed=False,
                message=(
                    f"No extractable text for document {context.document_id} "
                    f"(file_url={context.file_url or 'none'}); the source may be a scanned/image-only PDF"
                ),
            )
        return ValidationResult(passed=True)


class MaxTextSizeValidator(IngestionValidator):
    code = ValidationCode.TEXT_TOO_LARGE

    def validate(self, context: IngestionValidationContext) -> ValidationResult:
        max_tokens = Config().max_text_ingestion_size
        token_count = len(_TOKENIZER.encode(context.text))
        if token_count > max_tokens:
            return ValidationResult(
                passed=False,
                message=(
                    f"Document {context.document_id} text is {token_count} tokens, "
                    f"exceeding the {max_tokens} token limit"
                ),
            )
        return ValidationResult(passed=True)


DEFAULT_VALIDATORS: list[IngestionValidator] = [EmptyTextValidator(), MaxTextSizeValidator()]


def run_validations(
    context: IngestionValidationContext,
    validators: list[IngestionValidator] | None = None,
) -> None:
    for validator in validators if validators is not None else DEFAULT_VALIDATORS:
        result = validator.validate(context)
        if not result.passed:
            raise IngestionValidationError(validator.code, result.message)
