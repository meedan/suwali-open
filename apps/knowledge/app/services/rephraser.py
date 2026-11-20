import sys

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import PromptTemplate
from loguru import logger
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import invoke_with_output_retry
from app.core.output_parsing import strict_format_instructions


class QueryRephraserOutput(BaseModel):
    variations: list[str] = Field(description="A list of alternative phrasings of the original query")
    reasoning: str = Field(description="A brief explanation of how the variations differ from the original")


class QueryRephraser:
    """Generates alternative phrasings of a query using an LLM."""

    INSTRUCTIONS = """
You are a query rephrasing assistant. Your task is to generate alternative phrasings of a user's question that might retrieve better results from a knowledge base.

## Input
Original query: {query}

## Task
Generate {num_variations} alternative phrasings of this query that:
1. Preserve the original intent and meaning
2. Use different vocabulary (synonyms, related terms)
3. Vary the sentence structure (question vs statement, active vs passive)
4. Adjust specificity (more general or more specific versions)
5. Focus on different aspects of the same question

## Guidelines
- Each variation should be meaningfully different from the others
- Keep variations concise and clear
- Do not add new information or assumptions not implied by the original
- If the original states or assumes a fact (a date, deadline, name, number, or place), do not carry that value into the variations as a premise. Ask about the underlying thing without it: "can I still reach the permit office at 5pm, since it closes at 6pm" becomes "what are the permit office's opening hours". A premise the knowledge base contradicts would otherwise steer every variation toward confirming it
- If the original query is in a non-English language, keep all variations in that same language

## Output Format
{output_format}
"""

    def __init__(self) -> None:
        self.llm_config = LLMConfig()

    @LLMCircuitBreaker()
    def rephrase(self, query: str, num_variations: int = 2) -> list[str]:
        logger.debug(f"Generating {num_variations} variations for query: '{query}'...")

        prompt = PromptTemplate.from_template(self.INSTRUCTIONS)

        parser: PydanticOutputParser[QueryRephraserOutput] = PydanticOutputParser(pydantic_object=QueryRephraserOutput)
        output_format = strict_format_instructions(parser)

        model = create_chat_model(self.llm_config.llm_rephraser, self.llm_config)

        try:
            result: QueryRephraserOutput = invoke_with_output_retry(
                {
                    "query": query,
                    "num_variations": num_variations,
                    "output_format": output_format,
                },
                prompt=prompt,
                model=model,
                parser=parser,
                component="Rephraser",
            )

            logger.info(f"Generated {len(result.variations)} query variations")
            logger.debug(f"Rephrasing reasoning: {result.reasoning}")

            return result.variations

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Failed to rephrase query: {e}")
            return []
