"""Assertion helpers for verifying LLM answers are plain text (no markdown).

Answers are delivered over channels that render raw text (e.g. WhatsApp), so any
markdown in an answer reaches the user verbatim. Prompts forbid markdown via
PLAIN_TEXT_ONLY_INSTRUCTION (app/core/constants.py); these assertions catch
regressions end-to-end, most importantly URLs rendered as [title](url) links.

Deliberately NOT flagged: "- " list bullets (the error/scenario fallbacks append
resources as "- {title}" lines) and single */_ emphasis (too many false positives
in multilingual prose).
"""

import re

_MARKDOWN_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("markdown link", re.compile(r"\[[^\]\n]+\]\([^)\n]+\)")),
    ("bold marker", re.compile(r"\*\*[^*\n]+\*\*|__[^_\n]+__")),
    ("heading", re.compile(r"^\s{0,3}#{1,6}\s", re.MULTILINE)),
    ("code span/fence", re.compile(r"`[^`\n]*`")),
]


def assert_plain_text_answer(answer: str) -> None:
    """Fail if the answer contains markdown formatting (links, bold, headings, code)."""
    for name, pattern in _MARKDOWN_PATTERNS:
        match = pattern.search(answer)
        if match:
            raise AssertionError(
                f"Answer contains {name} {match.group(0)!r} — expected plain text. Full answer: {answer!r}"
            )
