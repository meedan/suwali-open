import sys

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import invoke_with_output_retry
from app.core.output_parsing import strict_format_instructions
from app.services.language import LANGUAGE_NAMES, detect_text

# Below this, there isn't enough signal to extract meaningful topics.
_MIN_TEXT_CHARS = 10

_INSTRUCTIONS = """
You identify the main topics of a piece of content for a knowledge hub. The identified
topics MUST be in the same language as the content.

## Task
1. Identify the main BROAD topics of the content. Aim for {max_topics} when the
   content supports it; never return more than {max_topics}.
2. For EACH topic, check the existing hub topics below. If one is semantically
   equivalent and in the same language as the content, output that existing name
   verbatim. Otherwise, coin a new name in the content's language.

## Content
{text_sample}
{content_language_block}
## Existing hub topics
These are topics already used in this hub, offered for consistent naming within a language.
- If a topic name is in the same language as the content and the content concerns the topic,
REUSE the existing name EXACTLY as written below — even if the content phrases it differently
(e.g. if given "United States", reuse "United States" instead of writing "USA"; if given
"Elections", reuse "Elections" instead of "election").
- If a topic name is in a different language than the content, and the content concerns the topic,
translate the topic name to the content language (e.g. for content in English with existing "Eleições"
output "Elections", not "Eleições").
- Reuse an existing name only if it is the exact, correctly written form in the content language,
including accents and diacritics. If the correct form differs, output the correct form instead
(e.g. for French content with existing "Elections", output "Élections", not "Elections").
- The existing list does NOT limit which topics you extract — always extract the full
set of main topics, mixing reused and new names as appropriate.
{existing_topics}

## Rules
- Return at most {max_topics} topics, ordered from most to least central.
- Topics must be BROAD subjects, not narrow details or specific events.
- Each topic is a short noun phrase (1-4 words), in Title Case, with no trailing punctuation.
- Prefer reusing an existing hub topic over coining a near-duplicate in the same language.
- If the content has no clear subject, return an empty list.
- CRITICAL: You MUST extract topics in the SAME LANGUAGE as the content above. If the content
  is in Portuguese, extract Portuguese topics. If in Spanish, extract Spanish topics, etc. Do NOT
  default to English unless the content itself is in English.

## Output Format
{output_format}
"""


class TopicExtractionOutput(BaseModel):
    topics: list[str] = Field(description="The broad topics of the content, most central first")


class TopicExtractor:
    """Source-agnostic topic extraction. Given text and the hub's existing topics,
    returns up to `topic_extraction_max_count` broad topics, reusing existing canonical
    names where appropriate. Reused by document ingestion now and chat answers later."""

    def __init__(self, config: Config | None = None, llm_config: LLMConfig | None = None):
        self.config = config or Config()
        self.llm_config = llm_config or LLMConfig()

    async def extract(
        self,
        text: str,
        existing_topics: list[str],
        *,
        content_language: str | None = None,
    ) -> list[str]:
        text_sample = (text or "")[: self.config.topic_extraction_max_input_chars]
        if len(text_sample.strip()) < _MIN_TEXT_CHARS:
            logger.info("Insufficient text for topic extraction, returning no topics")
            return []

        if content_language is None:
            content_language, _ = await detect_text(text_sample)

        candidate_topics = self._select_candidate_topics(existing_topics)
        try:
            raw_topics = self._extract_with_llm(text_sample, candidate_topics, content_language)
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Topic extraction failed, returning no topics: {e}")
            return []

        topics = self._normalize(raw_topics)
        logger.info(f"Extracted {len(topics)} topic(s): {topics}")
        return topics

    def _select_candidate_topics(self, existing_topics: list[str]) -> list[str]:
        """Cap and dedupe existing hub topics offered to the LLM for reuse."""
        return self._normalize(existing_topics, limit=self.config.topic_extraction_max_existing)

    @staticmethod
    def _content_language_block(content_language: str | None) -> str:
        if content_language is None:
            return ""
        language_name = LANGUAGE_NAMES.get(content_language, content_language)
        return (
            f"\n## Content language\n"
            f"The content is in {language_name} ({content_language}). "
            f"All extracted topics MUST be in this language.\n"
        )

    @LLMCircuitBreaker()
    def _extract_with_llm(
        self,
        text_sample: str,
        candidate_topics: list[str],
        content_language: str | None = None,
    ) -> list[str]:
        prompt = PromptTemplate.from_template(_INSTRUCTIONS)
        parser: PydanticOutputParser[TopicExtractionOutput] = PydanticOutputParser(
            pydantic_object=TopicExtractionOutput
        )
        model = create_chat_model(
            self.llm_config.llm_topic_extractor,
            self.llm_config,
            timeout_seconds=self.llm_config.llm_ingestion_timeout_seconds,
        )
        existing_block = "\n".join(f"- {topic}" for topic in candidate_topics) if candidate_topics else "(none yet)"
        result: TopicExtractionOutput = invoke_with_output_retry(
            {
                "text_sample": text_sample,
                "content_language_block": self._content_language_block(content_language),
                "existing_topics": existing_block,
                "max_topics": self.config.topic_extraction_max_count,
                "output_format": strict_format_instructions(parser),
            },
            prompt=prompt,
            model=model,
            parser=parser,
            component="Topic extractor",
        )
        return result.topics

    def _normalize(self, topics: list[str], limit: int | None = None) -> list[str]:
        """Trim, drop blanks, and de-duplicate case-insensitively while preserving order."""
        if limit is None:
            limit = self.config.topic_extraction_max_count

        seen: set[str] = set()
        normalized: list[str] = []
        for topic in topics:
            name = topic.strip()
            key = name.lower()
            if name and key not in seen:
                seen.add(key)
                normalized.append(name)
        return normalized[:limit]
