import os
import sys
import tempfile
import time
from datetime import datetime
from typing import Any, Optional, Union
from urllib.parse import urlparse

import requests
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from markitdown import MarkItDown
from neo4j import Driver
from neo4j_graphrag.components.types import LexicalGraphConfig
from neo4j_graphrag.experimental.pipeline.kg_builder import SimpleKGPipeline
from neo4j_graphrag.llm.base import LLMInterface
from pdfminer.pdfdocument import PDFEncryptionError
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.config import Config
from app.core.constants import DEFAULT_PRIORITY_TIER, DOCUMENT_SUMMARY_LABEL
from app.core.errors import IngestionError
from app.core.ingestion_validation import (
    IngestionValidationContext,
    IngestionValidationError,
    ValidationCode,
    run_validations,
)
from app.core.llm_config import LLMConfig, create_chat_model, resolve_provider, resolved_openai_reasoning_effort
from app.core.llm_retry import invoke_with_output_retry
from app.core.output_parsing import strict_format_instructions
from app.services.constants import FACT_CHECK_DOMAINS
from app.services.document import Document
from app.services.embedder_factory import EmbedderFactory
from app.services.entity_glossary import EntityGlossaryExtractor, GlossaryEntry
from app.services.neo4j_client import Neo4jClient, run_with_index_recovery_async
from app.services.neo4j_llm import LangChainLLMAdapter, OpenAILLMWithTiming
from app.services.pdf_layout_extractor import extract_layout_text
from app.services.prefixed_splitter import PrefixedTextSplitter
from app.services.text_splitter_factory import TextSplitterFactory
from app.services.topic_extractor import TopicExtractor

_MARKITDOWN = MarkItDown(enable_plugins=False)


class SourceTypeOutput(BaseModel):
    source_type: str = Field(
        description="The type of source. Must be one of: 'fact_checking', 'news', 'research', 'legal', 'corporate', 'unknown'"
    )
    confidence: str = Field(description="Confidence level: 'high', 'medium', or 'low'")
    reasoning: str = Field(description="Brief explanation of the classification")


def _normalize_published_at(value: str) -> str:
    """Return the value if it parses as an ISO 8601 date/datetime, otherwise ''.

    Neo4j's datetime() function rejects non-ISO strings with CypherSyntaxError,
    which poisons temporal retriever queries. Validate at the ingestion boundary
    so only well-formed values ever reach the graph.
    """
    if not value:
        return ""
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        logger.warning(f"Dropping non-ISO published_at value: {value!r}")
        return ""
    return value


class Ingestor:
    def __init__(
        self,
        hub_id: int,
        document_id: str,
        file_url: str,
        text: str,
        original_url: str = "",
        title: str = "",
        published_at: str = "",
        priority_tier: int = DEFAULT_PRIORITY_TIER,
        existing_topics: Optional[list[str]] = None,
        text_is_markdown: bool = False,
        document_type: str = "",
        summary: str = "",
    ):
        self.llm_config = LLMConfig()
        self.hub_id = hub_id
        self.document_id = document_id
        self.file_url = file_url
        self.text = text
        self.original_url = original_url
        self.title = title
        self.published_at = _normalize_published_at(published_at)
        self.priority_tier = priority_tier
        self.existing_topics = existing_topics or []
        self.job_id = ""
        self.text_is_markdown = text_is_markdown
        self.document_type = document_type
        self.summary = summary
        self.summary_block = ""
        self.pipeline: Optional[SimpleKGPipeline] = None
        self.driver: Optional[Driver] = None
        self.source_type: Optional[str] = None
        self.topics: list[str] = []
        self.entity_glossary: list[GlossaryEntry] = []

    async def run(self) -> None:
        try:
            self.job_id = f"{self.hub_id}-{self.document_id}-{int(time.time())}"
            self._init_driver()
            self._delete_existing_document()
            if self.text and self.file_url:
                logger.warning("Both text and file_url provided - only file_url will be used")
            if self.file_url:
                await self._download_file()
            if self.summary.strip():
                self.summary_block = f"{DOCUMENT_SUMMARY_LABEL}\n\n{self.summary.strip()}\n\n"
                self.text = f"{self.summary_block}{self.text}"

            run_validations(
                IngestionValidationContext(
                    text=self.text,
                    document_id=self.document_id,
                    hub_id=self.hub_id,
                    file_url=self.file_url,
                )
            )

            # auto-classify source type to adjust extraction strategy (prompt template, schema hints).
            # TODO: accept explicit source_type parameter from CMS API when available (from FE).
            self._classify_source_type()
            await self._extract_topics()
            self._extract_entity_glossary()
            self._init_pipeline()
            await self._run_pipeline()
            await self._add_custom_metadata()
        except IngestionValidationError:
            raise
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Ingestion error: {e}")
            raise IngestionError(f"Ingestion failed for document {self.document_id}") from e

    def _init_driver(self) -> None:
        client = Neo4jClient()
        self.driver = client.get_driver(self.hub_id)
        logger.info(f"Neo4j driver initialized for hub {self.hub_id}")

    def _delete_existing_document(self) -> None:
        if not self.driver:
            return

        with self.driver.session() as session:
            document_service = Document(session, self.hub_id)
            document_service.remove(self.document_id)

    async def _download_file(self) -> None:
        response = requests.get(self.file_url, timeout=300)
        response.raise_for_status()
        parsed = urlparse(self.file_url)
        path = parsed.path  # E.g., '/file.txt'
        extension = os.path.splitext(path)[1]  # E.g., '.txt'

        if extension.lower() == ".txt":
            encoding = response.apparent_encoding or "utf-8"
            self.text = response.content.decode(encoding, errors="replace")
            self.text_is_markdown = False
            return

        if extension.lower() in (".md", ".markdown"):
            encoding = response.apparent_encoding or "utf-8"
            self.text = response.content.decode(encoding, errors="replace")
            self.text_is_markdown = True
            return

        tmp_path = self._write_file(response.content, extension)
        try:
            # markitdown's PDF extraction heuristics sometimes results in interleaved text and tables
            # use pdfminer directly, with layout-aware post-processing that tags photo captions
            # and infobox/sidebar content instead of splicing them into body prose
            if extension.lower() == ".pdf":
                try:
                    self.text = extract_layout_text(tmp_path)
                except PDFEncryptionError as e:
                    raise IngestionValidationError(
                        ValidationCode.PDF_PASSWORD_PROTECTED,
                        f"Document {self.document_id} is a password-protected PDF (file_url={self.file_url})",
                    ) from e
                self.text_is_markdown = False
            else:
                doc = _MARKITDOWN.convert(tmp_path)
                self.text = doc.markdown
                self.text_is_markdown = True
        finally:
            os.remove(tmp_path)

    def _write_file(self, content: Union[str, bytes], extension: str) -> str:
        if isinstance(content, str):
            content = content.encode("utf-8")  # Convert str to bytes
        with tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=extension) as tmp:
            tmp.write(content)
        logger.info(f"Saved file to: {tmp.name}")
        return tmp.name

    def _get_text_sample(self, max_chars: int = 5000) -> str:
        """Extract text sample for source type classification.

        RSS feeds and other CMS sources already strip HTML tags before sending,
        so content is clean text.
        """
        if self.text:
            return self.text[:max_chars]

        return ""

    def _classify_source_type(self) -> None:
        """Classify source type via URL heuristics (fast path) or LLM fallback."""
        if self._check_url_for_fact_checking():
            return

        text_sample = self._get_text_sample()
        if not text_sample or len(text_sample.strip()) < 50:
            self.source_type = "unknown"
            logger.info("Insufficient text for classification, defaulting to 'unknown'")
            return

        self._classify_with_llm(text_sample)

    async def _extract_topics(self) -> None:
        """Extract broad topics for subscriptions. Best-effort: never fails ingestion."""
        config = Config()
        if not config.topic_extraction_enabled:
            return
        try:
            self.topics = await TopicExtractor(config=config, llm_config=self.llm_config).extract(
                self.text, self.existing_topics
            )
        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Topic extraction step failed, continuing without topics: {e}")
            self.topics = []

    def _extract_entity_glossary(self) -> None:
        """Document-level canonical entity pass. Best-effort: never fails ingestion."""
        config = Config()
        if not config.entity_glossary_enabled:
            return
        self.entity_glossary = EntityGlossaryExtractor(config=config, llm_config=self.llm_config).extract(
            self.text, self._schema_guidance_for_source_type()
        )

    def _check_url_for_fact_checking(self) -> bool:
        """Fast-path classification: check URL against known fact-checking domains.

        Checks original_url first (RSS feed article URL), then falls back to file_url.
        """
        url_to_check = self.original_url or self.file_url
        if not url_to_check:
            return False

        url_lower = url_to_check.lower()
        if any(domain in url_lower for domain in FACT_CHECK_DOMAINS):
            self.source_type = "fact_checking"
            logger.info(f"Classified as fact_checking based on URL: {url_to_check}")
            return True
        return False

    @LLMCircuitBreaker()
    def _classify_with_llm(self, text_sample: str) -> None:
        """Classify source type using LLM when URL heuristics don't match."""
        instructions = """
You are a source type classifier. Classify the type of source based on the provided text sample and URL.

## text Sample
{text_sample}

## URL (if available)
{file_url}

## source Types

1. **fact_checking**: Fact-checking content that verifies claims, debunks misinformation, or corrects false information. Look for:
   - Terms like "fact-check", "verified", "false", "misleading", "debunked", "rating", "verdict"
   - Claims being evaluated or assessed
   - Ratings like "True", "False", "Partly False", "Misleading"
   - References to checking or verifying claims

2. **news**: News articles, journalism, current events coverage

3. **research**: Academic papers, research studies, scientific publications

4. **legal**: Legal documents, court cases, statutes, legal opinions

5. **corporate**: Business documents, company reports, corporate communications

6. **unknown**: Cannot determine or doesn't fit other categories

## Output Format
{output_format}
"""

        try:
            prompt = PromptTemplate.from_template(instructions)
            parser: PydanticOutputParser[SourceTypeOutput] = PydanticOutputParser(pydantic_object=SourceTypeOutput)
            output_format = strict_format_instructions(parser)

            model = create_chat_model(
                self.llm_config.llm_ingestor_classify,
                self.llm_config,
                timeout_seconds=self.llm_config.llm_ingestion_timeout_seconds,
            )

            url_for_classification = self.original_url or self.file_url or "Not provided"
            result: SourceTypeOutput = invoke_with_output_retry(
                {
                    "text_sample": text_sample,
                    "file_url": url_for_classification,
                    "output_format": output_format,
                },
                prompt=prompt,
                model=model,
                parser=parser,
                component="Ingestor classifier",
            )

            valid_types = ["fact_checking", "news", "research", "legal", "corporate", "unknown"]
            normalized_type = result.source_type.lower().replace("-", "_").replace(" ", "_")
            if normalized_type in valid_types:
                self.source_type = normalized_type
            else:
                self.source_type = "unknown"

            logger.info(
                f"Classified source type: {self.source_type} "
                f"(confidence: {result.confidence}, reasoning: {result.reasoning[:100]}...)"
            )

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(
                f"Failed to classify source type: {e}. Defaulting to 'unknown' source type due to classification error."
            )
            self.source_type = "unknown"

    _SCHEMA_BY_SOURCE_TYPE: dict[str, str] = {
        "news": (
            "Person, Organization, Location, Event, Date\n"
            "Relationships: MENTIONED_IN, WORKS_FOR, LOCATED_IN, OCCURRED_AT, QUOTED, CAUSES, PREVENTS"
        ),
        "research": (
            "Person, Organization, Institution, Concept, Method, Finding, Dataset\n"
            "Relationships: AUTHORED_BY, AFFILIATED_WITH, USES_METHOD, CITES, SUPPORTS, CONTRADICTS, "
            "CAUSES, PREVENTS, ENABLES"
        ),
        "legal": (
            "Person, Organization, Location, Party, Court, Statute, Ruling, Date\n"
            "Relationships: FILED_BY, RULED_ON, CITES_STATUTE, REPRESENTS, APPEALED_TO, REQUIRES, CONDITION_FOR"
        ),
        "corporate": (
            "Company, Person, Location, Product, Transaction, Amount, Date\n"
            "Relationships: ACQUIRED, PARTNERED_WITH, LAUNCHED, INVESTED_IN, EXECUTIVE_OF, ENABLES, REQUIRES"
        ),
        "fact_checking": (
            "Person, Organization, Location, Claim, FactChecker, Assessment, Evidence, Source, Rating\n"
            "Relationships: DEBUNKS, VERIFIES, CONTRADICTS, CITES, ASSESSES, RATES_AS, CAUSES, PREVENTS\n"
            "NOTE: Distinguish the ORIGINAL CLAIM from the FACT-CHECKER'S ASSESSMENT."
        ),
    }

    _DEFAULT_SCHEMA = (
        "Person, Organization, Location, Event, Date, Concept\n"
        "Relationships: MENTIONED_IN, WORKS_FOR, LOCATED_IN, AFFILIATED_WITH, RELATED_TO, "
        "CAUSES, PREVENTS, ENABLES, REQUIRES, CONDITION_FOR"
    )

    def _schema_guidance_for_source_type(self) -> str:
        return self._SCHEMA_BY_SOURCE_TYPE.get(self.source_type or "", self._DEFAULT_SCHEMA)

    def _init_pipeline(self) -> None:
        if not self.driver:
            self._init_driver()
            if self.driver is None:
                raise RuntimeError("Failed to initialize Neo4j driver")

        extract_cfg = self.llm_config.llm_ingestor_extract
        provider = resolve_provider(extract_cfg)
        llm: LLMInterface

        if provider == "OPENAI":
            model_params: dict[str, Any] = {
                "response_format": {"type": "json_object"},
                "temperature": extract_cfg.temperature if extract_cfg.temperature is not None else 0,
            }
            reasoning_effort = resolved_openai_reasoning_effort(extract_cfg, self.llm_config)
            if reasoning_effort is not None:
                model_params["reasoning_effort"] = reasoning_effort
            llm = OpenAILLMWithTiming(
                model_name=extract_cfg.model or self.llm_config.openai_model,
                model_params=model_params,
                timeout=self.llm_config.llm_ingestion_timeout_seconds,
            )
        else:
            # Bedrock models don't support an API-level response_format constraint like OpenAI's
            # json_object mode. JSON output is enforced via the extraction prompt only.
            llm = LangChainLLMAdapter(
                create_chat_model(
                    extract_cfg,
                    self.llm_config,
                    timeout_seconds=self.llm_config.llm_ingestion_timeout_seconds,
                )
            )

        prompt_template = self._build_extraction_prompt()

        embedder = EmbedderFactory.get_embedder(purpose="index")
        text_splitter = TextSplitterFactory.get_text_splitter(text_is_markdown=self.text_is_markdown)
        if self.summary_block:
            # the summary is written as Markdown, whatever the format of the document's text
            text_splitter = PrefixedTextSplitter(
                self.summary_block, TextSplitterFactory.get_text_splitter(text_is_markdown=True), text_splitter
            )
        lexical_graph_config = LexicalGraphConfig()
        lexical_graph_config.chunk_node_label = f"Chunk_{self.hub_id}"
        lexical_graph_config.document_node_label = f"Document_{self.hub_id}"
        self.pipeline = SimpleKGPipeline(
            llm=llm,
            driver=self.driver,
            text_splitter=text_splitter,
            embedder=embedder,
            prompt_template=prompt_template,
            from_pdf=False,
            lexical_graph_config=lexical_graph_config,
            schema="FREE",
        )

    def _glossary_block(self) -> str:
        if not self.entity_glossary:
            return ""

        def escape(value: str) -> str:
            # the assembled prompt goes through str.format() in the extraction template,
            # so any literal braces in glossary content must be doubled
            return value.replace("{", "{{").replace("}", "}}")

        lines = []
        for entry in self.entity_glossary:
            alias_suffix = ""
            if entry.aliases:
                alias_suffix = " (also mentioned as: " + ", ".join(f'"{escape(a)}"' for a in entry.aliases) + ")"
            lines.append(f'- "{escape(entry.name)}" [{escape(entry.label)}]{alias_suffix}')
        glossary_lines = "\n".join(lines)

        return f"""
KNOWN ENTITIES (canonical glossary for this document):
The whole document was pre-scanned and these canonical entities were identified:
{glossary_lines}
- When the input text mentions one of these entities under ANY of its surface forms (including aliases), you MUST use the canonical name and label EXACTLY as listed above — never a variant spelling, synonym, or different label.
- The glossary does NOT limit extraction: also extract relevant entities that are not listed — especially named countries, organizations, and people mentioned even once.
"""

    def _build_extraction_prompt(self) -> str:
        fact_checking_caveat = ""
        if self.source_type == "fact_checking":
            fact_checking_caveat = """
**IMPORTANT: FACT-CHECKING SOURCE DETECTED**

This document is from a fact-checking website. It may contain:
- False or misleading claims being debunked
- Fact-checker assessments and corrections
- Contradictory information (the false claim vs. the verified fact)

**CRITICAL EXTRACTION GUIDELINES:**
- Distinguish the ORIGINAL CLAIM from the FACT-CHECKER'S ASSESSMENT.
- Mark relationships that indicate DEBUNKS, VERIFIES, or CONTRADICTS.
- Extract both the false claim and the corrected information as separate entities.
- When a claim is marked as "False" or "Misleading", create relationships that reflect this assessment.
"""

        schema_guidance = self._schema_guidance_for_source_type()

        return f"""You are a member of an organization extracting information from documents and structuring it in a property graph to support Q&A.
{fact_checking_caveat}
Extract entities (nodes) with a type label and properties, and relationships between them.
Use DIVERSE entity types — not just Person.

SCHEMA GUIDANCE:
{schema_guidance}
Use these types when they fit. Otherwise, choose a clear, specific label.
Do not omit important facts just because they don't appear in the schema lists.
If multiple labels fit, prefer the most specific.
{self._glossary_block()}
ENTITY QUALITY RULES:
- Every node MUST have a "name" property holding the entity's name. A node without a name cannot be linked to anything — do not emit nameless nodes.
- Focus on real-world people, organizations, locations, events, concepts. Prefer a small, precise set of nodes over many noisy ones.
- Skip pronouns, generic words, fragments shorter than 3 characters.
- Ignore code, JSON, URLs, IDs, emails, and other structured strings.
- When multiple people share a surname (e.g. "Alice Johnson" and "Robert Johnson"), extract each as a SEPARATE entity with their FULL name. Never merge them into just the shared surname.
- If context is ambiguous, do not create the node/relationship.
- **CRITICAL — Copy entity names CHARACTER-FOR-CHARACTER as they appear in the source text.** Do NOT paraphrase, correct spelling, substitute synonyms, or rearrange letters — even if the name looks like a typo or unusual brand name. These are intentional spellings. If the text says "AcmeCorpX", the entity name MUST be "AcmeCorpX" — not "AcmeCorp" or any other variation. Treat every proper noun as deliberately coined — never "fix" them. Exception: Markdown formatting characters (`**`, `_`, `##`, `` ` ``, `|`) must always be stripped from entity names even when they surround the name in the source text — e.g. `**Elena Vasquez**` → `"Elena Vasquez"`.
- **For locations, extract BOTH the specific and the general entity.** If the text mentions any city, you MUST also extract its country as a separate Location node. Example: if the text mentions a city in Germany (e.g. "Berlin" or "Munich"), you MUST also extract "Germany". Do not replace a country name with one of its cities or vice versa — extract BOTH.
- **When extracting country names that use a definite article (e.g. "the Netherlands", "the United States"), extract the name WITHOUT the article** (e.g. "Netherlands", "United States").
- **The input text may contain Markdown formatting** (e.g. `##` headings, `**bold**`, `_italic_`, bullet lists, tables). Extract entities from both prose and tables; treat Markdown syntax characters (including `|` and `---` table delimiters) as formatting only and do NOT include them in entity names or properties.

TABLE RULES (apply to any table: schedules, rosters, price lists, results, specs, etc.):
- A table row is one record. Bind ALL cells in the same row together: create relationships linking every entity in that row to the others (e.g. a name, its category/role, and the value in the adjacent column belong to the same record, not to whatever row happens to be nearby).
- Column headers label the cells beneath them. Treat a cell's value as belonging to the entity in its row under the property named by its column header.
- Section/group-header rows apply to every row beneath them until the next such header. A cell that spans or heads a group (a time range, a date, a category, a region) is shared context for EVERY row under it. Propagate that context down: attach the header value to each row's entities; do not leave it as a floating unconnected node, and never attach it to only the first row.
- When a row pairs an entity with a time, date, location, price, or status, emit an EXPLICIT relationship for that pairing rather than leaving the two as co-located nodes. Co-location is not enough — the edge is what lets Q&A answer questions like "which item costs X" or "who is in the 2 pm slot".
  Example: a table grouped under a header "Track B — Room 204" with rows listing several talks means EACH of those talks must get an explicit relationship to "Room 204" (e.g. LOCATED_AT / OCCURRED_AT), not just the first one — and a talk under a different header must never be linked to "Room 204".

LAYOUT RULES (photo captions, sidebars, and other non-body regions):
- The input may contain tagged regions: a paragraph starting with [photo caption] is a figure caption; text between [sidebar] and [/sidebar] is a sidebar or infobox. Treat each tagged region as its own evidence scope, separate from surrounding body prose, even when they appear in the same input.
- Extract a fact from a tagged region only when that region itself states it about the things the region is describing (what an image shows; what a sidebar asserts about its own subject). Do not treat caption or sidebar text as attributes of people, organizations, or places that appear only outside that region.
- Do not create any relationship whose two ends come from different sides of a caption or sidebar boundary.

CAUSAL & CONDITIONAL RELATIONSHIP RULES:
- When the text EXPLICITLY states a cause-effect or conditional link between two extracted entities, capture it with one of: CAUSES, PREVENTS, ENABLES, REQUIRES, CONDITION_FOR.
- ONLY when the text uses explicit causal/conditional language ("caused", "led to", "results in", "prevents", "requires", "if ... then", "provided that", "unless"). NEVER infer causality from temporal sequence ("after", "then"), correlation, or mere co-occurrence of two entities.
- Every causal/conditional relationship MUST carry two properties:
  - "modality": exactly one of "asserted" (stated as fact), "hedged" ("may", "could", "is believed to"), "hypothetical" (if-then, scenarios, predictions), "negated" (the text denies the link).
  - "evidence": the verbatim phrase from the source text expressing the link, copied character-for-character, at most 200 characters.
- Direction: start node is the cause/condition, end node is the effect/consequence.
- If either side of the link is not a clear extractable entity, do not force a causal relationship.

PROPERTY RULES:
- NEVER use "id" as a property key (use "external_id" instead).
- Values must be DIRECT primitives only (string, number, boolean). No nested objects or arrays.
  BAD: {{{{"description": {{{{"text": "value"}}}}}}}}
  GOOD: {{{{"description": "A single string value"}}}}
- Keys must be lowercase_snake_case.
- Omit empty properties entirely.

Return ONLY valid JSON. No backticks, no markdown, no extra text.
Return the result as JSON using EXACTLY this format:
{{{{
  "nodes": [
    {{{{"id": "0", "label": "Person", "properties": {{{{"name": "Jane Smith", "title": "Engineer"}}}}}}}},
    {{{{"id": "1", "label": "Organization", "properties": {{{{"name": "Acme Corp"}}}}}}}}
  ],
  "relationships": [
    {{{{"type": "WORKS_FOR", "start_node_id": "0", "end_node_id": "1"}}}},
    {{{{"type": "CAUSES", "start_node_id": "2", "end_node_id": "3", "properties": {{{{"modality": "hedged", "evidence": "the drought may lead to crop failure"}}}}}}}}
  ]
}}}}

CRITICAL PROPERTY RULES - VIOLATION WILL CAUSE SYSTEM FAILURE:

1. **NEVER use "id" as a property key**
   - ❌ BAD: {{{{"properties": {{{{"id": "123"}}}}}}}}
   - ✅ GOOD: {{{{"properties": {{{{"external_id": "123"}}}}}}}}

2. **Property values = DIRECT PRIMITIVES ONLY**
   Each property MUST map to a single string, number, or boolean value.

   ❌ ABSOLUTELY FORBIDDEN:
   - {{{{"description": {{{{"text": "value"}}}}}}}}  ← NO nested objects
   - {{{{"metadata": {{{{"key": "value"}}}}}}}}      ← NO nested maps
   - {{{{"tags": [{{{{"name": "tag"}}}}]}}}}         ← NO arrays of objects
   - {{{{"info": {{{{"description": "text"}}}}}}}}   ← NO ANY nested structure

   ✅ CORRECT FORMAT:
   - {{{{"description": "A single string value"}}}}
   - {{{{"count": 5}}}}
   - {{{{"is_active": true}}}}
   - {{{{"tag_list": "tag1, tag2, tag3"}}}}

3. **Property keys = lowercase_snake_case**
   - ❌ BAD: "birthDate", "Birth-Date", "firstName"
   - ✅ GOOD: "birth_date", "first_name", "event_year"

4. **Empty properties = omit the field**
   - ❌ BAD: {{{{"properties": {{{{}}}}}}}}
   - ✅ GOOD: (no "properties" field)

EXAMPLES OF VALID NODES:
{{{{
  "id": "1",
  "label": "Person",
  "properties": {{{{
    "name": "John Doe",
    "age": 30,
    "title": "Engineer"
  }}}}
}}}}

{{{{
  "id": "2",
  "label": "Event",
  "properties": {{{{
    "name": "Conference",
    "year": 2024,
    "location": "New York"
  }}}}
}}}}

ADDITIONAL RULES:
- Use only information from the input text.
- If input is empty, return {{{{"nodes": [], "relationships": []}}}}.
- Create rich context with multiple nodes and relationships.
- Use general entity types to connect information across documents.
- Assign unique string IDs ("0", "1", "2", ...) and reuse them in relationships.
- Maintain correct relationship direction (start_node_id -> end_node_id).

Input text:

{{text}}
"""

    async def _run_pipeline(self) -> None:
        pipeline = self.pipeline
        if not pipeline:
            raise RuntimeError("Pipeline not initialized")

        # The pipeline writer upserts by job_id, so re-running with the same job_id
        # after index recovery is safe.
        await run_with_index_recovery_async(
            lambda: pipeline.run_async(text=self.text, document_metadata={"job_id": self.job_id}),
            self.hub_id,
            "document ingestion pipeline",
        )

        self._log_extraction_summary()

    def _log_extraction_summary(self) -> None:
        if not self.driver:
            return
        try:
            with self.driver.session() as session:
                records = session.run(
                    f"""
                    MATCH (d:Document_{self.hub_id} {{job_id: $job_id}})
                    MATCH (c:Chunk_{self.hub_id})-[:FROM_DOCUMENT]->(d)
                    MATCH (e)-[:FROM_CHUNK]->(c)
                    WITH labels(e) AS lbls
                    UNWIND lbls AS lbl
                    WITH lbl WHERE NOT lbl STARTS WITH '__'
                    RETURN lbl AS label, count(*) AS cnt
                    ORDER BY cnt DESC
                    """,
                    job_id=self.job_id,
                ).data()
                entity_summary = {r["label"]: r["cnt"] for r in records}
                total = sum(entity_summary.values())
                if entity_summary:
                    logger.info(f"Extracted {total} entities: {entity_summary}")
                else:
                    logger.warning("No entities extracted from document")
        except Exception as e:
            logger.debug(f"Could not query extraction summary: {e}")

    async def _add_custom_metadata(self) -> None:
        if self.driver:
            with self.driver.session() as session:
                # published_at is set via a separate CASE expression so it lands
                # as a native DateTime on both Document and Chunk nodes — the
                # read path (temporal retriever, synthesis scoring) compares
                # against datetime() literals, which only works for DateTime,
                # not strings.
                metadata = {
                    "hub_id": self.hub_id,
                    "document_id": self.document_id,
                    "file_url": self.file_url,
                    "source_type": self.source_type or "unknown",
                    "priority_tier": self.priority_tier,
                }

                if self.title:
                    metadata["title"] = self.title

                if self.document_type:
                    metadata["document_type"] = self.document_type

                document_query = f"""
                MATCH (d:Document_{self.hub_id} {{job_id: $job_id}})
                SET d += $metadata
                SET d.published_at = CASE
                    WHEN $published_at IS NULL OR $published_at = ''
                    THEN NULL
                    ELSE datetime($published_at)
                END
                RETURN d
                """
                # priority_tier is copied onto chunks because the recency-first pre-filter
                # only sees chunk properties and lets prioritized chunks bypass the window
                chunk_query = f"""
                MATCH (d:Document_{self.hub_id} {{job_id: $job_id}})
                MATCH (c:Chunk_{self.hub_id})-[:FROM_DOCUMENT]->(d)
                SET c.published_at = CASE
                    WHEN $published_at IS NULL OR $published_at = ''
                    THEN NULL
                    ELSE datetime($published_at)
                END
                SET c.priority_tier = $priority_tier
                RETURN count(c) AS chunk_count
                """

                document_result = session.run(
                    document_query, job_id=self.job_id, metadata=metadata, published_at=self.published_at
                )
                chunk_result = session.run(
                    chunk_query,
                    job_id=self.job_id,
                    published_at=self.published_at,
                    priority_tier=self.priority_tier,
                )
                chunk_record = chunk_result.single()
                chunk_count = chunk_record["chunk_count"] if chunk_record else 0

                if document_result.single():
                    logger.info(f"Added metadata to document: {self.document_id}")
                    logger.info(f"Added metadata to {chunk_count} chunk(s) for document: {self.document_id}")
