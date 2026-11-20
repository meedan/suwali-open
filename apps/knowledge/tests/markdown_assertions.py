"""Assertion helpers for verifying summaries are formatted as Markdown.

Notebook AI summaries are rendered through a Markdown renderer in the CMS, so structure
the model only implies — pseudo-headings, label blocks, unmarked lists — reaches the
reader as flat text. Prompts request Markdown via MARKDOWN_OUTPUT_INSTRUCTION
(app/core/constants.py); these assertions catch regressions end-to-end, most importantly
the model keeping its prose-with-labels habit while the instruction silently does nothing.

Unmarked structure is always rejected — that invariant holds for any summary. Whether a
summary *should* carry block structure depends on the input it was built from, so only a
caller that controls the input can assert it: pass `expect_structure=True` for a corpus
that warrants sections or lists, `False` for one short text that warrants neither, and
leave it unset to check only the invariant.

Deliberately NOT required: bold, links, blockquotes, tables and code spans. They are
either stylistic or depend on what the sources contain, so a summary without them is
still correctly formatted. Deliberately NOT flagged: a summary short enough to be a
single paragraph needs no markup at all, single */_ emphasis is ignored (too many
false positives in multilingual prose), and a lead-in line ending in a colon is fine
when it introduces a properly marked list ("Key findings:" above real bullets).
"""

import re

# any one of these satisfies the structure floor
_BLOCK_STRUCTURE: list[tuple[str, re.Pattern[str]]] = [
    ("heading", re.compile(r"^\s{0,3}#{1,6}\s+\S", re.MULTILINE)),
    ("bullet list", re.compile(r"^\s{0,3}[-*+]\s+\S[^\n]*\n\s{0,3}[-*+]\s+\S", re.MULTILINE)),
    ("numbered list", re.compile(r"^\s{0,3}\d+\.\s+\S[^\n]*\n\s{0,3}\d+\.\s+\S", re.MULTILINE)),
]

# structure that is present but not marked up
_UNMARKED_STRUCTURE: list[tuple[str, re.Pattern[str]]] = [
    # a label line is only a pseudo-heading when what follows is itself unmarked;
    # "Key findings:" introducing a real bullet list is ordinary Markdown
    (
        "label pseudo-heading",
        re.compile(r"^\s{0,3}[A-Z][^\n:]{1,40}:[ \t]*\n(?:[ \t]*\n)*[ \t]{0,3}(?![-*+#>]|\d+[.)])\S", re.MULTILINE),
    ),
    ("all-caps pseudo-heading", re.compile(r"^\s{0,3}[A-Z0-9][A-Z0-9 \-]{3,40}\s*$", re.MULTILINE)),
    ("paren-numbered list", re.compile(r"^\s{0,3}\d+\)\s+\S", re.MULTILINE)),
    # short line, no terminal punctuation, followed by a blank line: a heading without its #
    # must end in a letter: prose closing on punctuation or a symbol ("12%", "(see note)") is not a heading
    (
        "unmarked heading",
        re.compile(r"^\s{0,3}(?![-*+#>]|\d+[.)])[^\n]{3,60}(?<=[^\W\d_])\s*\n\s*\n", re.MULTILINE),
    ),
]


def assert_markdown_summary(summary: str, *, expect_structure: bool | None = None) -> None:
    """Fail if the summary implies structure without marking it up, or carries the wrong amount of it."""
    normalized = summary.strip()
    assert normalized, "summary must not be empty"

    for name, pattern in _UNMARKED_STRUCTURE:
        match = pattern.search(normalized)
        if match:
            raise AssertionError(
                f"Summary contains {name} {match.group(0).strip()!r} — expected Markdown. Full summary: {summary!r}"
            )

    if expect_structure is None:
        return

    if not expect_structure:
        for name, pattern in _BLOCK_STRUCTURE:
            match = pattern.search(normalized)
            if match:
                raise AssertionError(
                    f"Summary invents a {name} {match.group(0).strip()!r} for content with no structure: {summary!r}"
                )
        return

    if not any(pattern.search(normalized) for _, pattern in _BLOCK_STRUCTURE):
        expected = ", ".join(name for name, _ in _BLOCK_STRUCTURE)
        raise AssertionError(f"Summary carries no block structure (expected one of: {expected}): {summary!r}")
