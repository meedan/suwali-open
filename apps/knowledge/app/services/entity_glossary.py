import sys
from typing import Any

from langchain_core.output_parsers import JsonOutputParser, PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field, ValidationError

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import invoke_with_output_retry
from app.core.output_parsing import strict_format_instructions

# Below this, a glossary pass adds nothing over per-chunk extraction.
_MIN_TEXT_CHARS = 200

_INSTRUCTIONS = """
You are preparing a canonical entity glossary for a document that will afterwards be
processed chunk by chunk for knowledge-graph extraction. Because the chunk extractor
only sees one chunk at a time, it tends to name and label the same real-world entity
inconsistently across chunks. Your glossary prevents that: it fixes ONE canonical name
and ONE label per entity, valid for the whole document.

## Task

Read the whole document and list the distinct real-world entities that matter for
knowledge-graph extraction: people, organizations, locations (countries AND cities),
events, medications, procedures, symptoms, key concepts, and similar.

For each entity provide:
- "name": the canonical form (see naming rules below).
- "label": exactly ONE type label, the most specific that fits.
- "aliases": other surface forms used in the document for the same entity (may be empty).

## Label guidance
{schema_guidance}
Use these types when they fit; otherwise choose a clear, specific label.
If multiple labels fit, prefer the most specific (e.g. "Medication" over "Concept").

## Naming rules (MUST match chunk-extraction conventions)

- Prefer the most complete name form used in the document for each entity.
- Country names that use a definite article: omit the article
  ("the Philippines" → "Philippines", "the United States" → "United States").
- Otherwise copy names CHARACTER-FOR-CHARACTER from the document (after the rules above).
  Do not invent, translate, or "fix" spellings. Strip Markdown formatting characters.

## Coverage rules

- ALWAYS include every named country that appears, even once. If a city is mentioned,
  also include its country as a separate Location entry (e.g. Manila → also Philippines;
  Quito → also Ecuador). Do not replace a country with one of its cities or vice versa.
- ALWAYS include named organizations, people, and institutions that appear even once —
  a single mention of "Meta", "University of Basel", or a person named in a byline still
  belongs in the glossary. "One-off trivia" means generic words and anonymous references,
  not named entities.
- One entry per real-world entity. Never create two entries for the same entity with
  different labels: pick the single best label.
- Skip pronouns, generic words ("tech giants", "the company"), dates, numbers, and URLs.
- Return at most {max_entities} entries, most central entities first — but never drop a
  named country, named organization, or named person to make room for a Concept.

## Document
{text}

## Output Format
{output_format}
"""


class GlossaryEntry(BaseModel):
    name: str = Field(description="Canonical entity name as it appears in the document")
    label: str = Field(description="Single most specific type label")
    aliases: list[str] = Field(default_factory=list, description="Other surface forms in the document")


class GlossaryOutput(BaseModel):
    entities: list[GlossaryEntry] = Field(description="Canonical entity glossary, most central first")


class EntityGlossaryExtractor:
    """Document-level canonical entity pass, run once before per-chunk extraction.

    The resulting glossary is injected into the chunk-extraction prompt so every chunk
    reuses the same name and label per entity. Consistent naming lets the default
    exact-match entity resolution merge mentions across chunks (and documents), which is
    what makes chunk-local relationships visible from other chunks at retrieval time.
    """

    def __init__(self, config: Config | None = None, llm_config: LLMConfig | None = None):
        self.config = config or Config()
        self.llm_config = llm_config or LLMConfig()

    def extract(self, text: str, schema_guidance: str) -> list[GlossaryEntry]:
        text_sample = (text or "")[: self.config.entity_glossary_max_input_chars]
        if len(text_sample.strip()) < _MIN_TEXT_CHARS:
            logger.info("Text too short for an entity glossary pass, skipping")
            return []

        try:
            raw_entries = self._extract_with_llm(text_sample, schema_guidance)
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Entity glossary extraction failed, continuing without: {e}")
            return []

        entries = self._normalize(raw_entries)
        logger.info(f"Entity glossary: {len(entries)} canonical entities")
        return entries

    @LLMCircuitBreaker()
    def _extract_with_llm(self, text_sample: str, schema_guidance: str) -> list[GlossaryEntry]:
        prompt = PromptTemplate.from_template(_INSTRUCTIONS)
        format_parser: PydanticOutputParser[GlossaryOutput] = PydanticOutputParser(pydantic_object=GlossaryOutput)
        model = create_chat_model(
            self.llm_config.llm_ingestor_glossary,
            self.llm_config,
            timeout_seconds=self.llm_config.llm_ingestion_timeout_seconds,
        )
        # JsonOutputParser repairs truncated JSON and entries are validated one by one:
        # a looping model can hit its token limit mid-entry, and one bad tail entry must not void the rest
        data = invoke_with_output_retry(
            {
                "text": text_sample,
                "schema_guidance": schema_guidance,
                "max_entities": self.config.entity_glossary_max_entities,
                "output_format": strict_format_instructions(format_parser),
            },
            prompt=prompt,
            model=model,
            parser=JsonOutputParser(),
            reject_truncated=False,
            component="Entity glossary",
        )
        return self._validate_entries(data)

    @staticmethod
    def _validate_entries(data: Any) -> list[GlossaryEntry]:
        """per-entry validation: drop malformed entries instead of failing the whole glossary."""
        items = data.get("entities") if isinstance(data, dict) else None
        if not isinstance(items, list):
            logger.warning(f"Entity glossary: unexpected LLM output shape ({type(data).__name__}), skipping")
            return []

        entries: list[GlossaryEntry] = []
        dropped = 0
        for item in items:
            try:
                entries.append(GlossaryEntry.model_validate(item))
            except ValidationError:
                dropped += 1
        if dropped:
            logger.warning(f"Entity glossary: dropped {dropped} malformed entries (likely truncated LLM output)")
        return entries

    def _normalize(self, entries: list[GlossaryEntry]) -> list[GlossaryEntry]:
        """Trim fields, drop nameless entries, de-dupe by name."""
        seen: set[str] = set()
        normalized: list[GlossaryEntry] = []
        for entry in entries:
            name = entry.name.strip()
            label = entry.label.strip() or "Concept"
            if not name:
                continue

            aliases = [a.strip() for a in entry.aliases if a.strip()]
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            aliases = [a for a in aliases if a.lower() != key]
            # de-dupe aliases case-insensitively while preserving order
            alias_seen: set[str] = set()
            unique_aliases: list[str] = []
            for alias in aliases:
                alias_key = alias.lower()
                if alias_key not in alias_seen:
                    alias_seen.add(alias_key)
                    unique_aliases.append(alias)

            normalized.append(GlossaryEntry(name=name, label=label, aliases=unique_aliases))
        return normalized[: self.config.entity_glossary_max_entities]
