"""Performance benchmark tests for the chat pipeline.
Results are written to apps/knowledge/benchmarks/ as JSON.
"""

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
import requests
from loguru import logger

pytestmark = [pytest.mark.integration, pytest.mark.benchmark]

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
HUB_ID = 1

BENCHMARKS_DIR = Path(__file__).parent.parent / "benchmarks"

BENCHMARK_QUERIES: list[dict[str, Any]] = [
    {
        "label": "simple_question",
        "description": "Simple factual question (no decomposition expected)",
        "payload": {
            "hub_id": HUB_ID,
            "message_id": 9001,
            "message": "Who is the executive director of Meedan?",
            "history": [],
        },
    },
    {
        "label": "simple_question_with_history",
        "description": "Follow-up question with conversation history",
        "payload": {
            "hub_id": HUB_ID,
            "message_id": 9002,
            "message": "What else did they do?",
            "history": [
                {"role": "user", "content": "Who is the executive director of Meedan?"},
                {"role": "assistant", "content": "Dima Saber is the executive director of Meedan."},
            ],
        },
    },
    {
        "label": "decomposed_multi_intent",
        "description": "Multi-intent query (decomposition expected)",
        "payload": {
            "hub_id": HUB_ID,
            "message_id": 9003,
            "message": "What is PRISM and who created it? Also, what organization are they from?",
            "history": [],
        },
    },
    {
        "label": "decomposed_temporal_comparison",
        "description": "Temporal comparison query (decomposition expected)",
        "payload": {
            "hub_id": HUB_ID,
            "message_id": 9004,
            "message": "What projects did Meedan work on, and what were their key achievements?",
            "history": [],
        },
    },
    {
        "label": "synthesis_digest",
        "description": "Synthesis/digest query",
        "payload": {
            "hub_id": HUB_ID,
            "message_id": 9005,
            "message": "Summarize this week's Roman Empire news",
            "history": [],
        },
    },
]

# recency-first A/B queries: each is sent twice — once with recency_first_enabled=true, once false.
_RECENCY_AB_QUERIES: list[dict[str, Any]] = [
    {
        "label": "recency_recent_content",
        "description": "Question targeting recent content (aqueduct collapse, 0-3 days old)",
        "base_payload": {
            "hub_id": HUB_ID,
            "message_id": 9006,
            "message": "What is the Augustan Aqueduct in Lugdunum?",
            "history": [],
        },
    },
    {
        "label": "recency_old_content",
        "description": "Question targeting old-only content (census results, 70+ days old)",
        "base_payload": {
            "hub_id": HUB_ID,
            "message_id": 9007,
            "message": "What were the results of the Roman Empire census?",
            "history": [],
        },
    },
]


def _get_git_info() -> dict[str, str | bool | None]:
    commit_hash = os.getenv("GIT_COMMIT_HASH")
    commit_message = os.getenv("GIT_COMMIT_MESSAGE")
    dirty = os.getenv("GIT_REPO_DIRTY") == "1"

    if commit_hash:
        return {"commit_hash": commit_hash, "commit_message": commit_message, "has_uncommitted_changes": dirty != 0}

    try:
        commit_hash = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
        commit_message = (
            subprocess.check_output(["git", "log", "-1", "--format=%s"], text=True, stderr=subprocess.DEVNULL)
            .strip()
            .splitlines()[0]
        )
        dirty = subprocess.call(["git", "diff", "--quiet", "HEAD"], stderr=subprocess.DEVNULL) != 0
        return {"commit_hash": commit_hash, "commit_message": commit_message, "has_uncommitted_changes": dirty}
    except Exception:
        return {"commit_hash": None, "commit_message": None, "has_uncommitted_changes": None}


def _extract_timing_metrics(data: dict[str, Any]) -> dict[str, Any]:
    metadata = data.get("metadata") or {}
    return {
        "total_duration_ms": metadata.get("total_duration_ms"),
        "duration_details": metadata.get("duration_details"),
        "router_intent": metadata.get("router_intent"),
        "question_type": metadata.get("question_type"),
        "temporal_type": metadata.get("temporal_type"),
        "router_decomposition_used": metadata.get("router_decomposition_used"),
        "router_subquery_count": metadata.get("router_subquery_count"),
        "documents_count": metadata.get("documents_count"),
        "synthesis_type": metadata.get("synthesis_type"),
        "synthesis_chunks_used": metadata.get("synthesis_chunks_used"),
        "hyde_used": metadata.get("hyde_used"),
        "rephrase_attempts": metadata.get("rephrase_attempts"),
        "error_type": data.get("error_type"),
        "recency_first_used": metadata.get("recency_first_used"),
        "recency_first_window_days": metadata.get("recency_first_window_days"),
        "recency_first_fallback_used": metadata.get("recency_first_fallback_used"),
    }


def _run_query(label: str, description: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Send a single benchmark query and return the result entry."""
    logger.info(f"Benchmark [{label}]: {description}")

    response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=120)
    assert response.status_code == 200, f"[{label}] Expected 200, got {response.status_code}: {response.text}"

    data = response.json()
    assert "answer" in data, f"[{label}] Response should contain 'answer' field"

    metrics = _extract_timing_metrics(data)
    total_ms = metrics["total_duration_ms"]
    intent = metrics["router_intent"]
    decomposed = metrics["router_decomposition_used"]
    subquery_count = metrics["router_subquery_count"]

    logger.info(
        f"Benchmark [{label}]: {total_ms:.0f}ms | intent={intent} decomposed={decomposed} subqueries={subquery_count}"
    )
    if metrics["duration_details"]:
        for key, val in sorted(metrics["duration_details"].items()):
            logger.info(f"  {key}: {val:.0f}ms")

    return {
        "label": label,
        "description": description,
        "message": payload["message"],
        "has_history": bool(payload.get("history")),
        "metrics": metrics,
    }


@pytest.mark.order(20)
def test_benchmark_chat_pipeline(prepare_test_data: None, prepare_roman_empire_data: None) -> None:
    """Run all benchmark queries and save timing results to JSON."""
    results = []

    for query in BENCHMARK_QUERIES:
        result = _run_query(query["label"], query["description"], query["payload"])
        results.append(result)

    for query in _RECENCY_AB_QUERIES:
        base = query["base_payload"]
        for enabled in (True, False):
            suffix = "recency_on" if enabled else "recency_off"
            label = f"{query['label']}_{suffix}"
            description = f"{query['description']} [recency_first={enabled}]"
            payload = {**base, "recency_first_enabled": enabled}
            result = _run_query(label, description, payload)
            results.append(result)

    BENCHMARKS_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now(timezone.utc)
    timestamp_str = now.strftime("%Y-%m-%d_%H-%M-%S_%f")[:-3]

    git_info = _get_git_info()

    output = {
        "timestamp": now.isoformat(),
        **git_info,
        "queries": results,
    }

    output_path = BENCHMARKS_DIR / f"results_{timestamp_str}.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    logger.info(f"Benchmark results written to {output_path}")

    for r in results:
        total = r["metrics"]["total_duration_ms"]
        assert total is not None, f"[{r['label']}] total_duration_ms should be present"
        logger.info(f"  {r['label']}: {total:.0f}ms")
