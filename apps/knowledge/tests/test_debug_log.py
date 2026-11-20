"""Tests for the per-request debug log returned in ChatResponse.log."""

import asyncio
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from loguru import logger

from app.core.context import current_step_path, pipeline_step
from app.core.debug_log import TRUNCATE, TRUNCATED_MAX_CHARS, debug_log_capture
from app.services.neo4j_timing import neo4j_stage, submit_in_context


def test_disabled_capture_yields_none() -> None:
    with debug_log_capture(False) as debug_log:
        logger.info("not captured")

    assert debug_log is None


def test_line_starts_with_elapsed_ms_since_start() -> None:
    with debug_log_capture(True, time.perf_counter() - 1.5) as debug_log:
        logger.info("hello")

    assert debug_log is not None
    [line] = debug_log.lines
    match = re.fullmatch(r"\+(\d+)ms hello", line)
    assert match is not None
    assert int(match.group(1)) >= 1500


def test_captures_info_and_above_only() -> None:
    with debug_log_capture(True) as debug_log:
        logger.debug("debug line")
        logger.info("info line")
        logger.warning("warning line")
        logger.error("error line")

    assert debug_log is not None
    lines = [line.split(" ", 1)[1] for line in debug_log.lines]
    # the level is shown only from WARNING up
    assert lines == ["info line", "WARNING warning line", "ERROR error line"]


def test_line_is_labeled_with_the_step_path() -> None:
    with debug_log_capture(True) as debug_log:
        with pipeline_step("internal_kb"), neo4j_stage("hyde"):
            logger.info("in hyde")
        logger.info("outside")

    assert debug_log is not None
    assert debug_log.lines[0].endswith(" [internal_kb/hyde] in hyde")
    assert "[" not in debug_log.lines[1]


def test_same_step_nested_is_not_repeated() -> None:
    with pipeline_step("retrieval"), neo4j_stage("retrieval"):
        assert current_step_path() == "retrieval"
    assert current_step_path() is None


def test_only_marked_lines_are_truncated() -> None:
    long_text = "x" * (TRUNCATED_MAX_CHARS + 50)
    with debug_log_capture(True) as debug_log:
        logger.info(long_text)
        logger.bind(**{TRUNCATE: True}).info(long_text)

    assert debug_log is not None
    full, truncated = (line.split(" ", 1)[1] for line in debug_log.lines)
    assert full == long_text
    assert truncated == "x" * TRUNCATED_MAX_CHARS + "..."


def test_exception_is_summarized_without_traceback() -> None:
    with debug_log_capture(True) as debug_log:
        try:
            raise ValueError("bad value")
        except ValueError:
            logger.opt(exception=sys.exc_info()).error("Step failed")

    assert debug_log is not None
    [line] = debug_log.lines
    assert line.endswith("ERROR Step failed | ValueError: bad value")
    assert "Traceback" not in line


def test_handler_is_removed_after_the_block() -> None:
    with debug_log_capture(True) as debug_log:
        logger.info("inside")
    logger.info("after")

    assert debug_log is not None
    assert len(debug_log.lines) == 1


async def test_concurrent_requests_never_mix_lines() -> None:
    async def request(name: str) -> list[str]:
        with debug_log_capture(True) as debug_log:
            for i in range(5):
                logger.info(f"{name} {i}")
                await asyncio.sleep(0)
            # asyncio.to_thread copies the context into the worker thread
            await asyncio.to_thread(logger.info, f"{name} thread")
        assert debug_log is not None
        return [line.split(" ", 1)[1] for line in debug_log.lines]

    first, second = await asyncio.gather(request("a"), request("b"))

    assert first == [f"a {i}" for i in range(5)] + ["a thread"]
    assert second == [f"b {i}" for i in range(5)] + ["b thread"]


def test_threads_capture_only_with_copied_context() -> None:
    with debug_log_capture(True) as debug_log, ThreadPoolExecutor(max_workers=1) as executor:
        with pipeline_step("rephrasing"):
            submit_in_context(executor, logger.info, "with context").result()
        thread = threading.Thread(target=logger.info, args=("without context",))
        thread.start()
        thread.join()

    assert debug_log is not None
    [line] = debug_log.lines
    assert line.endswith(" [rephrasing] with context")
