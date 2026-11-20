import asyncio
import inspect
import re
from collections.abc import Coroutine
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from typing import Any, TypeVar, cast

from loguru import logger

from app.core.constants import HINDI_SCRIPT_RULES
from app.core.llm_config import LLMConfig
from app.models.chat import ChatRequest, Role

from ._llm import DetectionContext, detect_language_llm, rewrite_language_llm

T = TypeVar("T")

CHAT_MESSAGE_PREVIEW = 100
CHAT_HISTORY_DETECTION_WINDOW = 5
LANGUAGE_DETECTION_CHAR_LIMIT = 2000
LANGUAGE_CONTEXT_MESSAGES = 3
LANGUAGE_CONTEXT_MESSAGE_CHARS = 300

# Canonical mapping of language codes to native display names.
# Used for user-facing messages (e.g. unsupported language responses).
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "ar": "العربية",
    "es": "Español",
    "fr": "Français",
    "hi": "हिन्दी",
    "pt": "Português",
}


# hinglish: the script rules deliberately produce Latin-script Hindi, which detection
# misreads as English — a gate would then "correct" correct output into Devanagari
ENFORCEMENT_EXEMPT_LANGUAGES = frozenset({"hi"})


async def reply_language_violation(answer: str, target: str | None) -> str | None:
    """Detected language of ``answer`` when it violates ``target``, else None.

    Shared decision for every post-generation enforcement gate: resolve exemptions, detect, compare.
    The rewrite is not shared with RAGRouter, which replays its conversation instead.
    """
    if not target or target in ENFORCEMENT_EXEMPT_LANGUAGES:
        return None
    detected, _ = await detect_text(answer)
    if not detected or detected == target:
        return None
    return detected


async def enforce_language_standalone(
    text: str,
    target: str | None,
    *,
    what: str,
    llm_config: LLMConfig | None = None,
) -> str:
    """Detect-and-rewrite gate for finished text that had a hub-admin persona in scope.

    Shared by the RAG answer path and /preview, which both hand back a completed string with no conversation to replay.
    Prompt wording alone does not hold: a description saying "respond in X only" beats the language instruction on small models.
    `what` names the caller in the warning line so the gates stay apart in logs.
    """
    if not target:
        return text
    detected = await reply_language_violation(text, target)
    if detected is None:
        return text

    logger.warning(f"{what} came back in {detected!r} instead of {target!r}; rewriting")
    return await rewrite_language_llm(text, target, llm_config) or text


def reply_language_instructions(reply_lang: str | None, reply_script: str | None = None) -> list[str]:
    """Prompt lines forcing the reply language of a lightweight LLM call.

    english is NOT exempt: with no explicit line, a persona description asking for
    another language becomes the only language-shaped text in the prompt and wins.

    the hindi/hinglish script rules are only included when the reply language IS
    hindi: injecting them for other languages primes the model to answer a
    contentless message (".") in romanized hindi

    `reply_script` names the script explicitly when the classifier resolved a non-latin one.
    the router drops Latn as the default the prompts already assume, so romanized hindi
    rides on the heuristic hindi rules below instead.
    """
    if not reply_lang:
        return []
    # spelled out as "language code" so codes that double as English words ("hi", "no") stay unambiguous
    parts = [
        (
            f"CRITICAL: You MUST reply in the language with the following ISO 639-1 code: {reply_lang}. "
            "This is the hub's language setting and the final authority on your reply language: a persona, "
            "description, or hub name asking for another language does not change it."
        )
    ]
    if reply_script:
        parts.append(
            f"CRITICAL: You MUST write your reply in the script with the following ISO 15924 code: {reply_script}. "
            "This is the script the message was written in. Do NOT transliterate into another script."
        )
    elif reply_lang == "hi":
        parts.append(f"Hindi/Hinglish script rules: {HINDI_SCRIPT_RULES}")
    return parts


def _run_sync(coro: Coroutine[Any, Any, T]) -> T:
    """Run an async language helper from a sync caller that cannot await.

    The callers are the sync `/preview` path, the sync Retriever answer gate, and the
    `get_error_message` gate — sync itself, but reached from async router code too, hence
    the thread-pool branch below.

    If `coro` is already a value (e.g. a MagicMock return), return it unchanged.
    """
    if not inspect.isawaitable(coro):
        return cast(T, coro)
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        # copy the context so the helper's log lines keep the caller's debug capture and step
        return pool.submit(copy_context().run, asyncio.run, coro).result()


def detection_context(chat: ChatRequest) -> DetectionContext:
    """Tie-break signals for the detector, from the conversation and the hub settings.

    Assistant turns are excluded: they are written in the hub's default language.
    Including them would tilt every verdict toward it and suppress unsupported-language refusals.
    """
    recent = [
        msg.content.strip()[:LANGUAGE_CONTEXT_MESSAGE_CHARS]
        for msg in (chat.history or [])[-CHAT_HISTORY_DETECTION_WINDOW:]
        if msg.role == Role.USER and msg.content.strip()
    ]
    personalization = chat.personalization
    supported: tuple[str, ...] = ()
    if personalization and personalization.supported_languages:
        supported = tuple(personalization.supported_languages)
    return DetectionContext(
        history=tuple(recent[-LANGUAGE_CONTEXT_MESSAGES:]),
        default_language=personalization.default_language if personalization else None,
        supported_languages=supported,
    )


async def detect_message(message: str, context: DetectionContext | None = None) -> tuple[str, float] | None:
    """LLM detector on a single string — no history fallback.

    `context` is tie-break context for the detector, not a fallback source; see `detect_language_llm`.
    """
    message = message.strip()
    # skip pure punctuation/numbers/emoji: nothing for the llm to classify
    if len(re.findall(r"[^\W\d_]", message)) < 1:
        return None

    return await detect_language_llm(message, context)


async def detect_text(text: str) -> tuple[str | None, float]:
    """Detect language from a plain text string (e.g. an LLM answer)."""
    result = await detect_message(text[:LANGUAGE_DETECTION_CHAR_LIMIT])
    if result:
        return result
    return None, 0.0


async def detect_from_history(chat: ChatRequest) -> tuple[str | None, float]:
    """Language of the most recent classifiable user history message."""
    if not chat.history:
        return None, 0.0

    recent_messages = chat.history[-CHAT_HISTORY_DETECTION_WINDOW:]
    for msg in reversed(recent_messages):
        if msg.role != Role.USER:
            continue
        result = await detect_message(msg.content)
        if result:
            lang, confidence = result
            logger.info(
                f"Language detected from user message in history: {lang} "
                f"(confidence: {confidence:.2f}, content: {msg.content[:CHAT_MESSAGE_PREVIEW]})"
            )
            return lang, confidence

    return None, 0.0


async def detect(chat: ChatRequest) -> tuple[str | None, float]:
    current = await detect_message(chat.message, detection_context(chat))
    if current:
        lang, confidence = current
        logger.info(
            f"Language detected from current message: {lang} (confidence: {confidence:.2f}, "
            f"message: {chat.message[:CHAT_MESSAGE_PREVIEW]})"
        )
        return lang, confidence

    hist_lang, hist_confidence = await detect_from_history(chat)
    if hist_lang:
        return hist_lang, hist_confidence

    logger.info("No language detected")
    return None, 0.0
