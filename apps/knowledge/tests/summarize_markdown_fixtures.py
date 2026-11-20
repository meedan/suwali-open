"""Fixtures for /summarize Markdown formatting integration tests.

Inputs are chosen so the expected shape is safe rather than hopeful: a multi-topic corpus
should come back with block structure, a single short note should not have structure invented
for it. Both must mark up whatever structure they do carry.
"""

from dataclasses import dataclass

RENEWABLE_ENERGY_ITEM = (
    "The regional council approved funding for new solar panels and wind turbines, "
    "expanding renewable energy capacity across coastal communities this quarter."
)

WATER_ACCESS_ITEM = (
    "Farmers in three villages reported longer dry seasons and broken hand pumps, "
    "leaving households walking further each morning for drinking water."
)

SCHOOL_LUNCH_ITEM = (
    "The school lunch program expanded to two new districts, reaching an additional "
    "4,000 pupils. Head teachers reported higher attendance through the first term."
)

HEALTH_CLINIC_ITEM = (
    "A mobile clinic began monthly visits to the northern settlements, offering "
    "vaccinations and antenatal checks that previously required a full day of travel."
)

SINGLE_SHORT_ITEM = (
    "The council corrected the flood figure it published in March after the original dataset was superseded."
)


@dataclass(frozen=True)
class MarkdownCase:
    id: str
    texts: list[str]
    expect_structure: bool


MARKDOWN_CASES: list[MarkdownCase] = [
    # the notebook roll-up shape: several item summaries on unrelated topics
    MarkdownCase(
        id="multi_topic",
        texts=[RENEWABLE_ENERGY_ITEM, WATER_ACCESS_ITEM, SCHOOL_LUNCH_ITEM, HEALTH_CLINIC_ITEM],
        expect_structure=True,
    ),
    # one short note has no structure to mark up, and none should be invented
    MarkdownCase(
        id="single_short",
        texts=[SINGLE_SHORT_ITEM],
        expect_structure=False,
    ),
]
