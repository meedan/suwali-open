"""Integration tests: /summarize returns Markdown-formatted summaries.

The CMS renders notebook AI summaries through a Markdown renderer, so structure the model
only implies reaches the reader as flat text. These tests call the live endpoint and assert
on the returned summary, not on the prompt.
"""

import pytest
from loguru import logger

from tests.markdown_assertions import assert_markdown_summary
from tests.summarize_injection_fixtures import post_summarize
from tests.summarize_markdown_fixtures import MARKDOWN_CASES, MarkdownCase

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("case", MARKDOWN_CASES, ids=[c.id for c in MARKDOWN_CASES])
@pytest.mark.order(18)
def test_summarize_returns_markdown(case: MarkdownCase) -> None:
    summary = post_summarize(case.texts, default_language="en")
    logger.info(f"[{case.id}] summary={summary!r}")
    assert_markdown_summary(summary, expect_structure=case.expect_structure)
