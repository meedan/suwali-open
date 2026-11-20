"""Per-request copy of the log, returned as ChatResponse.log when the chat request sets debug.

Lines are captured through a loguru handler that only accepts records logged inside the request's own
context, so concurrent requests (and hubs) never see each other's lines. Worker threads must be started
with a copied context (asyncio.to_thread, submit_in_context) for their lines to be captured.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Generator
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from typing import TYPE_CHECKING

from loguru import logger

from app.core.context import current_step_path

if TYPE_CHECKING:
    # stub-only types; loguru doesn't define them at runtime
    from loguru import Message, Record

# bind this on a log call whose message dumps user input/output, prompts or Cypher: its debug copy is shortened
TRUNCATE = "debug_truncate"
TRUNCATED_MAX_CHARS = 300


class DebugLog:
    def __init__(self, start: float) -> None:
        self._start = start
        # lines arrive from worker threads too
        self._lock = threading.Lock()
        self._lines: list[str] = []

    @property
    def lines(self) -> list[str]:
        with self._lock:
            return list(self._lines)

    def write(self, message: Message) -> None:
        line = format_line(message.record, (time.perf_counter() - self._start) * 1000)
        with self._lock:
            self._lines.append(line)


def format_line(record: Record, elapsed_ms: float) -> str:
    text = str(record["message"])
    if record["extra"].get(TRUNCATE) and len(text) > TRUNCATED_MAX_CHARS:
        text = text[:TRUNCATED_MAX_CHARS] + "..."
    exception = record["exception"]
    if exception is not None and exception.type is not None:
        text = f"{text} | {exception.type.__name__}: {exception.value}"

    parts = [f"+{elapsed_ms:.0f}ms"]
    step = current_step_path()
    if step:
        parts.append(f"[{step}]")
    if record["level"].no >= logging.WARNING:
        parts.append(record["level"].name)
    parts.append(text)
    return " ".join(parts)


_current: ContextVar[DebugLog | None] = ContextVar("debug_log", default=None)


@contextmanager
def debug_log_capture(enabled: bool, start: float | None = None) -> Generator[DebugLog | None, None, None]:
    """Capture INFO+ lines logged inside this block, timed from `start` (perf_counter); yields None when disabled."""
    if not enabled:
        yield None
        return

    capture = DebugLog(start if start is not None else time.perf_counter())
    token = _current.set(capture)
    # INFO matches what production ships to CloudWatch
    handler_id = logger.add(
        capture.write, level=logging.INFO, format="{message}", filter=lambda _: _current.get() is capture
    )
    try:
        yield capture
    finally:
        # setup_logging() calls logger.remove(), which may already have dropped the handler
        with suppress(ValueError):
            logger.remove(handler_id)
        _current.reset(token)
