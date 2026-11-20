"""Entity extraction for YAGO knowledge graph queries."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod

from loguru import logger
from pydantic import BaseModel, Field

from app.services.router.models import QueryContext


class ExtractedEntity(BaseModel):
    text: str
    normalized_id: str  # YAGO-style ID, e.g. "Albert_Einstein"
    entity_type: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class EntityExtractor(ABC):
    @abstractmethod
    def extract(self, query: str, context: QueryContext | None = None) -> list[ExtractedEntity]:
        """Extract entities from query, ordered by confidence (highest first)."""
        pass

    @staticmethod
    def normalize_to_yago_id(text: str) -> str:
        """Normalize text to YAGO ID format: "Albert Einstein" -> "Albert_Einstein"."""
        text = re.sub(r"'s$", "", text)
        text = re.sub(r"'$", "", text)

        normalized = text.strip().replace(" ", "_")
        normalized = re.sub(r"[^\w_]", "", normalized)  # leave only alpha-num and underscores

        return normalized


class HeuristicEntityExtractor(EntityExtractor):
    """Default extractor using capitalization patterns. Fast, no dependencies."""

    QUESTION_PREFIXES = [
        "who is",
        "who was",
        "who are",
        "what is",
        "what was",
        "what are",
        "where is",
        "where was",
        "where are",
        "when was",
        "when is",
        "when did",
        "how old is",
        "how old was",
        "tell me about",
        "what do you know about",
        "can you tell me about",
        "i want to know about",
        "what is the capital of",
        "what is the population of",
        "where is the capital of",
        "did",
        "does",
        "do",
        "is",
        "was",
        "were",
        "has",
        "have",
        "had",
        "can",
        "could",
        "would",
        "should",
    ]

    def extract(self, query: str, context: QueryContext | None = None) -> list[ExtractedEntity]:
        logger.debug(f"Extracting entities from query '{query}'")

        processed = query
        query_lower = query.lower()

        for prefix in self.QUESTION_PREFIXES:
            if query_lower.startswith(prefix):
                processed = query[len(prefix) :].strip()
                break

        processed = re.sub(r"[?.!]+$", "", processed).strip()

        pattern = r"\b([A-Z][a-z]*(?:\s+[A-Z][a-z]*)*)\b"
        matches = re.findall(pattern, processed)

        if not matches and processed:
            words = processed.split()
            if words:
                matches = [" ".join(words[:3]).title()]

        entities: list[ExtractedEntity] = []
        seen_normalized: set[str] = set()

        for i, match in enumerate(matches):
            normalized = self.normalize_to_yago_id(match)

            if normalized in seen_normalized or len(normalized) < 2:
                continue

            seen_normalized.add(normalized)
            confidence = max(0.3, 0.9 - (i * 0.15))

            entities.append(
                ExtractedEntity(
                    text=match,
                    normalized_id=normalized,
                    entity_type=None,  # heuristic extractor can't determine type
                    confidence=confidence,
                )
            )

        logger.debug(f"Extracted {len(entities)} entities: {entities}")

        return entities


class NLTKEntityExtractor(EntityExtractor):
    """Uses NLTK NER. More accurate but requires NLTK models."""

    NLTK_TYPE_MAP = {
        "PERSON": "PERSON",
        "ORGANIZATION": "ORG",
        "GPE": "GPE",  # geo-political entity (countries, cities, states)
        "LOCATION": "LOCATION",
        "FACILITY": "FACILITY",
        "GSP": "GPE",  # alternative tag for geo-political
    }

    def __init__(self) -> None:
        self._nltk_imported = False

    def _ensure_nltk(self) -> None:
        if not self._nltk_imported:
            logger.info("Importing NLTK for entity extraction...")

            import nltk

            self._word_tokenize = nltk.word_tokenize
            self._pos_tag = nltk.pos_tag
            self._ne_chunk = nltk.ne_chunk
            self._Tree = nltk.Tree
            self._nltk_imported = True
            logger.info("... NLTK imported")

    def extract(self, query: str, context: QueryContext | None = None) -> list[ExtractedEntity]:
        # nltk's tokenizer/tagger/chunker are english-only
        # otherwise, they extract nothing useful and can emit bogus entities, so skip non-english.
        # Language comes from the caller (preflight / detect_text); this method stays sync.
        lang = context.detected_language if context else None
        if lang != "en":
            logger.debug(f"Skipping NLTK entity extraction for non-english query (lang={lang})")
            return []

        logger.debug(f"Extracting entities from query '{query}'")

        self._ensure_nltk()

        tokens = self._word_tokenize(query)
        tagged = self._pos_tag(tokens)
        tree = self._ne_chunk(tagged)

        entities: list[ExtractedEntity] = []
        seen_normalized: set[str] = set()

        for subtree in tree:
            if isinstance(subtree, self._Tree):
                entity_type = subtree.label()
                entity_text = " ".join(word for word, tag in subtree.leaves())
                normalized = self.normalize_to_yago_id(entity_text)

                if normalized in seen_normalized or len(normalized) < 2:
                    continue

                seen_normalized.add(normalized)

                mapped_type = self.NLTK_TYPE_MAP.get(entity_type, entity_type)
                confidence = 0.85 if mapped_type in ("PERSON", "GPE", "ORG") else 0.7

                entities.append(
                    ExtractedEntity(
                        text=entity_text,
                        normalized_id=normalized,
                        entity_type=mapped_type,
                        confidence=confidence,
                    )
                )

        if not entities:
            # found nothing, try with proper nouns from part-of-speech tags
            current_entity: list[str] = []

            for word, tag in tagged:
                if tag in ("NNP", "NNPS"):
                    current_entity.append(word)
                else:
                    if current_entity:
                        entity_text = " ".join(current_entity)
                        normalized = self.normalize_to_yago_id(entity_text)

                        if normalized not in seen_normalized and len(normalized) >= 2:
                            seen_normalized.add(normalized)
                            entities.append(
                                ExtractedEntity(
                                    text=entity_text,
                                    normalized_id=normalized,
                                    entity_type=None,
                                    confidence=0.6,
                                )
                            )
                    current_entity = []

            if current_entity:
                entity_text = " ".join(current_entity)
                normalized = self.normalize_to_yago_id(entity_text)

                if normalized not in seen_normalized and len(normalized) >= 2:
                    entities.append(
                        ExtractedEntity(
                            text=entity_text,
                            normalized_id=normalized,
                            entity_type=None,
                            confidence=0.6,
                        )
                    )

        entities.sort(key=lambda e: e.confidence, reverse=True)
        logger.debug(f"Extracted {len(entities)} entities: {entities}")

        return entities


def get_entity_extractor(extractor_type: str = "heuristic") -> EntityExtractor:
    """Factory: "heuristic" (default) or "nltk"."""
    if extractor_type == "nltk":
        logger.debug("Using NLTK for entity extraction")
        return NLTKEntityExtractor()
    logger.debug("Using simple heuristics for entity extraction")
    return HeuristicEntityExtractor()
