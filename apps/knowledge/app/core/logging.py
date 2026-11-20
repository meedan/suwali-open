from __future__ import annotations

import logging
import re
import sys
import time
from typing import TYPE_CHECKING, Any, Iterable, Literal, cast
from uuid import UUID

import boto3
import sentry_sdk
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult
from loguru import logger
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.core.config import Config
from app.core.debug_log import TRUNCATE

if TYPE_CHECKING:
    # stub-only types; loguru doesn't define them at runtime
    from loguru import Message, Record


class HealthCheckFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # uvicorn.access args: (client_addr, method, full_path, http_version, status_code)
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3:
            return not (args[1] == "GET" and cast(str, args[2]).startswith("/health"))
        return True


class OpenAIRetryCauseFilter(logging.Filter):
    """Let through only the openai client's own lines plus the debug line naming why a request is retried.

    The client logs "Retrying request to ..." at info but the exception behind it ("Encountered
    httpx.TimeoutException" with its traceback) at debug, next to debug dumps of every request body.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno >= logging.INFO or str(record.msg).startswith("Encountered")


def log_openai_retry_causes() -> None:
    openai_client = logging.getLogger("openai._base_client")
    openai_client.setLevel(logging.DEBUG)
    openai_client.addFilter(OpenAIRetryCauseFilter())


def setup_logging() -> None:
    from asgi_correlation_id.context import correlation_id

    def correlation_id_filter(record: Record) -> bool:
        # Prefer a value already bound via logger.contextualize() (e.g. from RQ worker);
        # fall back to the ASGI request-scoped ContextVar for regular HTTP paths.
        if not record["extra"].get("correlation_id"):
            record["extra"]["correlation_id"] = correlation_id.get()
        span = sentry_sdk.get_current_span()
        if span is not None:
            record["extra"]["sentry_trace_id"] = span.trace_id
            record["extra"]["sentry_span_id"] = span.span_id
        else:
            record["extra"]["sentry_trace_id"] = None
            record["extra"]["sentry_span_id"] = None
        return True

    def sentry_logger(message: Message) -> None:
        record = message.record
        with sentry_sdk.new_scope() as scope:
            scope.set_extra("log_message", record["message"])
            exception = record.get("exception")
            if exception:
                scope.capture_exception(exception.value)

    config = Config()

    logger.remove()
    if config.deploy_env != "local":
        logger.add(sys.stdout, serialize=True, level=logging.INFO, filter=correlation_id_filter)
        logger.add(sys.stderr, serialize=True, level=logging.ERROR, filter=correlation_id_filter)
    else:
        fmt = "{level}: \t  {time:YYYY-MM-DD HH:mm:ss} {name}:{line} [{extra[correlation_id]}] - {message}"
        logger.add(sys.stdout, format=fmt, level=logging.DEBUG, filter=correlation_id_filter)
        logger.add(sys.stderr, format=fmt, level=logging.ERROR, filter=correlation_id_filter)

    logger.add(sentry_logger, level=logging.WARNING)

    log_level = logging.INFO
    logging.basicConfig(level=log_level)
    uvicorn_access = logging.getLogger("uvicorn.access")
    uvicorn_access.setLevel(log_level)
    uvicorn_access.addFilter(HealthCheckFilter())
    log_openai_retry_causes()


def setup_sentry(env: str) -> None:
    config = Config()
    sentry_dsn = config.sentry_dsn
    if sentry_dsn and env != "local":
        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=env,
            send_default_pii=True,
            traces_sample_rate=0.2,
            profile_session_sample_rate=0.2,
            profile_lifecycle="trace",
            integrations=[
                StarletteIntegration(transaction_style="endpoint"),
                FastApiIntegration(transaction_style="endpoint"),
            ],
        )

        logger.info("Sentry initialized.")
    else:
        logger.info(f"Sentry is not enabled for {env} environment.")


def format_llm_messages(messages: Iterable[Any]) -> str:
    """Render LangChain messages or OpenAI-style {role, content} dicts as `[role] content` lines."""
    lines = []
    for message in messages:
        if isinstance(message, dict):
            role = message.get("role", "?")
            content = message.get("content", "")
        else:
            role = message.type
            content = message.content
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


def log_llm_call(model_name: str, prompt: str, response: str, *, duration_seconds: float | None = None) -> None:
    """Log the full prompt/response of an LLM call via the console logger, shipped to CloudWatch."""
    duration = f"{duration_seconds:.2f}s" if duration_seconds is not None else "n/a"
    logger.bind(**{TRUNCATE: True}).info(
        "LLM call model={} duration={}\n--- prompt ---\n{}\n--- response ---\n{}",
        model_name,
        duration,
        prompt,
        response,
    )


class LLMLoggingHandler(BaseCallbackHandler):
    """LangChain callback that logs the full prompt/response of every chat model call.

    Attach to a chat model (e.g. via the `callbacks` constructor kwarg) rather than passing
    via chain config, so logging fires regardless of where the model is used within a chain.
    """

    def __init__(self) -> None:
        config = Config()
        self.enabled = config.enable_llm_logging
        self._pending: dict[UUID, tuple[str, str, float]] = {}

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[BaseMessage]],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        if not self.enabled:
            return

        model_kwargs = serialized.get("kwargs") or {}
        model_name = (
            model_kwargs.get("model_name") or model_kwargs.get("model") or model_kwargs.get("model_id") or "unknown"
        )
        prompt = "\n---\n".join(format_llm_messages(batch) for batch in messages)
        self._pending[run_id] = (model_name, prompt, time.perf_counter())

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> None:
        if not self.enabled:
            return

        model_name, prompt, start_time = self._pending.pop(run_id, ("unknown", "", time.perf_counter()))
        text = "\n---\n".join(generation.text for batch in response.generations for generation in batch)
        log_llm_call(model_name, prompt, text, duration_seconds=time.perf_counter() - start_time)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        if not self.enabled:
            return

        model_name, prompt, start_time = self._pending.pop(run_id, ("unknown", "", time.perf_counter()))
        logger.bind(**{TRUNCATE: True}).warning(
            "LLM call failed model={} duration={:.2f}s error={}\n--- prompt ---\n{}",
            model_name,
            time.perf_counter() - start_time,
            error,
            prompt,
        )


CloudWatchUnit = Literal[
    "Seconds",
    "Microseconds",
    "Milliseconds",
    "Bytes",
    "Kilobytes",
    "Megabytes",
    "Gigabytes",
    "Terabytes",
    "Bits",
    "Kilobits",
    "Megabits",
    "Gigabits",
    "Terabits",
    "Percent",
    "Count",
    "Bytes/Second",
    "Kilobytes/Second",
    "Megabytes/Second",
    "Gigabytes/Second",
    "Terabytes/Second",
    "Bits/Second",
    "Kilobits/Second",
    "Megabits/Second",
    "Gigabits/Second",
    "Terabits/Second",
    "Count/Second",
    "None",
]


def publish_metric(
    metric_name: str,
    value: float,
    unit: CloudWatchUnit = "Count",
    namespace: str = "Suwali/Knowledge",
    hub_id: str | int | None = None,
    question_type: str | None = None,
) -> None:
    config = Config()
    if config.deploy_env == "local":
        return

    try:
        cloudwatch = boto3.client("cloudwatch", region_name=config.aws_region)
        dimensions = [{"Name": "Environment", "Value": config.deploy_env}]

        if hub_id:
            dimensions.append({"Name": "HubId", "Value": str(hub_id)})

        if question_type:
            dimensions.append({"Name": "QuestionType", "Value": question_type})

        cloudwatch.put_metric_data(
            Namespace=namespace,
            MetricData=[
                {
                    "MetricName": metric_name,
                    "Value": value,
                    "Unit": unit,
                    "Timestamp": time.time(),
                    "StorageResolution": 60,
                    "Dimensions": dimensions,
                },
            ],
        )
        logger.debug(f"Published metric {namespace}/{metric_name}={value}")
    except Exception as e:
        logger.opt(exception=sys.exc_info()).error(f"Failed to publish metric {metric_name} to CloudWatch: {e}")


_SUB_QUERY_RE = re.compile(r"^sub_query_\d+$")
_SUB_QUERY_INTERNAL_KB_RE = re.compile(r"^sub_query_\d+_internal_kb$")

# Keys that are always top-level, standalone LLM phases - never nested inside
# internal_kb's or decomposition_total's wall-clock span.
_STANDALONE_LLM_KEYS = ("rewriting", "unified_classification_decomposition", "language_detection")

# internal_kb's wall-clock (Retriever.run(), via KnowledgeHandler.retrieve) fully
# contains these - they land in the same dict via a direct .update() of
# Retriever.run()'s own duration_details, so counting internal_kb already counts
# their time. Summing them separately would double-count.
_INTERNAL_KB_NESTED_NEO4J_KEYS = ("initial_search", "search_total", "relevance_filtering")
_INTERNAL_KB_NESTED_LLM_KEYS = ("rephrasing", "hyde", "answer_judging")


def _sum_duration_totals(duration_details: dict[str, float]) -> tuple[float, float]:
    """Estimate LLM vs. Neo4j time from a chat request's duration_details.

    Several timers wrap a Neo4j call fused with an LLM call in one wall-clock
    span (e.g. GraphRAG.search() does both at once), and some timers nest
    inside others in this same dict (internal_kb wraps Retriever.run()'s own
    breakdown; decomposition_total wraps each sub_query_N). Where nesting is
    known, only the outermost timer is counted to avoid double-counting the
    same wall-clock time; otherwise keys are bucketed by what they're about.
    """
    llm_total = 0.0
    neo4j_total = 0.0

    for key in _STANDALONE_LLM_KEYS:
        if key in duration_details:
            llm_total += duration_details[key]

    if "internal_kb" in duration_details:
        neo4j_total += duration_details["internal_kb"]
    else:
        # defensive fallback: nested keys leaked in without their wrapper
        for key in _INTERNAL_KB_NESTED_NEO4J_KEYS:
            if key in duration_details:
                neo4j_total += duration_details[key]
        for key in _INTERNAL_KB_NESTED_LLM_KEYS:
            if key in duration_details:
                llm_total += duration_details[key]

    if "decomposition_total" in duration_details:
        # decomposition_total's wall-clock fully contains every sub_query_N, so
        # only the parent is counted on the LLM side. sub_query_N_internal_kb is
        # kept as the one distinct, non-redundant Neo4j signal within it.
        llm_total += duration_details["decomposition_total"]
        for key, value in duration_details.items():
            if _SUB_QUERY_INTERNAL_KB_RE.match(key):
                neo4j_total += value
    else:
        for key, value in duration_details.items():
            if _SUB_QUERY_RE.match(key):
                llm_total += value
            elif _SUB_QUERY_INTERNAL_KB_RE.match(key):
                neo4j_total += value

    if "synthesis" in duration_details:
        llm_total += duration_details["synthesis"]

    return llm_total, neo4j_total


def publish_chat_duration_details_metrics(
    duration_details: dict[str, float] | None, hub_id: str | int | None, question_type: str | None = None
) -> None:
    if not duration_details:
        return

    llm_total, neo4j_total = _sum_duration_totals(duration_details)

    publish_metric("answer.duration.llm", llm_total, unit="Milliseconds", hub_id=hub_id)
    if question_type:
        publish_metric("answer.duration.llm", llm_total, unit="Milliseconds", question_type=question_type)
    publish_metric("answer.duration.neo4j", neo4j_total, unit="Milliseconds", hub_id=hub_id)
    if question_type:
        publish_metric("answer.duration.neo4j", neo4j_total, unit="Milliseconds", question_type=question_type)
