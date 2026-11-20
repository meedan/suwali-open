import json
import re
import time
from typing import Any

from langchain_core.exceptions import OutputParserException
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.output_parsers import BaseOutputParser
from langchain_core.runnables import RunnableLambda
from langchain_core.utils.json import parse_json_markdown, parse_partial_json
from loguru import logger

from app.core.constants import JSON_STRAIGHT_QUOTES_INSTRUCTION


class TruncatedCompletionError(OutputParserException):
    """Raised when the LLM hit a token limit; retrying the same max_tokens will fail again."""


# Matches reasoning/thinking tags emitted by chain-of-thought models (e.g. GPT OSS 120B).
# Safe no-op when content contains no such tags.
REASONING_TAG_PATTERN = re.compile(r"<(reasoning|thinking|scratchpad)>.*?</\1>", re.DOTALL)


def _strip_reasoning_tags(message: BaseMessage) -> BaseMessage:
    if not isinstance(message.content, str):
        return message
    cleaned = REASONING_TAG_PATTERN.sub("", message.content).strip()
    return AIMessage(content=cleaned, response_metadata=message.response_metadata)


strip_reasoning = RunnableLambda(_strip_reasoning_tags)


# openai reports "length", bedrock (legacy and converse) reports "max_tokens"
_TRUNCATION_FINISH_REASONS = frozenset({"length", "max_tokens"})


def truncated_finish_reason(message: BaseMessage) -> str | None:
    meta = message.response_metadata or {}
    reason = meta.get("finish_reason") or meta.get("stop_reason") or meta.get("stopReason")
    if isinstance(reason, str) and reason.lower() in _TRUNCATION_FINISH_REASONS:
        return reason
    return None


def is_truncated_completion(message: BaseMessage) -> bool:
    return truncated_finish_reason(message) is not None


def _reject_truncated_completion(message: BaseMessage) -> BaseMessage:
    # a token-limit cutoff can end mid-answer and the partial-json salvage would ship the fragment
    # raise instead so the caller's fallback handles it
    reason = truncated_finish_reason(message)
    if reason is not None:
        raise TruncatedCompletionError(f"LLM completion truncated by token limit (finish_reason={reason})")
    return message


reject_truncated_completion = RunnableLambda(_reject_truncated_completion)


# Curly quotes in structural positions; rewrites are delimiter-anchored and accepted only if the result parses
_CURLY_OPENING_DELIMITER = re.compile(r"([{\[,:]\s*)[“”]")
_CURLY_CLOSING_DELIMITER = re.compile(r"[“”](\s*[:,}\]])")
# A value-closing and key-opening quote fused into one curly quote: `…value,”key":` -> `…value","key":`
_CURLY_FUSED_KEY = re.compile(r',\s*[“”]([^"“”\n]{1,64}"\s*:)')


def _curly_quote_repair_candidates(text: str) -> list[str]:
    fused = _CURLY_FUSED_KEY.sub(r'","\1', text)
    delimiters = _CURLY_CLOSING_DELIMITER.sub(r'"\1', _CURLY_OPENING_DELIMITER.sub(r'\1"', text))
    both = _CURLY_CLOSING_DELIMITER.sub(r'"\1', _CURLY_OPENING_DELIMITER.sub(r'\1"', fused))
    candidates: list[str] = []
    for candidate in (fused, delimiters, both):
        if candidate != text and candidate not in candidates:
            candidates.append(candidate)
    return candidates


def _merge_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    # json.loads is last-wins on duplicate keys, so a re-emitted key silently clobbers the complete first one
    # keep the first occurrence; a later dict value may only fill in keys the first one lacks
    merged: dict[str, Any] = {}
    for key, value in pairs:
        if key not in merged:
            merged[key] = value
        elif isinstance(merged[key], dict) and isinstance(value, dict):
            logger.warning(f"Duplicate JSON key {key!r} in LLM output; merging, first occurrence wins")
            for sub_key, sub_value in value.items():
                merged[key].setdefault(sub_key, sub_value)
        else:
            logger.warning(f"Duplicate JSON key {key!r} in LLM output; keeping first occurrence")
    return merged


def _loads(text: str) -> Any:
    # decoder's e.pos is the illegal comma; deleting it cannot touch commas inside strings
    current = text
    repaired = False
    while True:
        try:
            obj = json.loads(current, object_pairs_hook=_merge_duplicate_keys)
        except json.JSONDecodeError as e:
            if "trailing comma" not in e.msg or e.pos is None:
                raise
            stripped = current[: e.pos] + current[e.pos + 1 :]
            if stripped == current:
                raise
            current = stripped
            repaired = True
            continue
        if repaired:
            logger.warning("Repaired trailing comma in LLM JSON output")
        return obj


def loads_merging_duplicate_keys(text: str) -> Any:
    """json.loads with duplicate-key, trailing-comma, and structural-curly-quote repair,
    falling back to langchain's lenient partial parser.

    Pass as the parser arg of parse_json_markdown.
    """
    try:
        return _loads(text)
    except json.JSONDecodeError:
        pass
    for candidate in _curly_quote_repair_candidates(text):
        try:
            repaired = _loads(candidate)
        except json.JSONDecodeError:
            continue
        logger.warning("Repaired curly quotes in structural positions of LLM JSON output")
        return repaired
    return parse_partial_json(text)


def _repair_garbled_json(message: BaseMessage) -> BaseMessage:
    # canonicalize the completion before a stock parser sees it; stock parsers can't repair either failure mode
    if not isinstance(message.content, str):
        return message
    try:
        obj = parse_json_markdown(message.content, parser=loads_merging_duplicate_keys)
    except json.JSONDecodeError:
        return message
    if not isinstance(obj, dict):
        return message
    return AIMessage(content=json.dumps(obj), response_metadata=message.response_metadata)


repair_garbled_json = RunnableLambda(_repair_garbled_json)


def strict_format_instructions(parser: BaseOutputParser[Any]) -> str:
    """Parser format instructions plus the straight-ASCII-quote rule for structural JSON."""
    return f"{parser.get_format_instructions()}\n{JSON_STRAIGHT_QUOTES_INSTRUCTION}"


async def ainvoke_with_empty_content_retry(
    chain: Any,
    invoke_kw: dict[str, Any],
    *,
    component: str,
    attempts: int = 2,
) -> tuple[Any, str]:
    """Invoke chain asynchronously up to `attempts` times, retrying when AIMessage.content is empty.

    Some models stash tokens in tool_calls/structured fields with empty string content,
    which causes downstream parsers to fail on the empty string. Returns the last
    (ai_message, content) pair; content may still be empty if every attempt was empty.
    """
    ai_message: Any = None
    content = ""
    for attempt in range(attempts):
        started = time.perf_counter()
        ai_message = await chain.ainvoke(invoke_kw)
        elapsed_ms = (time.perf_counter() - started) * 1000
        # sdk-internal timeout retries are invisible here; an attempt lasting a multiple of the client timeout is the tell
        logger.info(f"{component} LLM attempt {attempt + 1}/{attempts} completed in {elapsed_ms:.0f}ms")
        raw_content = ai_message.content if hasattr(ai_message, "content") else ""
        content = raw_content if isinstance(raw_content, str) else ""
        if content.strip():
            break
        if attempt < attempts - 1:
            completion_tokens: Any = "?"
            try:
                completion_tokens = ai_message.response_metadata.get("token_usage", {}).get("completion_tokens", "?")
            except AttributeError:
                pass
            logger.warning(
                f"{component} LLM returned empty content on attempt {attempt + 1}/{attempts}; retrying "
                f"(completion_tokens={completion_tokens})"
            )
    return ai_message, content
