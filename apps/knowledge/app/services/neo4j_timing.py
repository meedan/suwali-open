"""Per-stage Neo4j query timing for one chat answer, stored in its metadata as neo4j_duration_details.

Queries count toward the innermost active stage only, so nested stages never double-count.
Thread pools don't inherit context variables: submit work through submit_in_context so its queries keep their stage.
"""

import threading
import time
from collections.abc import Callable, Generator
from concurrent.futures import Executor, Future
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from typing import Any, ParamSpec, TypeVar

from neo4j import Driver

from app.core.context import pipeline_step
from app.models.chat import Neo4jStageTiming

# queries that ran outside every stage timer, e.g. retries after the initial search
UNTIMED_STAGE = "untimed"

Interval = tuple[float, float]

P = ParamSpec("P")
T = TypeVar("T")


def _union_ms(intervals: list[Interval]) -> float:
    """Length of the union of [start, end] intervals in ms; overlapping time counts once."""
    total = 0.0
    current_start: float | None = None
    current_end = 0.0
    for start, end in sorted(intervals):
        if current_start is None or start > current_end:
            if current_start is not None:
                total += current_end - current_start
            current_start, current_end = start, end
        else:
            current_end = max(current_end, end)
    if current_start is not None:
        total += current_end - current_start
    return total * 1000


class Neo4jTimingRecorder:
    def __init__(self) -> None:
        # stages run in parallel threads, so every write goes through the lock
        self._lock = threading.Lock()
        self._queries: dict[str, list[Interval]] = {}
        self._stages: dict[str, list[Interval]] = {}

    def add_query(self, stage: str, start: float, end: float) -> None:
        with self._lock:
            self._queries.setdefault(stage, []).append((start, end))

    def add_stage(self, stage: str, start: float, end: float) -> None:
        with self._lock:
            self._stages.setdefault(stage, []).append((start, end))

    def summary(self) -> dict[str, Neo4jStageTiming]:
        """Stages that ran at least one query; a losing strategy still running in the background is cut off here."""
        with self._lock:
            queries = {stage: list(intervals) for stage, intervals in self._queries.items()}
            stages = {stage: list(intervals) for stage, intervals in self._stages.items()}

        result: dict[str, Neo4jStageTiming] = {}
        for stage, intervals in queries.items():
            durations = [(end - start) * 1000 for start, end in sorted(intervals)]
            stage_intervals = stages.get(stage)
            result[stage] = Neo4jStageTiming(
                queries=[round(d, 1) for d in durations],
                total_ms=round(sum(durations), 1),
                wall_ms=round(_union_ms(intervals), 1),
                stage_ms=round(_union_ms(stage_intervals), 1) if stage_intervals else None,
            )
        return result


_recorder: ContextVar[Neo4jTimingRecorder | None] = ContextVar("neo4j_timing_recorder", default=None)
_stage: ContextVar[str | None] = ContextVar("neo4j_timing_stage", default=None)


@contextmanager
def neo4j_timing() -> Generator[Neo4jTimingRecorder, None, None]:
    """Collect Neo4j timings for every query run inside this block."""
    recorder = Neo4jTimingRecorder()
    token = _recorder.set(recorder)
    try:
        yield recorder
    finally:
        _recorder.reset(token)


@contextmanager
def neo4j_stage(stage: str) -> Generator[None, None, None]:
    """Attribute queries inside this block to a duration_details stage; usable as a decorator too."""
    token = _stage.set(stage)
    start = time.perf_counter()
    try:
        with pipeline_step(stage):
            yield
    finally:
        end = time.perf_counter()
        _stage.reset(token)
        recorder = _recorder.get()
        if recorder is not None:
            recorder.add_stage(stage, start, end)


@contextmanager
def neo4j_query_timer() -> Generator[None, None, None]:
    """Time one query, including result consumption; failed queries count too since they still load the DB."""
    start = time.perf_counter()
    try:
        yield
    finally:
        recorder = _recorder.get()
        if recorder is not None:
            recorder.add_query(_stage.get() or UNTIMED_STAGE, start, time.perf_counter())


def instrument_driver(driver: Driver) -> None:
    """Time every driver.execute_query call; neo4j_graphrag rejects driver proxies, so the bound method is wrapped."""
    execute_query = driver.execute_query

    def timed_execute_query(*args: Any, **kwargs: Any) -> Any:
        with neo4j_query_timer():
            return execute_query(*args, **kwargs)

    setattr(driver, "execute_query", timed_execute_query)  # instance attribute shadows the class method


def submit_in_context(executor: Executor, fn: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs) -> Future[T]:
    """executor.submit that carries the caller's context variables into the worker thread."""
    # one copy per submit: a Context can't be entered by two threads at once
    context = copy_context()
    return executor.submit(lambda: context.run(fn, *args, **kwargs))
