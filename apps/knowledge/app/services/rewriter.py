import json
import sys
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from langchain_core.language_models import LanguageModelInput
from langchain_core.messages import BaseMessage
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompt_values import PromptValue
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import Runnable
from loguru import logger
from openai import BadRequestError
from pydantic import BaseModel, Field

from app.core.circuit import LLMCircuitBreaker
from app.core.debug_log import TRUNCATE
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.llm_retry import invoke_with_output_retry
from app.core.output_parsing import strict_format_instructions
from app.models.chat import ChatRequest, Metadata
from app.services import personalization


class Rewriter(ABC):
    @staticmethod
    def apply(chat: ChatRequest, pipeline: list["Rewriter"] | None, metadata: Metadata | None) -> ChatRequest:
        if not pipeline:
            return chat

        for rewriter in pipeline:
            chat = rewriter.run(chat, metadata)

        return chat

    @abstractmethod
    def run(self, chat: ChatRequest, metadata: Metadata | None) -> ChatRequest:
        pass


class HistoryAwareQuestionRewriterOutput(BaseModel):
    message: str = Field(
        description="The rewritten, fully self-contained question, or the original message unchanged when no rewrite applies"
    )
    reasoning: str = Field(
        description="A brief plain-text explanation describing which prior messages (by their content role/summary, not indices) were used and why they were necessary; do not quote unused history. Write it impersonally, describing the rewrite itself - never in the first person ('I', 'my', 'we')"
    )


class HistoryAwareQuestionRewriter(Rewriter):
    def __init__(self, handle_dates: bool = False):
        self.handle_dates = handle_dates

    @staticmethod
    def _serialize_request_payload(payload: Any) -> str:
        return json.dumps(payload, ensure_ascii=True, default=str)

    def _extract_model_request_payload(
        self, model: Runnable[LanguageModelInput, BaseMessage], prompt_value: PromptValue
    ) -> str | None:
        get_request_payload = getattr(model, "_get_request_payload", None)
        if not callable(get_request_payload):
            return None

        prompt_messages = prompt_value.to_messages() if hasattr(prompt_value, "to_messages") else prompt_value

        attempts: tuple[tuple[tuple[Any, ...], dict[str, Any]], ...] = (
            ((prompt_messages,), {}),
            ((prompt_messages,), {"stop": None}),
        )
        for args, kwargs in attempts:
            try:
                payload = get_request_payload(*args, **kwargs)
                return self._serialize_request_payload(payload)
            except TypeError:
                continue
            except Exception as e:
                logger.debug(f"Failed to extract rewriter request payload: {e}")
                return None

        return None

    @staticmethod
    def _extract_failed_request_content(exc: BadRequestError) -> str | None:
        request = getattr(exc, "request", None)
        if request is None:
            response = getattr(exc, "response", None)
            request = getattr(response, "request", None)

        if request is None:
            return None

        content = getattr(request, "content", None)
        if content is None:
            return None

        if isinstance(content, bytes):
            return content.decode("utf-8", errors="replace")
        return str(content)

    @staticmethod
    def _mark_failed(metadata: Metadata | None) -> None:
        """Record that prior context went unresolved.

        The question is still searched as written, which is indistinguishable in the
        response from a first turn that had no history to resolve.
        Nothing renders this yet; it exists so the two cases can be told apart when triaging.
        """
        if metadata is not None:
            metadata.rewriter_failed = True

    @staticmethod
    def _user_notes_section(chat: ChatRequest) -> str:
        block = personalization.user_notes_block(chat.conversation_context)
        if not block:
            return ""
        return (
            "\n## Notes About the User\n\n"
            f"{block}\n"
            'Words that point to the user\'s own location, such as "here", "near me", "around me", "in my country", '
            '"in my city", "in my state" or "local", refer to the location in these notes: replace them with that location (e.g. '
            '"Where can I vote here?" with the note "Lives in Ohio" becomes "Where can I vote in Ohio?"). This is an exception to the Step 1 pronoun rule and to the rule that every entity must appear '
            'in "message" or "history": the notes are an allowed source for the user\'s location. "There" is not one '
            "of these words: it still refers to a place mentioned in the conversation.\n"
            "Otherwise, add the user's location from these notes to the question ONLY when the answer genuinely depends on "
            'where the user is and the question does not already say it — e.g. "when are the local elections?" '
            'or "where can I get vaccinated?". A question that names its own subject (a person, an organisation, or an '
            'identified measure, bill, proposition, ballot question, amendment or office such as "State Question 847" '
            'or "Proposition 50") is complete as written: that thing is what it is wherever the user lives, so never '
            "add the location to it, even when it names no place. The location belongs only to questions about the "
            "user's own situation or surroundings. "
            "A request for a digest, summary, update or overview that names no place and no subject "
            "is about the user's surroundings too, so add the location from the notes to it "
            '(e.g. "summarize this week\'s news" with the note "Lives in Ohio" becomes "Summarize this week\'s news in Ohio"). '
            "If the question names its own place, keep the question's place "
            "and ignore the note. Never add the location to a question that does not depend on it.\n\n---\n"
        )

    @LLMCircuitBreaker()
    def run(self, chat: ChatRequest, metadata: Metadata | None) -> ChatRequest:
        if not chat.history and not chat.conversation_context:
            return chat

        if metadata is not None:
            lang = metadata.language or metadata.retriever_detected_lang
            metadata.rewriter_detected_lang = lang
        else:
            lang = None

        language_instruction = ""
        if lang:
            language_instruction = f"""
6. **LANGUAGE REQUIREMENT**:
   - CRITICAL: You MUST reply in {lang.upper()} LANGUAGE.
   - The impersonal-reasoning rule below applies in {lang.upper()} as well: use impersonal constructions only, and never a first-person verb form, even when that language marks the first person on the verb without a separate pronoun.
"""

        date_instruction = ""
        if self.handle_dates:
            rewrite_substep_num = 7 if language_instruction else 6
            date_instruction = f"""
{rewrite_substep_num}. **DATE CONVERSION**:
   - Today's date is {datetime.today().date().isoformat()}.
   - Convert relative date expressions (yesterday, last week, 3 days ago, next Monday, etc.) to ISO format (YYYY-MM-DD).
   - Apply this to both the question and any date references you include from history.
"""

        INSTRUCTIONS = f"""
You are a question rewriting module that makes the current user question fully self-contained and unambiguous.

You receive:
- The full chat history (in the "history" field - messages with roles "system", "user", or "assistant")
- Recent conversation context (in the "last_message" field - contains the last few turns of the conversation)
- The current user message (in the "message" field)

Your job is to **rewrite the current user question ("message") into a standalone, explicit question** that can be understood without the conversation context.

---

## Step 1 — Pronoun Resolution (STRICT RULE)

When resolving pronouns or implicit references ("he", "she", "it", "they", "that", "this", "there", etc.):

1. **CRITICAL**: You MUST resolve them ONLY using entities that appear in "last_message" (recent conversation context).
2. You MUST IGNORE any older conversation history for pronoun resolution.
3. If a pronoun cannot be unambiguously resolved from "last_message" alone, do not invent or guess a name; instead, keep the pronoun as-is or use a generic descriptor.
4. A generic descriptor keeps whatever "last_message" uses to define the group: the place, election, office, event or list it belongs to. "their" after a list of candidates on the ballot in State A becomes "the candidates on the ballot in State A", never a bare "the candidates" — without the qualifier the search has no place to anchor on and returns a candidate from anywhere. This is Step 2 rule 3 (a location the question presupposes) applied at the same time as the pronoun.

**Examples:**
- If last_message says "John went to the store" and message says "What did he buy?", rewrite as "What did John buy?"
- If last_message says "The report was submitted" and message says "Who wrote it?", rewrite as "Who wrote the report?"
- If last_message says "Several candidates applied for the council seat in Lagos" and message says "Which one has the most experience?", keep as "Which of the candidates for the council seat in Lagos has the most experience?" (no specific candidate is named in last_message, so the group keeps its qualifier)
- If last_message says "Meedan is an organization focused on fact-checking" and message says "Who was it last CEO?", rewrite as "Who was the last CEO of Meedan?"

---

## Step 2 — Context Enrichment (ONLY WHEN GENUINELY AMBIGUOUS)

Enrich the question with history **only** when the question is genuinely ambiguous or incomplete without it. A question that introduces a new, specific topic should be left unchanged — do NOT inject context from previous turns about different topics.

**When to enrich** (the question contains a reference that CANNOT be understood on its own):

1. **Definite descriptions that refer back to history**: "the report", "the program", "the policy" — where the specific entity was introduced in earlier turns.
2. **User clarifications**: "I mean X", "I'm talking about X", "I meant the X", "no, the X" — explicit references to prior context.
3. **Constraints the question depends on**: timeframes, versions, locations, or definitions established in previous turns that the current question presupposes.
4. **Generic terms** that clearly refer to something specific mentioned earlier (e.g., "the process", "the issue", "the plan").

When a definite description or clarification is found, scan the FULL conversation history to resolve it — even if the referenced entity was mentioned 5+ turns ago.

**When NOT to enrich** (leave the question unchanged):

1. **The question introduces a new, specific topic** — e.g., user previously asked about the economy, now asks about a workers' strike. These are independent questions; do NOT mix topics.
2. **The question is already self-contained** — it names specific entities, dates, or subjects and can be understood without any history.
3. **The connection to history is only thematic, not referential** — e.g., both questions are about the same country but about completely different subjects. Shared geography or domain is NOT a reason to enrich when the answer is the same everywhere ("What causes malaria?" after a question about Lagos stays as it is).
   This is NOT the case for anything set per place — elections, ballots, deadlines, procedures, services, offices, rules, prices. For such a question, a place the user established in an earlier turn ("I vote in California", "I live in Lagos") or in the notes about the user is a constraint the question depends on (rule 3 above) and MUST be carried, even when the question itself has no place word: "how can I skip the lines?" after "I vote in California, when is the registration deadline?" becomes "How can I skip the lines at a polling place in California?". Without the place the search has nothing to anchor on and returns another place's rules.

**Inclusion rules:**
- Use the minimal portion of history needed to make the question self-contained.
- Do not include "system" messages unless absolutely necessary.

**Exclusion rules:**
- Do not inject context from previous turns about different topics or subjects.
- Do not use unrelated topical branches.
- Do not quote or rely on history that isn't needed for understanding.
- **When in doubt about whether to add context, leave the question unchanged** — it is better to under-enrich than to contaminate the question with irrelevant context from a different topic.

---

## Step 3 — Rewrite the Question

1. **Rewrite** the current user question ("message") into a single, concise, self-contained question IN THE SAME LANGUAGE AS THE ORIGINAL. The output must always be a question directed at the knowledge base that preserves the user's intent — NEVER a question directed back at the user. Do NOT ask for clarification in the rewrite (no "did you mean X or Y?"): if a reference is ambiguous, apply Step 1 rule 3 (keep the pronoun or use a generic descriptor) and still output one answerable question.

2. **Apply pronoun resolution** using ONLY "last_message" (recent conversation context) (Step 1 rules).

3. **Apply context enrichment** using full "history" (Step 2 rules).

4. **Preserve intent and scope**: do not broaden or narrow the task beyond what the original question + history justify.

5. **If no history (and no note about the user) is needed**, return the original message character-for-character unchanged, in its original language and script.
{language_instruction}
{date_instruction}

---

## Output Requirements

Return **valid JSON only** in the following format:

{{output_format}}

### Reasoning Guidance
- Keep the reasoning short and factual (2-5 sentences).
- Explain what was resolved from "last_message" (pronouns) and what was enriched from full "history" (context).
- Refer to used history by role + brief description.
- Do not include message indices or verbatim long quotes.
- Do not mention any history that was not actually used.
- **CRITICAL: write the reasoning impersonally, in the past tense, describing what happened to the question - NEVER in the first person.** The reasoning is shown to end users as a processing step, so it must not read as the assistant narrating itself.
  - Do NOT use "I", "my", "we", or "our", nor their equivalents in whatever language you are replying in.
  - This applies to VERB FORMS too, not only pronouns: in languages that mark the first person on the verb (Spanish, Portuguese, Arabic, Hindi, French, etc.), use impersonal, passive, or third-person constructions instead - a first-person conjugation is just as wrong as writing "I".
  - Make the question, the pronoun, or the history the subject of the sentence, never the assistant.
  - Correct: "The last message names John, so the pronoun 'he' was resolved to John. No other history was needed."
  - Correct: "The question already names a specific event, so it was left unchanged."
  - INCORRECT: "I used the last message to resolve 'he' as John." (first person)
  - INCORRECT: "I did not need any other history." (first person)
  - INCORRECT: any sentence whose verb is conjugated in the first person, even when no pronoun is written out (still first person, still wrong)

---

## Input JSON

{{input_json}}

---
{{user_notes_section}}
### Additional Dos & Don'ts

- **Do** use "last_message" ONLY for pronoun resolution.
- **Do** use full "history" for context enrichment, constraints, and clarifications.
- **Do** minimize added context to only what is necessary to disambiguate.
- **Do** keep names, dates, and entities exactly as stated in the history.
- **Do NOT** introduce external knowledge or assumptions.
- **Do NOT** include instructions to the user; produce a direct, answerable question.
- **CRITICAL: Do NOT turn the rewrite into a clarification question aimed at the user** ("did you mean...", "are you asking about..."). The rewrite is sent to a search system, not to the user — an ambiguous reference is handled by keeping the pronoun or a generic descriptor, never by asking back.
- **CRITICAL: Do NOT turn a non-question message into a question about that message**. If "message" is a greeting, thanks, acknowledgment, or a bare word or phrase — in any language — never rewrite it as "What does X mean?" or similar. Return it unchanged; a later step handles non-questions.
- **CRITICAL: Never re-type the user's text — copy it exactly**. Whenever your rewrite keeps or quotes any part of the original message, reproduce it character-for-character. This applies especially to text in a script you are less familiar with: not understanding the text is MORE reason to copy it exactly, never a reason to transform it.
- **Do NOT** resolve pronouns using older history (only "last_message").
- **CRITICAL: Do NOT add dates (today's date, current date, etc.) unless the original question explicitly mentions a date or time reference**. If the question does not contain any temporal information, do not add any.
- **CRITICAL: NEVER substitute or replace a specific name/entity in the question with a different name/entity from history**. If the user asks about "Martin" and "Martin" does not appear in the history, keep "Martin" as-is. Do NOT replace it with another person's name just because that person appears in history. Only add context that SUPPLEMENTS the original question - never CHANGE the subject of the question.
- **CRITICAL: Do NOT invent specifics. Rephrasing and synonyms are allowed and expected — but every concrete entity or fact in your rewrite MUST literally appear in "message" or "history"**. Do not add a specific disease, person, organization, place, event, product, statistic, date, or number that was not already stated. In particular, NEVER narrow a general term into a specific named instance: if the conversation says "infectious diseases", "an outbreak", "the crisis", or "an attack", keep it general - do NOT turn it into "cholera" or "covid", a named group, or a specific incident. Reusing a synonym of a word already in the conversation is fine; introducing a more specific entity that was never mentioned is a hallucination.

---

### Example — Unknown Entity (DO NOT SUBSTITUTE)

**Scenario:**
```
history:
- user: "Tell me about the Python programming language"
- assistant: "Python was created by Guido van Rossum in 1991. It emphasizes code readability..."

message: "What books did James write?"
```

**Correct rewrite:** "What books did James write?" (unchanged)

**INCORRECT rewrite:** "What books did Guido van Rossum write?" ← THIS IS WRONG! James ≠ Guido

**Reasoning:** The user explicitly asked about "James". Even though "James" doesn't appear in the history and "Guido van Rossum" does, one person must never be substituted for another. The user knows who they're asking about, so the question was returned unchanged.

---

### Example — Pronoun Resolved to a Group (KEEP THE QUALIFIER)

**Scenario:**
```
history:
- user: "who is on the ballot in State A"
- assistant: "In State A, the ballot includes Candidate X for governor and Candidate Y for the Senate seat..."

message: "tell me about their platforms"
```

**Correct rewrite:** "Tell me about the platforms of the candidates on the ballot in State A"

**INCORRECT rewrite:** "Tell me about the candidates' platforms" ← drops State A, so the search matches candidates from any place.

**Reasoning:** "their" resolves to the candidates the last message lists. The last message defines them by the State A ballot, so that qualifier travels with the descriptor (Step 1 rule 4): the place is a constraint the question presupposes (Step 2 rule 3), not optional context.

---

### Example — Place-Dependent Question (CARRY THE USER'S PLACE)

**Scenario:**
```
history:
- user: "I vote in California, when is the registration deadline?"
- assistant: "In California, voters can register in person at their county elections office or polling place..."

message: "how can I skip the lines?"
```

**Correct rewrite:** "How can I skip the lines at a polling place in California?"

**INCORRECT rewrite:** "How can I skip the lines at a polling place?" ← early voting, mail voting and curbside rules differ by state, so without California the search returns another state's procedure.

**Reasoning:** "the lines" was resolved to lines at a polling place from the last message. How to avoid them is set per state, so the place the user established earlier ("I vote in California") is a constraint the question depends on (Step 2 rule 3) and was carried.

---

### Example — Handling Off-Topic Intermediate Responses

**Scenario:**
```
history:
- user: "How many companies is Egypt selling in the IPOs?"
- assistant: "Egypt is selling stakes in 11 state-owned companies in the upcoming IPOs, with plans to complete these sales by March 2026."
- user: "Why is the program slow?"
- assistant: "Internet disruptions and inflation have caused slowdowns across many sectors..." [OFF-TOPIC RESPONSE]

message: "I mean the IPOs program"
```

**Correct rewrite:** "Why is the IPOs program in Egypt slow?"

**Reasoning:** The user's clarification "I mean the IPOs program" indicates they are referring back to the IPO topic from earlier in the conversation. Even though the most recent assistant response was off-topic (about internet disruptions), the full history was searched to find that "the program" refers to the IPO program in Egypt mentioned in earlier turns. The original question intent ("Why is the program slow?") was combined with the clarification to produce a self-contained question.

**Incorrect behavior:** Returning "I mean the IPOs program" unchanged or failing to add "Egypt" context because the recent turns were off-topic.

---

### Example — New Topic (DO NOT ENRICH)

**Scenario:**
```
history:
- user: "What is the current state of the Egyptian economy?"
- assistant: "The Egyptian economy has been under pressure due to currency devaluation, with the pound reaching record lows against the dollar..."

message: "What are the latest developments on the Al-Amiriya workers' strike in Egypt?"
```

**Correct rewrite:** "What are the latest developments on the Al-Amiriya workers' strike in Egypt?" (unchanged)

**INCORRECT rewrite:** "What are the latest developments on the Al-Amiriya workers' strike in Egypt amid the Egyptian economic crisis?" (adding economic crisis context from history)

**Reasoning:** The user's question is about a specific workers' strike — a completely different topic from the previous question about the Egyptian economy. Even though both are about Egypt, the strike question is fully self-contained and introduces a new subject. Adding economic context would contaminate the query and bias retrieval toward economy articles rather than strike coverage.

---

### Example — Do NOT Invent a Specific Instance of a General Topic

History mentions only "infectious diseases" (no disease named); message: "What about Lebanon?"
- **Correct:** "What is the latest news about the situation in Lebanon?" (keep it general; synonyms are fine)
- **INCORRECT:** "What about the Ebola outbreak in Lebanon?" ← "Ebola" appears nowhere in the conversation. Never turn a general term ("infectious diseases") into a specific instance ("Ebola") that was not stated.

---

### Example — Non-Question Message (RETURN UNCHANGED)

History contains an earlier exchange; message: "こんにちは"
- **Correct:** "こんにちは" (unchanged, exact same characters)
- **INCORRECT:** "What does \"こんにちは\" mean?" ← the user sent a greeting, not a question about their own words. Never invent a question about the message.
- **INCORRECT:** returning the greeting re-typed with different or similar-looking characters. If you do not recognize the text, copy it exactly.
"""
        prompt = PromptTemplate.from_template(INSTRUCTIONS)

        parser: PydanticOutputParser[HistoryAwareQuestionRewriterOutput] = PydanticOutputParser(
            pydantic_object=HistoryAwareQuestionRewriterOutput
        )
        output_format = strict_format_instructions(parser)

        # notes are possibly untrusted user text, walled-off in tags
        chat_dict = chat.model_dump(exclude={"conversation_context"})
        history = chat.history or []
        # use last 3 turns for better context (helps when most recent turn is off-topic)
        recent_turns = history[-3:]
        if recent_turns:
            recent_context = []
            for msg in recent_turns:
                recent_context.append(f"{msg.role.value}: {msg.content}")
            chat_dict["last_message"] = "\n".join(recent_context)
        else:
            chat_dict["last_message"] = chat.message
        # keep ensure_ascii off: models re-type \uXXXX escapes into similar scripts (sinhala -> malayalam)
        input_json = json.dumps(chat_dict, ensure_ascii=False)

        logger.debug(f"Rewriter input: message={chat.message!r} history_len={len(history)}")

        llm_config = LLMConfig()
        model = create_chat_model(llm_config.llm_rewriter, llm_config)
        prompt_input = {
            "input_json": input_json,
            "output_format": output_format,
            "user_notes_section": self._user_notes_section(chat),
        }

        original_message = chat.message

        try:
            result = invoke_with_output_retry(
                prompt_input, prompt=prompt, model=model, parser=parser, component="Rewriter"
            )
            if not result.message:
                # An empty message is a malformed response, not a decision to leave the question alone:
                # rule 5 asks for the original back verbatim, so there is always something to return.
                # The reasoning is still worth showing, so keep it and search the original question.
                logger.info(f"Rewriter returned an empty message, keeping the original question: {result!r}")
                if metadata is not None:
                    metadata.reasoning = result.reasoning
                return chat

            logger.info(f"Rewritten question: {result!r}")
            chat.message = result.message
            chat.history = []  # Clear history after rewriting question
            if metadata is not None:
                metadata.reasoning = result.reasoning
                # Only report a rewrite when the question actually changed.
                # The flow renders rewritten_question under an "adjusted with context" header,
                # so a verbatim copy of the original tells the user about an edit that never happened.
                # Every consumer falls back to chat.message, which is identical whenever this is left unset.
                if result.message != original_message:
                    metadata.rewritten_question = result.message
        except BadRequestError as e:
            # marked before the diagnostics below, which build a prompt value and can raise on their own
            self._mark_failed(metadata)
            # is the request data attached to the response?
            failed_request_content = self._extract_failed_request_content(e)
            if failed_request_content is not None:
                logger.bind(**{TRUNCATE: True}).info(f"Rewriter failed request body: {failed_request_content}")
            else:
                # if not: set up the prompt/model manually and compute the request payload
                prompt_value = prompt.invoke(prompt_input)
                request_payload = self._extract_model_request_payload(model, prompt_value)
                if request_payload is not None:
                    logger.bind(**{TRUNCATE: True}).info(f"Rewriter model request payload: {request_payload}")
                else:
                    logger.bind(**{TRUNCATE: True}).info(f"Rewriter prompt text: {prompt_value.to_string()}")
            logger.opt(exception=sys.exc_info()).error(f"Failed to rewrite question: {e}")
        except Exception as e:
            self._mark_failed(metadata)
            logger.opt(exception=sys.exc_info()).error(f"Failed to rewrite question: {e}")

        return chat
