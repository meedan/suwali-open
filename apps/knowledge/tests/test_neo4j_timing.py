"""Tests for per-stage Neo4j query timing."""

import contextvars
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from app.services.neo4j_timing import (
    UNTIMED_STAGE,
    Neo4jTimingRecorder,
    instrument_driver,
    neo4j_query_timer,
    neo4j_stage,
    neo4j_timing,
)


class FakeDriver:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    def execute_query(self, *args: Any, **kwargs: Any) -> str:
        self.calls.append((args, kwargs))
        if self.error is not None:
            raise self.error
        return "records"


def test_summary_counts_parallel_queries_once_in_wall_ms() -> None:
    recorder = Neo4jTimingRecorder()
    recorder.add_stage("rephrasing", 0.0, 1.0)
    # two overlapping queries (0.10-0.14, 0.11-0.15) and a later one (0.50-0.52)
    recorder.add_query("rephrasing", 0.11, 0.15)
    recorder.add_query("rephrasing", 0.10, 0.14)
    recorder.add_query("rephrasing", 0.50, 0.52)

    timing = recorder.summary()["rephrasing"]

    assert timing.queries == [40.0, 40.0, 20.0]
    assert timing.total_ms == 100.0
    assert timing.wall_ms == 70.0
    assert timing.stage_ms == 1000.0


def test_summary_stage_ms_is_union_of_parallel_runs_of_the_same_stage() -> None:
    recorder = Neo4jTimingRecorder()
    # two sub-queries running initial_search at the same time
    recorder.add_stage("initial_search", 0.0, 1.0)
    recorder.add_stage("initial_search", 0.5, 1.5)
    recorder.add_query("initial_search", 0.1, 0.2)

    assert recorder.summary()["initial_search"].stage_ms == 1500.0


def test_summary_omits_stages_without_queries_and_untimed_has_no_stage_ms() -> None:
    recorder = Neo4jTimingRecorder()
    recorder.add_stage("synthesis", 0.0, 1.0)
    recorder.add_query(UNTIMED_STAGE, 0.0, 0.01)

    summary = recorder.summary()

    assert set(summary) == {UNTIMED_STAGE}
    assert summary[UNTIMED_STAGE].stage_ms is None
    assert summary[UNTIMED_STAGE].total_ms == 10.0


def test_query_counts_toward_innermost_stage_only() -> None:
    with neo4j_timing() as recorder:
        with neo4j_stage("rephrasing"):
            with neo4j_stage("initial_search"), neo4j_query_timer():
                pass
            with neo4j_query_timer():
                pass
        with neo4j_query_timer():
            pass

    summary = recorder.summary()

    assert len(summary["initial_search"].queries) == 1
    assert len(summary["rephrasing"].queries) == 1
    assert len(summary[UNTIMED_STAGE].queries) == 1


def test_stage_used_as_decorator_records_each_call() -> None:
    @neo4j_stage("hyde")
    def run_hyde() -> str:
        with neo4j_query_timer():
            return "answer"

    with neo4j_timing() as recorder:
        assert run_hyde() == "answer"
        assert run_hyde() == "answer"

    assert len(recorder.summary()["hyde"].queries) == 2


def test_timers_are_noops_without_a_recorder() -> None:
    with neo4j_stage("initial_search"), neo4j_query_timer():
        pass

    with neo4j_timing() as recorder:
        pass

    assert recorder.summary() == {}


def test_copied_context_keeps_stage_in_worker_threads() -> None:
    def query() -> None:
        with neo4j_query_timer():
            pass

    with neo4j_timing() as recorder, neo4j_stage("rephrasing"):
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(contextvars.copy_context().run, query) for _ in range(2)]
            for future in futures:
                future.result()

    assert len(recorder.summary()["rephrasing"].queries) == 2


def test_instrumented_driver_times_execute_query() -> None:
    driver = FakeDriver()
    instrument_driver(driver)  # type: ignore[arg-type]

    with neo4j_timing() as recorder, neo4j_stage("initial_search"):
        result = driver.execute_query("RETURN 1", database_="neo4j")

    assert result == "records"
    assert driver.calls == [(("RETURN 1",), {"database_": "neo4j"})]
    assert len(recorder.summary()["initial_search"].queries) == 1


def test_instrumented_driver_records_failed_queries() -> None:
    driver = FakeDriver(error=RuntimeError("boom"))
    instrument_driver(driver)  # type: ignore[arg-type]

    with neo4j_timing() as recorder, neo4j_stage("hyde"):
        with pytest.raises(RuntimeError, match="boom"):
            driver.execute_query("RETURN 1")

    assert len(recorder.summary()["hyde"].queries) == 1
