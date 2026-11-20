import sys
from datetime import date

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import invoke_with_output_retry
from app.core.output_parsing import strict_format_instructions


class HydeOutput(BaseModel):
    hypothetical_document: str = Field(description="A hypothetical passage that would answer the query")
    reasoning: str = Field(description="Brief explanation of the hypothetical content")


class HydeGenerator:
    INSTRUCTIONS = """
You are a knowledge retrieval assistant. Given a user's question, write a hypothetical passage that would directly answer this question.

## User Question
{query}

## Task
Write a hypothetical passage (2-4 sentences) that would answer this question if it existed in a knowledge base. The passage should:
1. Be written as factual content (not as a response to a question)
2. Use domain-appropriate terminology
3. Be specific and information-dense
4. Sound like it could be from a real document

## Guidelines
- Today's date is {today}. Use this to ground any temporal references (e.g. "next", "upcoming", "recent").
- Do NOT phrase it as "The answer is..." - write it as a standalone passage
- Include plausible specific details that match the query domain
- Copy any abbreviation, acronym, or initialism from the question exactly as written. Do NOT expand it or guess what it stands for: this passage is embedded to search for documents, and a wrong expansion steers the search toward a different topic entirely
- Keep it concise but informative (100-200 words maximum)
{language_instruction}

## Output Format
{output_format}

## CRITICAL — Fill in actual content, do NOT return the schema
Your response must contain real text values, not the schema description.

WRONG (do not do this):
{{"properties": {{"hypothetical_document": {{"type": "string"}}}}, "required": ["hypothetical_document"]}}

CORRECT (do this):
{{"hypothetical_document": "The Amazon rainforest covers approximately 5.5 million square kilometres and is home to an estimated 10% of all species on Earth, making it the world's most biodiverse tropical forest.", "reasoning": "I wrote a factual passage with specific details that would directly answer a query about the Amazon rainforest."}}
"""

    def __init__(self) -> None:
        self.llm_config = LLMConfig()

    @LLMCircuitBreaker()
    def generate(self, query: str, lang: str | None = None) -> str | None:
        logger.debug(f"Generating hypothetical document for query: '{query}'...")

        prompt = PromptTemplate.from_template(self.INSTRUCTIONS)

        parser: PydanticOutputParser[HydeOutput] = PydanticOutputParser(pydantic_object=HydeOutput)
        output_format = strict_format_instructions(parser)

        language_instruction = ""
        if lang and lang != "en":
            language_instruction = (
                f"- IMPORTANT: Write the hypothetical passage in {lang.upper()} language to match the query language"
            )

        model = create_chat_model(self.llm_config.llm_hyde, self.llm_config)

        try:
            result: HydeOutput = invoke_with_output_retry(
                {
                    "query": query,
                    "today": date.today().isoformat(),
                    "language_instruction": language_instruction,
                    "output_format": output_format,
                },
                prompt=prompt,
                model=model,
                parser=parser,
                component="HyDE",
            )

            logger.info(f"Generated hypothetical document ({len(result.hypothetical_document)} chars)")
            logger.debug(f"HyDE reasoning: {result.reasoning}")

            return result.hypothetical_document

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Failed to generate hypothetical document: {e}")
            return None
