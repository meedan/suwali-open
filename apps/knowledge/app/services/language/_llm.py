import re
import sys
from typing import NamedTuple

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import ainvoke_with_output_retry
from app.core.output_parsing import strict_format_instructions

LLM_CONFIDENCE = 0.95

_INSTRUCTIONS = """You identify the language a piece of text is written in.

## Text
{text}
{context}
## Task
Return the ISO 639-1 code (two letters, e.g. "es", "en", "fr") of the language the
text is written in. Judge only by the text, not by any names or topics it mentions.

Closely related languages are the usual mistake: Portuguese and Spanish, Hindi and
Urdu, Indonesian and Malay. Decide between them on function words, spelling and
grammar that belong to only one of them, not on overall resemblance.

Accents are weak evidence in either direction. People routinely type without them, so
their absence rules nothing out: an unaccented word is not thereby a word of whichever
language happens to spell it that way. Decide on vocabulary and grammar instead.

Return "unknown" if there is no clear evidence the text is *written in* a
language — for example numbers, symbols, codes/hashtags, or text that is only
proper names. Proper names alone are not evidence of a language.

## Output Format
{output_format}
"""


_CONTEXT = """
## Context
{items}

This is context, not the text you are classifying. Use it only to settle a choice the
text itself cannot settle. Prefer the earlier messages over the chatbot's languages,
and prefer the chatbot's languages over an unconstrained guess.

If there are no earlier messages, the chatbot's languages are the only grounding
signal: if the text is short, misspelled, or could belong to several languages,
prefer a served language when that is a plausible reading — including as a typo
of that language.

When the text carries clear evidence of a language, ignore all of it: people switch
language mid-conversation, and people write to a chatbot in a language it does not serve.
"""


class DetectionContext(NamedTuple):
    """Weak signals that can settle a verdict the text alone cannot."""

    history: tuple[str, ...] = ()
    default_language: str | None = None
    supported_languages: tuple[str, ...] = ()


def _hub_languages_item(context: DetectionContext) -> str | None:
    if context.supported_languages:
        parts = [
            f"{code} (default)" if code == context.default_language else code for code in context.supported_languages
        ]
        line = f"This chatbot serves these ISO 639-1 languages: {', '.join(parts)}."
        if context.default_language and context.default_language not in context.supported_languages:
            line += f" Its default language is the ISO 639-1 code {context.default_language}."
        return line
    if context.default_language:
        return f"This chatbot's default language is the ISO 639-1 code {context.default_language}."
    return None


def _format_context(context: DetectionContext | None) -> str:
    if not context:
        return ""

    items = []
    if context.history:
        turns = "\n".join(f"- {message}" for message in context.history)
        items.append(f"Earlier messages from the same person:\n{turns}")
    hub_languages = _hub_languages_item(context)
    if hub_languages:
        items.append(hub_languages)

    if not items:
        return ""
    return _CONTEXT.format(items="\n\n".join(items))


class LanguageDetectionOutput(BaseModel):
    language: str = Field(description='ISO 639-1 code of the text language, or "unknown"')


@LLMCircuitBreaker()
async def _classify(text: str, context: DetectionContext | None, llm_config: LLMConfig) -> str:
    parser: PydanticOutputParser[LanguageDetectionOutput] = PydanticOutputParser(
        pydantic_object=LanguageDetectionOutput
    )
    model = create_chat_model(llm_config.llm_language_detector, llm_config)
    result: LanguageDetectionOutput = await ainvoke_with_output_retry(
        {
            "text": text,
            "context": _format_context(context),
            "output_format": strict_format_instructions(parser),
        },
        prompt=PromptTemplate.from_template(_INSTRUCTIONS),
        model=model,
        parser=parser,
        component="Language detector",
    )
    return result.language.strip().lower()


_REWRITE_INSTRUCTIONS = (
    "Rewrite the user's text in the language with the following ISO 639-1 code: {target}. "
    "Keep the meaning, tone, and level of detail identical. "
    "Plain text only. Output only the rewritten text."
)


async def rewrite_standalone(text: str, instructions: str, llm_config: LLMConfig | None = None) -> str | None:
    """Rewrite `text` per `instructions`, or None when the call fails.

    Standalone by design: no persona, no history, no retrieved context.
    Text that talked a model into a behavior must not get to argue its own correction.
    Shared by the language gate and the directive gate so the contract cannot drift.
    """
    config = llm_config or LLMConfig()
    try:
        model = create_chat_model(config.llm_error_handler, config)
        response = await model.ainvoke([("system", instructions), ("user", text)])
    except Exception as e:
        logger.opt(exception=sys.exc_info()).warning(f"Standalone rewrite failed: {e}")
        return None
    return str(response.content).strip() or None


async def rewrite_language_llm(text: str, target: str, llm_config: LLMConfig | None = None) -> str | None:
    """Rewrite `text` into `target`, or None when the call fails."""
    return await rewrite_standalone(text, _REWRITE_INSTRUCTIONS.format(target=target), llm_config)


async def detect_language_llm(
    text: str,
    context: DetectionContext | None = None,
    llm_config: LLMConfig | None = None,
) -> tuple[str, float] | None:
    """LLM verdict on the language of a piece of text.

    `context` breaks ties the text cannot settle alone; it never outranks the text.

    Never filtered by supported languages: any hub-level restriction is enforced
    by the preflight refusal gate, not by detection.
    Returns (lang, confidence) or None.
    """
    try:
        lang = await _classify(text, context, llm_config or LLMConfig())
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"LLM language detection failed: {e}")
        return None

    if not lang or lang == "unknown":
        return None

    # llm output is untrusted: anything that isn't a plausible iso 639-1 code
    # (e.g. "spanish", a sentence) must not leak out as a language code
    if not re.fullmatch(r"[a-z]{2}", lang):
        logger.warning(f"LLM language detection returned invalid code: {lang!r}")
        return None

    return lang, LLM_CONFIDENCE
