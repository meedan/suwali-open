"""Request-scoped context propagated via contextvars.

Use this to make request-level data (e.g. hub_id) available deep in the call stack -
such as inside cached, hub-agnostic components (see LLMWithFallback) - without
threading it through every function signature.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Generator, Optional, Union

current_hub_id: ContextVar[Optional[Union[str, int]]] = ContextVar("current_hub_id", default=None)


@contextmanager
def hub_id_context(hub_id: Optional[Union[str, int]]) -> Generator[None, None, None]:
    token = current_hub_id.set(hub_id)
    try:
        yield
    finally:
        current_hub_id.reset(token)


_pipeline_steps: ContextVar[tuple[str, ...]] = ContextVar("pipeline_steps", default=())


@contextmanager
def pipeline_step(name: str) -> Generator[None, None, None]:
    """Name the duration_details step running inside this block; debug log lines are labeled with it."""
    steps = _pipeline_steps.get()
    # neo4j_stage nested in a pipeline_step of the same name would otherwise repeat it in the path
    if steps and steps[-1] == name:
        yield
        return
    token = _pipeline_steps.set((*steps, name))
    try:
        yield
    finally:
        _pipeline_steps.reset(token)


def current_step_path() -> str | None:
    """Active steps from outermost to innermost, e.g. "sub_query_0/internal_kb/hyde"."""
    return "/".join(_pipeline_steps.get()) or None


llm_fallback_used: ContextVar[bool] = ContextVar("llm_fallback_used", default=False)


@contextmanager
def llm_fallback_scope() -> Generator[None, None, None]:
    """Scope one LLM call so the caller can tell whether it was answered by the fallback model.

    Read llm_fallback_used inside the scope; LLMWithFallback flips it on the same thread.
    """
    token = llm_fallback_used.set(False)
    try:
        yield
    finally:
        llm_fallback_used.reset(token)
