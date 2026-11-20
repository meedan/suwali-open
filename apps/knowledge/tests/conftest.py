"""Shared fixtures for integration and benchmark tests."""

import logging
import re
from collections.abc import Generator
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from dotenv import load_dotenv
from loguru import logger
from pytest import Config

from tests.integration_fixtures import (  # noqa: F401
    neo4j_driver,
    prepare_badminton_pt_data,
    prepare_contribution_correction_data,
    prepare_ferry_ridership_data,
    prepare_forged_tag_data,
    prepare_harbor_shuttle_data,
    prepare_html_laden_data,
    prepare_kg_rels_deletion_data,
    prepare_no_suwali_hub_data,
    prepare_prioritized_conflict_data,
    prepare_rag_injection_data,
    prepare_roman_empire_data,
    prepare_scoped_synthesis_data,
    prepare_summarizer_injection_data,
    prepare_test_data,
    teardown_test_data,
)


@pytest.fixture(autouse=True)
def mock_publish_metric() -> Generator[MagicMock, None, None]:
    with patch("app.core.logging.publish_metric") as mock:
        yield mock


@pytest.fixture(autouse=True)
def bypass_directive_gate(request: pytest.FixtureRequest) -> Generator[None, None, None]:
    """Replace the directive gate with a passthrough outside integration tests.

    The gate runs on every generation path; unmocked it would attempt a real LLM call from
    any unit test that reaches a gated path. tests/test_directive_gate.py still exercises
    the real function: it binds it by direct import, which this module-attribute patch
    does not touch.
    """
    if request.node.get_closest_marker("integration"):
        yield
        return

    async def _passthrough(
        answer: str,
        profile_texts: list[str],
        *,
        what: str,
        llm_config: object = None,
        marked: object = None,
    ) -> str:
        return answer

    with patch("app.services.directive_gate.enforce_profile_directives", _passthrough):
        yield


_LOG_DIR = Path(__file__).resolve().parent.parent / "test-logs"


def pytest_configure(config: Config) -> None:
    markexpr = (config.getoption("-m", default="") or "").strip()
    running_unit_only = bool(re.search(r"\bnot\s+integration\b", markexpr, re.IGNORECASE))

    # Unset vars only (e.g. AWS_BEARER_TOKEN_BEDROCK from bind-mounted .env). Do not
    # override compose-injected .env.integration — knowledge/rq_worker get both files.
    # Also runs when -m is omitted (targeted file) so in-process Retriever.search works.
    if not running_unit_only:
        load_dotenv()

    # Save test runner logs when running integration tests
    if running_unit_only:
        return
    if not re.search(r"\bintegration\b", markexpr, re.IGNORECASE):
        return
    _LOG_DIR.mkdir(exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    log_path = _LOG_DIR / f"test_runner_{ts}.log"
    logger.add(
        log_path,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {name}:{line} - {message}",
        level=logging.DEBUG,
    )
