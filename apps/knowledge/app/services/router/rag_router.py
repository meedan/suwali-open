import asyncio
import itertools
import re
import sys
import time
from collections.abc import Callable, Sequence
from difflib import SequenceMatcher
from typing import Any, NamedTuple

from langchain_core.language_models import LanguageModelInput
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.runnables import Runnable
from loguru import logger

from app.core import errors
from app.core.config import Config
from app.core.constants import (
    ANSWER_TARGET_MAX_CHARS,
    CONVERSATION_CONTEXT_RESUME_WAIT_SECONDS,
    CONVERSATION_CONTEXT_WAIT_SECONDS,
    PLAIN_TEXT_ONLY_INSTRUCTION,
)
from app.core.context import pipeline_step
from app.core.llm_config import LLMConfig, create_chat_model
from app.core.logging import publish_metric
from app.models.chat import (
    AddContextNote,
    ChatRequest,
    ChatResponse,
    ContextNote,
    ContextUpdate,
    DurationKey,
    ErrorType,
    ExternalResource,
    Message,
    Metadata,
    PersonalizationSettings,
    RemoveContextNote,
    Role,
    ScenarioType,
)
from app.services import directive_gate, language
from app.services.answer_judge import AnswerJudge
from app.services.context_extractor import ContextExtraction, ConversationContextExtractor, note_place_parts
from app.services.language import CHAT_MESSAGE_PREVIEW, LANGUAGE_NAMES
from app.services.neo4j_timing import neo4j_stage
from app.services.personalization import (
    NEUTRAL_VOICE_INSTRUCTION,
    NO_NAME_INSTRUCTION,
    prompt_without_resources,
    resources_for_scenario,
)
from app.services.personalization import (
    prompt as personalization_prompt,
)
from app.services.retriever import Retriever, extract_and_reconcile_cited_ids
from app.services.rewriter import HistoryAwareQuestionRewriter, Rewriter
from app.services.router.aggregator import ResultAggregator
from app.services.router.classifier import QueryClassifier
from app.services.router.classifier_decomposer import UnifiedClassifierDecomposer
from app.services.router.decomposer import QueryDecomposer
from app.services.router.handler import KnowledgeHandler
from app.services.router.internal_handler import InternalKBHandler
from app.services.router.models import (
    ClassificationResult,
    DecompositionResult,
    HandlerResult,
    KnowledgeSource,
    QueryContext,
    QueryIntent,
    SubQuery,
    SynthesisType,
    TemporalContext,
    TemporalType,
)
from app.services.router.prompts import SCENARIO_REPLY_RESOURCE_GROUNDING
from app.services.router.question_type import (
    classification_metadata_fields,
    ensure_classification_metadata,
    rewriter_metadata_fields,
)
from app.services.router.sub_query_executor import SubQueryExecutor
from app.services.router.synthesizer import NO_ANSWER_SYNTHESIS_STATUSES, ResponseSynthesizer
from app.services.router.yago_handler import YAGOHandler
from app.services.summarizer import Summarizer
from app.services.topic_extractor import TopicExtractor

# same confidence as the llm detector: the classifier's language verdict is equally trusted
CLASSIFIER_LANGUAGE_CONFIDENCE = 0.95

# a reply this short and this close to the noted place is a repeat of it; below 4 chars every abbreviation matches.
# one wrong letter in a five-letter name scores 0.8 and is often a real word ("parks" for Paris), so short names
# are left to the extractor
_PLACE_REPLY_MAX_WORDS = 4
_PLACE_REPLY_MIN_CHARS = 4
_PLACE_REPLY_MIN_SIMILARITY = 0.85
# a reply longer than this is not a bare abbreviation, so it never waits for the extractor to be asked about one
_CONFIRM_PLACE_MAX_WORDS = 2


def _classifier_language(chat: ChatRequest, classification: ClassificationResult, lang: str | None) -> str | None:
    """Classifier-corrected message language, or None to keep the provisional detection.

    catches cases where the dedicated detector and the classifier disagree
    (proper nouns pulling a message into another language)
    """
    corrected = classification.message_language
    if not corrected or corrected == lang:
        return None
    supported = chat.personalization.supported_languages if chat.personalization else None
    if supported and corrected not in supported:
        # must not force the answer into a language the hub refuses to serve,
        # preflight already decided this message is not refused
        return None
    return corrected


def _reply_language(chat: ChatRequest, lang: str | None) -> str | None:
    """Language for lightweight LLM replies (greetings, role descriptions, scenarios).

    detection returns None for token-less messages like "." on a first turn;
    without a fallback the english system prompt makes the llm reply in english,
    so use the hub's default language, mirroring the retriever's answer path
    """
    if lang:
        return lang
    return chat.personalization.default_language if chat.personalization else None


def _scenario_persona(
    personalization: PersonalizationSettings | None,
    resources: list[ExternalResource],
) -> tuple[str, PersonalizationSettings | None]:
    """System persona prompt for a scenario reply, plus the personalization it rendered.

    The returned personalization carries only the scenario's resources. Pass it to the
    directive gate so the judge sees exactly the profile text the generator saw.
    """
    if not personalization:
        return "You are a helpful assistant. " + NO_NAME_INSTRUCTION + "\n\n" + NEUTRAL_VOICE_INSTRUCTION, None
    filtered = personalization.model_copy(update={"external_resources": resources})
    return personalization_prompt(filtered), filtered


async def _backfill_language(metadata: Metadata, answer: str, chat: ChatRequest) -> None:
    """Fill metadata.language from the answer only when it was not detected in the question.

    Never records a language outside the hub's supported set: an out-of-set
    answer is an llm mistake and must not propagate to the cms.
    """
    if metadata.language is not None:
        return

    answer_lang, _ = await language.detect_text(answer)
    if not answer_lang:
        return

    supported = chat.personalization.supported_languages if chat.personalization else None
    if supported and answer_lang not in supported:
        logger.warning(
            f"Answer language {answer_lang} is not in the hub's supported languages {supported}; "
            f"leaving metadata language unset"
        )
        return

    metadata.language = answer_lang
    logger.debug(f"Backfilled language from answer: {answer_lang}")


def _fallback_metadata(metadata: Metadata) -> Metadata:
    """Strip document- and retrieval-level evidence from metadata for a
    NO_ANSWER_AVAILABLE fallback response.

    The router reaches these fallbacks when a pipeline produced no usable
    answer; any retrieved documents didn't support it, so we must not
    advertise them in the response metadata.

    answerable stays true here: it means "genuine question for the knowledge base", not "we produced an answer".
    the cms derives answered from answerable plus error_type, and the unanswered questions ranking depends on it.
    """
    return metadata.model_copy(
        update={
            "answerable": True,
            "documents_count": None,
            "document_ids_used": None,
            "document_ids_cited": None,
            "retrieved_chunks": None,
            "entities": None,
        }
    )


def _error_metadata(metadata: Metadata) -> Metadata:
    """Strip retrieval evidence for a response that failed before it could produce an answer.

    unlike _fallback_metadata this leaves answerable unset.
    the pipeline never judged whether the corpus covers the question, so the cms must not count this as unanswered.
    an outage is not a content gap.
    """
    return metadata.model_copy(
        update={
            "answerable": None,
            "documents_count": None,
            "document_ids_used": None,
            "document_ids_cited": None,
            "retrieved_chunks": None,
            "entities": None,
        }
    )


def _user_location_missing(chat: ChatRequest, classification: ClassificationResult) -> bool:
    """The answer needs the user's location and the conversation has none to offer.

    The gate is a hub feature (location_gate_enabled, sent by the cms like recency_first_enabled): off, a
    location-dependent question is searched as written, with whatever notes the rewriter could fold in.
    On, it is refused until a note exists. The only note kept is the user's location
    (CONVERSATION_CONTEXT_MAX_NOTES), so any note is a location, and the rewriter has already folded it
    into the question.
    """
    return bool(chat.location_gate_enabled) and not chat.conversation_context and classification.needs_user_location


def _pending_location_question(chat: ChatRequest) -> tuple[str, list[Message]] | None:
    """The user question most recently refused for lack of a location, with the history before it.

    The cms marks the refusal on the assistant turn it stores (user_location_missing), since the refusal
    text itself is model-written and cannot be recognized. The refusal need not be the last turn: the user
    may have tried another question before answering where they are, and other assistant turns may sit
    between a question and its refusal (the welcome message is created alongside the first user message).
    The history the cms sends is a short window, so the search cannot reach back far.
    """
    history = chat.history or []
    refusals = [i for i, turn in enumerate(history) if turn.role == Role.ASSISTANT and turn.user_location_missing]
    if not refusals:
        return None
    for i in range(refusals[-1] - 1, -1, -1):
        if history[i].role == Role.USER:
            return history[i].content, history[:i]
    return None


def _refusal_is_latest_assistant_turn(chat: ChatRequest) -> bool:
    """True when nothing has been answered since the last location refusal: the user is replying to it."""
    for turn in reversed(chat.history or []):
        if turn.role == Role.ASSISTANT:
            return bool(turn.user_location_missing)
    return False


def _places_without_note_containers(places: list[str], notes: list[ContextNote] | None) -> list[str]:
    """Drop the regions and country a note lists around the user's place when that place was extracted.

    The rewriter carries the note wording into the question ("in Georgia, United States"), so the country
    reaches the place boost and lifts every chunk that names it. The note format is the contract: the place,
    then the areas that contain it, comma-separated, smallest first. Only the parts around a place that was
    itself extracted are dropped, so a question about the country alone keeps it.
    """
    if not places or not notes:
        return places
    lowered = [place.casefold() for place in places if place.strip()]
    containers: set[str] = set()
    for note in notes:
        parts = [part.casefold() for part in note_place_parts(note.text)]
        if len(parts) < 2:
            continue
        # the first part carries a verb phrase ("Lives in Austin"), so the place is searched in it on word boundaries
        # the most specific part that was extracted decides what follows it is a container
        for index, part in enumerate(parts):
            if index == 0:
                matched = {place for place in lowered if re.search(rf"(?<!\w){re.escape(place)}(?!\w)", part)}
            else:
                matched = {place for place in lowered if place == part}
            if matched:
                containers.update(later for later in parts[index + 1 :] if later not in matched)
                break
    return [place for place in places if place.casefold() not in containers]


def _boost_places(question_places: list[str], note_places: list[str], notes: list[ContextNote] | None) -> list[str]:
    """Places for the retrieval boost: the question's own, or the note's when the question names none.

    The rewriter keeps the location out of a question that names its subject ("What is State Question 847?"),
    so the note's place rides along here as a tie-breaker among same-named measures from different places.
    A boost, never a constraint: when only another place's measure exists nothing is lifted, and that answer
    comes through with no asked place for the judge to hold against it. A question that names a place keeps
    only its own, so the note never redirects "what about Texas?".
    """
    places = [p for p in question_places if p.strip()] or [p for p in note_places if p.strip()]
    return _places_without_note_containers(places, notes)


def _notes_after_updates(notes: list[ContextNote], updates: list[ContextUpdate]) -> list[ContextNote]:
    """The notes as the cms will store them once it applies the updates; added notes get placeholder ids."""
    removed = {update.id for update in updates if isinstance(update, RemoveContextNote)}
    kept = [note for note in notes if note.id not in removed]
    added = [update.text for update in updates if isinstance(update, AddContextNote)]
    return kept + [ContextNote(id=f"pending-{i}", text=text) for i, text in enumerate(added)]


def _repeats_note_place(message: str, notes: list[ContextNote] | None) -> bool:
    """A short reply that repeats the place the note holds, typos included.

    The extractor has missed misspelled repeats of the noted place, which then got searched as a question.
    Only capitalized words after the note's first are candidates, so the verb phrase ("Lives in") never matches.
    A script without capitals has no candidates and leaves the reply to the extractor.
    """
    words = re.findall(r"\w+", message.casefold())
    if not notes or "?" in message or not 1 <= len(words) <= _PLACE_REPLY_MAX_WORDS:
        return False
    reply = " ".join(words)
    if len(reply) < _PLACE_REPLY_MIN_CHARS:
        return False
    for note in notes:
        note_words = re.findall(r"\w+", note.text)
        for start in range(1, len(note_words) - len(words) + 1):
            if not note_words[start][0].isupper():
                continue
            window = " ".join(note_words[start : start + len(words)]).casefold()
            if SequenceMatcher(None, reply, window).ratio() >= _PLACE_REPLY_MIN_SIMILARITY:
                return True
    return False


def _handler_error(result: HandlerResult | None) -> tuple[ErrorType, str | None] | None:
    """The handler's own failure, when it is something other than an empty corpus.

    NO_ANSWER_AVAILABLE is excluded: the router's own fallback already covers it with the right resources.
    a handler that raised carries no error_type, so it reports as INTERNAL_ERROR and the caller builds the message.
    """
    if result is None or result.success:
        return None
    if result.error_type is None:
        return (ErrorType.INTERNAL_ERROR, None) if result.error else None
    if result.error_type == ErrorType.NO_ANSWER_AVAILABLE:
        return None
    return result.error_type, result.error_message


class _ScenarioHandling(NamedTuple):
    scenario: ScenarioType
    instruction: str
    fallback: str


class _PreflightResult(NamedTuple):
    early_response: ChatResponse | None  # short-circuit response, or None to continue routing
    lang: str | None
    lang_confidence: float


class _RewriteResult(NamedTuple):
    chat: ChatRequest  # rewritten chat
    metadata: Metadata
    lang: str | None
    lang_confidence: float
    duration_details: dict[str, float]
    classification: ClassificationResult | None
    unified_decomposition_result: DecompositionResult | None


class RAGRouter:
    """
    Enrichment pipeline: run enrichers then pass facts to InternalKB.
    """

    MAX_ENRICHMENT_FACTS = 10
    SOURCE_DECOMPOSITION = "decomposition"
    SOURCE_ENRICHMENT_FALLBACK = "enrichment_fallback"

    def __init__(
        self, hub_id: int, status_callback: "Callable[[str, dict[str, Any] | None], None] | None" = None
    ) -> None:
        self.hub_id = hub_id
        self.status_callback = status_callback
        # resolved by preflight with the current message's language, so context extraction can reuse
        # that detection (an LLM call) instead of repeating it
        self._message_language: asyncio.Future[str | None] | None = None
        # the current message's detection, kept so the resume step and preflight don't both pay for it
        self._current_detection: tuple[str, tuple[str, float] | None] | None = None
        # this turn's context extraction, so the location gate can wait for a note the message itself produced
        self._context_task: asyncio.Task[ContextExtraction] | None = None
        # set while routing a resumed question: if it asks nothing, the location reply is acknowledged
        self._location_resumed = False
        self.config = Config()
        self.llm_config = LLMConfig()

        self.classifier = QueryClassifier()
        self.unified_classifier_decomposer: UnifiedClassifierDecomposer | None = None
        if self.config.router_unified_classifier_decomposer:
            self.unified_classifier_decomposer = UnifiedClassifierDecomposer()
            logger.debug("UnifiedClassifierDecomposer enabled")
        self.internal_handler: InternalKBHandler | None = None
        self.enrichers: list[KnowledgeHandler] = []

        if self.config.router_enable_internal_kb:
            self.internal_handler = InternalKBHandler()
            logger.debug("InternalKBHandler enabled")

        if self.config.router_enable_yago:
            self.enrichers.append(YAGOHandler())
            logger.debug("YAGOHandler (enricher) enabled")

        parallel = self.config.router_parallel_execution
        self.enricher_aggregator = ResultAggregator(self.enrichers, parallel=parallel)

    def _notify(self, status: str, payload: dict[str, Any] | None = None) -> None:
        if self.status_callback:
            try:
                self.status_callback(status, payload)
            except Exception as e:
                logger.warning(f"Status callback failed for '{status}': {e}")

    @staticmethod
    def _ensure_classification_metadata(response: ChatResponse) -> ChatResponse:
        response.metadata = ensure_classification_metadata(response.metadata, error_type=response.error_type)
        return response

    async def route(self, chat: ChatRequest) -> ChatResponse:
        # try to extract context before preflight so non-questions are included
        context_task: asyncio.Task[ContextExtraction] | None = None
        if chat.conversation_context is not None:
            self._message_language = asyncio.get_running_loop().create_future()
            context_task = asyncio.create_task(
                self._extract_context(
                    chat.message,
                    list(chat.history or []),
                    list(chat.conversation_context),
                    self._message_language,
                )
            )

        self._context_task = context_task
        resumed_chat: ChatRequest | None = None
        try:
            if context_task is not None:
                resumed_chat = await self._resume_refused_question(chat, context_task)
            if resumed_chat is not None:
                # the extraction describes the bare reply, not the question being resumed
                self._context_task = None
                self._location_resumed = True
                response = await self._route(resumed_chat)
            else:
                response = await self._route(chat)
        except BaseException:
            if context_task is not None:
                context_task.cancel()
            raise
        finally:
            self._resolve_message_language(None)
            self._context_task = None
            self._location_resumed = False

        if context_task is not None:
            try:
                extraction = await asyncio.wait_for(context_task, timeout=CONVERSATION_CONTEXT_WAIT_SECONDS)
                response.context_updates = extraction.updates
            except TimeoutError:
                logger.opt(exception=sys.exc_info()).warning(
                    "Conversation context extraction timed out, returning no updates"
                )
        if resumed_chat is not None:
            if response.metadata is None:
                response.metadata = Metadata()
            response.metadata.location_question_resumed = True
        return response

    async def _resume_refused_question(
        self, chat: ChatRequest, context_task: asyncio.Task[ContextExtraction]
    ) -> ChatRequest | None:
        """The question the previous turn refused, ready to run now that the user has said where they are.

        A bare reply to the refusal ("Zagreb") must not be routed on its own: the classifier is unreliable
        on a bare token (small talk one time, an encyclopedia question the next), the rewriter leaves bare
        words alone by design, and the extractor is the only step that understands it. So once the history
        ends with a refusal, the router waits for the extractor instead of racing it: a reply that adds a
        location and says nothing else becomes the refused question with the new note, exactly as the next
        turn would see it. A reply that asks something of its own is routed as written.
        Once a later turn has answered, a note means the refusal was resolved: a new location ("I'm in Split
        now") only updates the note, and the turn is not held up waiting for the extractor. A refusal that is
        still the latest assistant turn is resumed even with a note stored: the refused question can name the
        place itself, and when the gate runs before the extractor finishes, that same turn refuses the question
        and stores the note. The bare reply that follows is still an answer to the refusal.
        """
        pending = _pending_location_question(chat)
        if pending is None:
            return None
        if chat.conversation_context and not _refusal_is_latest_assistant_turn(chat):
            return None

        # the extractor waits for the message language that preflight resolves; the bare reply skips preflight
        current = await self._detect_current_message(chat)
        self._resolve_message_language(current[0] if current else None)
        try:
            extraction = await asyncio.wait_for(
                asyncio.shield(context_task), timeout=CONVERSATION_CONTEXT_RESUME_WAIT_SECONDS
            )
        except TimeoutError:
            logger.opt(exception=sys.exc_info()).warning(
                "Conversation context extraction too slow to resume the refused question"
            )
            return None
        updates = extraction.updates
        added = any(isinstance(update, AddContextNote) for update in updates)
        location_only = extraction.location_only or _repeats_note_place(chat.message, chat.conversation_context)
        # a reply repeating a location the note already holds adds nothing, and still answers the refusal
        if not location_only or not (added or chat.conversation_context):
            return None

        question, history_before = pending
        logger.info("Location received for a refused question, resuming it with the new note")
        return chat.model_copy(
            update={
                "message": question,
                "history": history_before,
                "conversation_context": _notes_after_updates(chat.conversation_context or [], updates),
            }
        )

    async def _place_to_confirm(self, chat: ChatRequest) -> str | None:
        """The place a short reply may abbreviate, when it reads just as well as an everyday word.

        Guessing either way loses: an acknowledgment taken as a place answers the wrong place's question.
        A place taken as an acknowledgment drops the question, and the user never learns why.
        The extractor only names a place when the previous turn asked where the user is, so this needs no
        refusal flag: the hub's own welcome asks the same question without one. A conversation that already
        holds a location has nothing to confirm, and a reply of more than a word or two is not an abbreviation,
        so neither waits for the extractor.
        """
        if self._context_task is None or chat.conversation_context:
            return None
        if len(chat.message.split()) > _CONFIRM_PLACE_MAX_WORDS:
            return None
        try:
            extraction = await asyncio.wait_for(
                asyncio.shield(self._context_task), timeout=CONVERSATION_CONTEXT_WAIT_SECONDS
            )
        except TimeoutError:
            logger.opt(exception=sys.exc_info()).warning(
                "Conversation context extraction too slow to tell an abbreviation from a word, routing the reply"
            )
            return None
        return extraction.possible_place

    async def _place_turn_language(self, chat: ChatRequest, lang: str | None) -> str | None:
        """Reply language for a turn that only names a place, taken from the conversation rather than the word.

        A bare place or its abbreviation is no evidence of a language: "il" reads as Italian to the detector,
        and the Illinois confirmation came back in Italian. The hub default fills in through _reply_language
        when the history holds nothing classifiable. A longer message is written in some language and keeps it.
        """
        if len(chat.message.split()) > _CONFIRM_PLACE_MAX_WORDS:
            return lang
        history_lang, _ = await language.detect_from_history(chat)
        if history_lang != lang:
            logger.info(
                f"Place turn {chat.message!r} is no language evidence, replying in {history_lang!r} not {lang!r}"
            )
        return history_lang

    async def _confirm_place(
        self, chat: ChatRequest, place: str, lang: str | None, start_time: float, duration_details: dict[str, float]
    ) -> ChatResponse:
        """Ask whether the reply meant the place, without storing it; a "yes" next turn records it and resumes."""
        logger.info(f"Reply to a location request may abbreviate {place!r}, asking the user to confirm")
        lang = await self._place_turn_language(chat, lang)
        answer = await self._generate_conversational_reply(chat, lang, confirm_place=place)

        final_metadata = Metadata(
            retriever_detected_lang=lang,
            language=_reply_language(chat, lang),
            duration_details=duration_details or None,
            **classification_metadata_fields(intent=QueryIntent.NON_QUESTION),
        )
        logger.info(f"RAGRouter completed (place confirmation) in {time.perf_counter() - start_time:.2f}s")

        await _backfill_language(final_metadata, answer, chat)
        return ChatResponse(answer=answer, metadata=final_metadata)

    async def _chat_located_by_this_turn(self, chat: ChatRequest) -> ChatRequest | None:
        """The question with the location note its own message produced, for a gate about to refuse it.

        The gate sees only notes stored by earlier turns. A question that names the user's place ("I live in
        Zagreb, where can I...") produces its note on this very turn, in the extractor running alongside, so refusing
        it asks for what the user just said and loses the question when they repeat the place. The extractor
        started before preflight and is usually done by the time the gate runs, so the wait is short; a slow
        extraction falls back to the refusal, and the resume step picks the question up on the reply.
        """
        if self._context_task is None:
            return None
        try:
            extraction = await asyncio.wait_for(
                asyncio.shield(self._context_task), timeout=CONVERSATION_CONTEXT_WAIT_SECONDS
            )
        except TimeoutError:
            logger.opt(exception=sys.exc_info()).warning(
                "Conversation context extraction too slow for the location gate, refusing the question"
            )
            return None
        if not any(isinstance(update, AddContextNote) for update in extraction.updates):
            return None
        return chat.model_copy(
            update={"conversation_context": _notes_after_updates(chat.conversation_context or [], extraction.updates)}
        )

    async def _bare_location_turn(self, chat: ChatRequest, classification: ClassificationResult) -> ChatRequest | None:
        """The turn with its notes after this message, when it only says where the user is and nothing is resumed.

        The welcome message, or a hub's own prompt, asks for the user's state without a refusal being stored,
        so the resume step finds nothing to go back to and the bare reply reaches the classifier, which calls
        it a question often enough that retrieval then answers whatever the corpus says about the place, and
        small talk the rest of the time, where the generic reply asks what the user wants to know about the
        place as if it were a topic. Either way the reply is an acknowledgment of where the user is.
        The extractor reads the reply against the notes, and it started before preflight, so by
        now it is usually done and the wait is short; a slow extraction lets the turn through as before.
        A reply that repeats a place the note already holds is still only a location, not a question.
        The extractor alone is not enough: it has called "I'm in Zagreb and don't know how to vote" location-only.
        So a turn the classifier calls a question must be location-only to the classifier too.
        A short repeat of the noted place, typos included, needs neither verdict: both have missed misspelled ones.
        """
        if classification.intent not in (QueryIntent.QUESTION, QueryIntent.NON_QUESTION):
            return None
        repeats_note = _repeats_note_place(chat.message, chat.conversation_context)
        if classification.intent == QueryIntent.QUESTION and not (classification.location_only or repeats_note):
            return None
        if self._context_task is None or chat.conversation_context is None:
            return None
        try:
            extraction = await asyncio.wait_for(
                asyncio.shield(self._context_task), timeout=CONVERSATION_CONTEXT_WAIT_SECONDS
            )
        except TimeoutError:
            logger.opt(exception=sys.exc_info()).warning(
                "Conversation context extraction too slow to recognize a bare location, routing the reply as written"
            )
            return None
        if not (extraction.location_only or repeats_note):
            return None
        notes = _notes_after_updates(chat.conversation_context, extraction.updates)
        return chat.model_copy(update={"conversation_context": notes}) if notes else None

    async def _detect_current_message(self, chat: ChatRequest) -> tuple[str, float] | None:
        """The llm language verdict on chat.message, detected once per message for this request."""
        if self._current_detection is None or self._current_detection[0] != chat.message:
            detected = await language.detect_message(chat.message, language.detection_context(chat))
            self._current_detection = (chat.message, detected)
        return self._current_detection[1]

    def _resolve_message_language(self, language: str | None) -> None:
        if self._message_language is not None and not self._message_language.done():
            self._message_language.set_result(language)

    async def _extract_context(
        self,
        message: str,
        history: list[Message],
        notes: list[ContextNote],
        message_language: asyncio.Future[str | None],
    ) -> ContextExtraction:
        try:
            content_language = await message_language
            return await ConversationContextExtractor(llm_config=self.llm_config).extract(
                message, history, notes, content_language=content_language
            )
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(
                f"Conversation context extraction failed, returning no updates: {e}"
            )
            return ContextExtraction()

    async def _route(self, chat: ChatRequest) -> ChatResponse:
        start_time = time.perf_counter()
        duration_details: dict[str, float] = {}
        try:
            pre = await self._preflight(chat, start_time, duration_details)
            if pre.early_response is not None:
                return self._ensure_classification_metadata(pre.early_response)
            rewrite = await self._rewrite(chat, pre.lang, pre.lang_confidence, duration_details)
        except Exception as e:
            return self._ensure_classification_metadata(await self._internal_error_response(chat, e))

        query_text = rewrite.metadata.rewritten_question or chat.message
        async with asyncio.TaskGroup() as tg:
            answer_task = tg.create_task(self._answer(chat, rewrite, start_time))
            topics_task = tg.create_task(
                self._extract_topics(query_text, chat.existing_topics, content_language=pre.lang)
            )

        response = answer_task.result()
        if self._should_extract_topics(response) and not response.topics:
            response.topics = topics_task.result()
        return self._ensure_classification_metadata(response)

    async def _extract_topics(
        self,
        query: str,
        existing_topics: list[str],
        *,
        content_language: str | None = None,
    ) -> list[str]:
        if not self.config.topic_extraction_enabled:
            return []
        try:
            return await TopicExtractor(config=self.config, llm_config=self.llm_config).extract(
                query,
                existing_topics,
                content_language=content_language,
            )
        except Exception as e:
            logger.warning(f"Topic extraction failed, returning no topics: {e}")
            return []

    async def _extract_subquery_topics(
        self,
        sub_queries: list[SubQuery],
        existing_topics: list[str],
        *,
        content_language: str | None = None,
    ) -> list[str]:
        if not self.config.topic_extraction_enabled or not sub_queries:
            return []
        per_query = await asyncio.gather(
            *(self._extract_topics(sq.query, existing_topics, content_language=content_language) for sq in sub_queries)
        )
        return self._merge_subquery_topics(per_query, self.config.topic_extraction_max_count)

    @staticmethod
    def _merge_subquery_topics(per_query: Sequence[list[str]], limit: int) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()
        for row in itertools.zip_longest(*per_query):
            for topic in row:
                if topic is None:
                    continue
                name = topic.strip()
                key = name.lower()
                if key and key not in seen:
                    seen.add(key)
                    merged.append(name)
        return merged[:limit]

    @staticmethod
    def _should_extract_topics(response: ChatResponse) -> bool:
        metadata, error_type = response.metadata, response.error_type
        if metadata is None or metadata.router_intent not in (QueryIntent.QUESTION.value, QueryIntent.SYNTHESIS.value):
            return False
        if error_type is not None and error_type != ErrorType.NO_ANSWER_AVAILABLE:
            return False
        return True

    async def _internal_error_response(self, chat: ChatRequest, e: Exception) -> ChatResponse:
        logger.opt(exception=sys.exc_info()).error(f"RAGRouter error: {e}")
        lang, _ = await language.detect(chat)
        error_type = ErrorType.INTERNAL_ERROR
        error_resources = resources_for_scenario(chat.personalization, "error_occurred") or None
        msg = errors.get_error_message(error_type, _reply_language(chat, lang), external_resources=error_resources)
        return ChatResponse(
            error_type=error_type,
            answer=msg,
            metadata=Metadata(
                retriever_detected_lang=lang,
                language=lang,
                **classification_metadata_fields(error_type=error_type),
            ),
        )

    async def _preflight(
        self, chat: ChatRequest, start_time: float, duration_details: dict[str, float]
    ) -> _PreflightResult:
        logger.info(f"RAGRouter processing message for hub {chat.hub_id}, message_id {chat.message_id}")

        t = time.perf_counter()
        with pipeline_step(DurationKey.LANGUAGE_DETECTION):
            # this verdict can refuse the user outright, so it gets the tie-break context
            current = await self._detect_current_message(chat)
            if current:
                lang, lang_confidence = current
            else:
                lang, lang_confidence = None, 0.0

            # refuse only on a current-message verdict; history-only codes are too weak
            unsupported_response = await self._check_unsupported_language(chat, lang, start_time, duration_details)
            if unsupported_response:
                self._resolve_message_language(lang)
                duration_details[DurationKey.LANGUAGE_DETECTION] = (time.perf_counter() - t) * 1000
                return _PreflightResult(unsupported_response, lang, lang_confidence)

            if lang is None:
                lang, lang_confidence = await language.detect_from_history(chat)
            self._resolve_message_language(lang)

        duration_details[DurationKey.LANGUAGE_DETECTION] = (time.perf_counter() - t) * 1000

        supported = chat.personalization.supported_languages if chat.personalization else None
        if supported and lang and lang not in supported:
            logger.info(
                f"Language '{lang}' is outside hub supported languages {supported} but came "
                f"from history, not the current message; clearing lang to use hub default"
            )
            lang = None
            lang_confidence = 0.0

        if self.classifier.is_non_question(chat.message):
            if self._location_resumed:
                logger.info("Resumed message asks nothing, acknowledging the location instead")
                response = await self._handle_non_question(chat, lang, start_time, duration_details, located=True)
                return _PreflightResult(response, lang, lang_confidence)
            # "ok" is an acknowledgment to the regex and a region's abbreviation to the extractor
            place = await self._place_to_confirm(chat)
            if place is not None:
                response = await self._confirm_place(chat, place, lang, start_time, duration_details)
                return _PreflightResult(response, lang, lang_confidence)
            logger.info("Non-question detected early, generating conversational reply")
            response = await self._handle_non_question(chat, lang, start_time, duration_details)
            return _PreflightResult(response, lang, lang_confidence)

        error_type = errors.validate_chat_message(chat.message)
        if error_type is not None:
            msg = errors.get_error_message(error_type, _reply_language(chat, lang))
            response = ChatResponse(
                error_type=error_type,
                answer=msg,
                metadata=Metadata(
                    retriever_detected_lang=lang,
                    language=lang,
                    **classification_metadata_fields(error_type=error_type),
                ),
            )
            return _PreflightResult(response, lang, lang_confidence)

        scenario_intent = self.classifier.detect_scenario_intent(chat.message)
        if scenario_intent is not None:
            scenario_response = await self._try_handle_scenario_intent(
                chat, scenario_intent, lang, start_time, duration_details
            )
            if scenario_response is not None:
                return _PreflightResult(scenario_response, lang, lang_confidence)

        return _PreflightResult(None, lang, lang_confidence)

    async def _rewrite(
        self,
        chat: ChatRequest,
        lang: str | None,
        lang_confidence: float,
        duration_details: dict[str, float],
    ) -> _RewriteResult:
        metadata = Metadata(retriever_detected_lang=lang, language=lang)

        pipeline: list[Rewriter] = [HistoryAwareQuestionRewriter(handle_dates=True)]

        classification: ClassificationResult | None = None
        unified_decomposition_result: DecompositionResult | None = None

        # when the rewriter will run (history or conversation-context notes) and unified classifier is enabled,
        # run rewriting and classification concurrently
        # the classifier can work from the original query + history context
        if (chat.history or chat.conversation_context) and self.unified_classifier_decomposer is not None:
            classifier_decomposer = self.unified_classifier_decomposer
            original_message = chat.message
            original_history = chat.history

            async def _rewrite_step() -> ChatRequest:
                t = time.perf_counter()
                with pipeline_step(DurationKey.REWRITING):
                    result = await asyncio.to_thread(Rewriter.apply, chat, pipeline, metadata)
                duration_details[DurationKey.REWRITING] = (time.perf_counter() - t) * 1000
                return result

            async def _classify() -> tuple[ClassificationResult, DecompositionResult]:
                t = time.perf_counter()
                ctx = QueryContext(
                    hub_id=chat.hub_id,
                    message_id=chat.message_id,
                    original_query=original_message,
                    detected_language=lang,
                    language_confidence=lang_confidence,
                    history=original_history,
                    personalization=chat.personalization,
                    conversation_context=chat.conversation_context,
                    recency_first_enabled=chat.recency_first_enabled,
                    location_gate_enabled=chat.location_gate_enabled,
                )
                with pipeline_step(DurationKey.UNIFIED_CLASSIFICATION_DECOMPOSITION):
                    result = await classifier_decomposer.analyze(original_message, ctx)
                duration_details[DurationKey.UNIFIED_CLASSIFICATION_DECOMPOSITION] = (time.perf_counter() - t) * 1000
                return result

            rewritten_chat, (classification, unified_decomposition_result) = await asyncio.gather(
                _rewrite_step(), _classify()
            )
        else:
            t = time.perf_counter()
            with pipeline_step(DurationKey.REWRITING):
                rewritten_chat = await asyncio.to_thread(Rewriter.apply, chat, pipeline, metadata)
            duration_details[DurationKey.REWRITING] = (time.perf_counter() - t) * 1000

        return _RewriteResult(
            chat=rewritten_chat,
            metadata=metadata,
            lang=lang,
            lang_confidence=lang_confidence,
            duration_details=duration_details,
            classification=classification,
            unified_decomposition_result=unified_decomposition_result,
        )

    async def _answer(self, chat: ChatRequest, rewrite: _RewriteResult, start_time: float) -> ChatResponse:
        try:
            lang = rewrite.lang
            lang_confidence = rewrite.lang_confidence
            metadata = rewrite.metadata
            rewritten_chat = rewrite.chat
            duration_details = rewrite.duration_details
            classification: ClassificationResult | None = rewrite.classification
            unified_decomposition_result: DecompositionResult | None = rewrite.unified_decomposition_result

            self._notify("parsing_question", {"language": lang} if lang else None)
            publish_metric(
                "question.rewritten", duration_details[DurationKey.REWRITING], unit="Milliseconds", hub_id=chat.hub_id
            )

            context = QueryContext(
                hub_id=chat.hub_id,
                message_id=chat.message_id,
                original_query=chat.message,
                rewritten_query=metadata.rewritten_question,
                detected_language=lang,
                language_confidence=lang_confidence,
                history=chat.history,
                personalization=chat.personalization,
                conversation_context=chat.conversation_context,
                recency_first_enabled=chat.recency_first_enabled,
                location_gate_enabled=chat.location_gate_enabled,
            )

            use_llm = self.config.router_use_llm_classifier

            # classification already done in the parallel path above
            if classification is None:
                if self.unified_classifier_decomposer is not None:
                    t = time.perf_counter()
                    with pipeline_step(DurationKey.UNIFIED_CLASSIFICATION_DECOMPOSITION):
                        classification, unified_decomposition_result = await self.unified_classifier_decomposer.analyze(
                            rewritten_chat.message,
                            context,
                        )
                    duration_details[DurationKey.UNIFIED_CLASSIFICATION_DECOMPOSITION] = (
                        time.perf_counter() - t
                    ) * 1000
                else:
                    t = time.perf_counter()
                    with pipeline_step(DurationKey.CLASSIFICATION):
                        classification = await self.classifier.classify(
                            rewritten_chat.message,
                            context,
                            use_llm_fallback=use_llm,
                        )
                    duration_details[DurationKey.CLASSIFICATION] = (time.perf_counter() - t) * 1000

            logger.info(
                f"Query classified: intent={classification.intent.value}, "
                f"routes={[r.source.value for r in classification.routes]}, used_llm={classification.used_llm}, "
                f"temporal={classification.temporal.type.value}, reasoning={classification.reasoning!r}"
            )

            corrected_lang = _classifier_language(chat, classification, lang)
            if corrected_lang:
                logger.info(
                    f"Language corrected by classifier: {lang} -> {corrected_lang} "
                    f"(message: {chat.message[:CHAT_MESSAGE_PREVIEW]})"
                )
                lang = corrected_lang
                lang_confidence = CLASSIFIER_LANGUAGE_CONFIDENCE
                context.detected_language = lang
                context.language_confidence = lang_confidence
                metadata.retriever_detected_lang = lang
                metadata.language = lang

            # the classifier is the only source of script, since the statistical detector returns a bare language code.
            # the script is trusted only when message_language also validated.
            # models are known to garble the language field (see the junk-language regressions in the classifier tests).
            # a surviving script over a fallback language would demand transliterating the hub default.
            # Latn never travels: it is the script the prompts already assume, so an explicit rule for it
            # reshapes every english and romanized prompt for zero information and degrades compliance
            # with the remaining rules. romanized hindi stays covered by the heuristic hindi/hinglish rules.
            if (
                classification.message_script
                and classification.message_language
                and classification.message_script != "Latn"
            ):
                context.detected_script = classification.message_script

            # the resolved pair drives the reply language rule in the retriever and the synthesizer.
            # it was previously invisible in production, which made language complaints undiagnosable from logs.
            logger.info(
                f"Reply language resolved: language={lang!r}, script={context.detected_script!r}, "
                f"confidence={lang_confidence}"
            )

            context.temporal = classification.temporal
            context.person_entities = classification.person_entities
            # places come from the rewritten question, not the original one the classifier saw:
            # a follow-up's place arrives through history or the notes and only the rewrite carries it
            places = self.classifier.extract_place_names(rewritten_chat.message, lang)
            note_places: list[str] = []
            if not any(p.strip() for p in places):
                note_places = [
                    place
                    for note in chat.conversation_context or []
                    for place in self.classifier.extract_place_names(note.text, lang)
                ]
            context.place_entities = _boost_places(places, note_places, chat.conversation_context)

            metadata_dict = metadata.model_dump() if metadata else {}
            metadata_dict["router_intent"] = classification.intent.value
            metadata_dict["router_routes"] = [r.source.value for r in classification.routes]
            metadata_dict["router_used_llm_classifier"] = classification.used_llm
            metadata_dict["router_classification_reasoning"] = classification.reasoning
            metadata_dict.update(
                classification_metadata_fields(
                    intent=classification.intent,
                    temporal=classification.temporal,
                    synthesis=classification.synthesis,
                )
            )
            # resolve once, reused across all NO_ANSWER_AVAILABLE exit paths below
            unanswerable_resources = resources_for_scenario(chat.personalization, "unanswerable_question") or None

            if classification.intent == QueryIntent.ROLE_DESCRIPTION:
                logger.info("Role/identity question detected, generating role description reply")
                return await self._handle_role_description(chat, lang, start_time, duration_details)

            if classification.intent == QueryIntent.METAQUESTION:
                logger.info("Metaquestion detected, returning refusal without retrieval")
                return self._handle_metaquestion(
                    rewritten_chat, context, lang, metadata, start_time, unanswerable_resources, duration_details
                )

            if classification.intent == QueryIntent.VOTE_RECOMMENDATION:
                logger.info("Vote recommendation request detected, returning refusal without retrieval")
                return self._handle_vote_recommendation(
                    rewritten_chat, context, lang, metadata, start_time, unanswerable_resources, duration_details
                )

            if classification.intent == QueryIntent.ELECTION_RESULTS:
                logger.info("Election results question detected, returning refusal without retrieval")
                return self._handle_election_results(
                    rewritten_chat, context, lang, metadata, start_time, unanswerable_resources, duration_details
                )

            located_chat = await self._bare_location_turn(chat, classification)
            if located_chat is not None:
                logger.info("Bare location with no refused question to resume, acknowledging it without retrieval")
                return await self._handle_non_question(located_chat, lang, start_time, duration_details, located=True)

            if classification.intent in (QueryIntent.QUESTION, QueryIntent.NON_QUESTION):
                place = await self._place_to_confirm(chat)
                if place is not None:
                    return await self._confirm_place(chat, place, lang, start_time, duration_details)

            # the refused message was an opener, so the user's reply was only a location
            if classification.intent == QueryIntent.NON_QUESTION and self._location_resumed:
                logger.info("Resumed message asks nothing, acknowledging the location instead")
                return await self._handle_non_question(chat, lang, start_time, duration_details, located=True)

            if classification.intent == QueryIntent.NON_QUESTION:
                logger.info("Non-question detected via classifier, generating conversational reply")
                return await self._handle_non_question(chat, lang, start_time, duration_details)

            # digests are not location-gated yet
            if classification.intent == QueryIntent.SYNTHESIS and classification.synthesis:
                logger.info("Synthesis/digest detected, switching to synthesis pipeline")
                return await self._handle_synthesis(
                    rewritten_chat,
                    context,
                    classification,
                    lang,
                    metadata,
                    start_time,
                    unanswerable_resources,
                    duration_details,
                )

            if classification.intent in self._SCENARIO_HANDLING:
                scenario_response = await self._try_handle_scenario_intent(
                    chat, classification.intent, lang, start_time, duration_details
                )
                if scenario_response is not None:
                    return scenario_response

            if _user_location_missing(chat, classification):
                located = await self._chat_located_by_this_turn(chat)
                if located is not None:
                    logger.info("Location-dependent question names the user's place, routing it with the new note")
                    return await self._route(located)
                logger.info("Location-dependent question without a location note, replying without retrieval")
                return self._handle_missing_location(
                    rewritten_chat, classification, lang, metadata, start_time, unanswerable_resources, duration_details
                )

            if unified_decomposition_result is not None:
                decomposition_result = unified_decomposition_result
                metadata_dict["router_decomposition_attempted"] = self.config.router_enable_decomposition
                metadata_dict["router_decomposition_used"] = decomposition_result.should_decompose
                metadata_dict["router_decomposition_reasoning"] = decomposition_result.reasoning
            elif self.config.router_enable_decomposition:
                decomposer = QueryDecomposer()

                t = time.perf_counter()
                with pipeline_step(DurationKey.DECOMPOSITION_ANALYSIS):
                    decomposition_result = await decomposer.analyze(
                        rewritten_chat.message,
                        context,
                        classification,
                    )
                duration_details[DurationKey.DECOMPOSITION_ANALYSIS] = (time.perf_counter() - t) * 1000

                metadata_dict["router_decomposition_attempted"] = True
                metadata_dict["router_decomposition_used"] = decomposition_result.should_decompose
                metadata_dict["router_decomposition_reasoning"] = decomposition_result.reasoning
            else:
                decomposition_result = DecompositionResult(
                    should_decompose=False,
                    sub_queries=[],
                    reasoning="Decomposition disabled in configuration",
                )
                metadata_dict["router_decomposition_attempted"] = False
                metadata_dict["router_decomposition_used"] = False

            answer: str | None = None
            primary_source: str | None = None

            if decomposition_result.should_decompose:
                logger.info(
                    f"Query will be decomposed into {len(decomposition_result.sub_queries)} sub-queries "
                    f"(reasoning={decomposition_result.reasoning!r})"
                )
                metadata_dict["router_decomposition_subquery_count"] = len(decomposition_result.sub_queries)

                self._notify("searching_sources")

                executor = SubQueryExecutor(
                    enrichers=self.enrichers,
                    internal_handler=self.internal_handler,
                )

                async with asyncio.TaskGroup() as tg:
                    # create_task copies the context, so only the executor's lines carry the step
                    with pipeline_step(DurationKey.DECOMPOSITION_TOTAL):
                        execution_task = tg.create_task(
                            executor.execute(
                                sub_queries=decomposition_result.sub_queries,
                                context=context,
                                routes=classification.routes,
                            )
                        )
                    subquery_topics_task = tg.create_task(
                        self._extract_subquery_topics(
                            decomposition_result.sub_queries,
                            chat.existing_topics,
                            content_language=lang,
                        )
                    )
                execution_result = execution_task.result()
                subquery_topics = subquery_topics_task.result()

                duration_details[DurationKey.DECOMPOSITION_TOTAL] = execution_result.total_latency_ms
                for idx, sub_result in enumerate(execution_result.results):
                    duration_details[DurationKey.sub_query(idx)] = sub_result.latency_ms
                    for handler_result in sub_result.handler_results:
                        if handler_result.latency_ms is not None:
                            duration_details[DurationKey.sub_query_handler(idx, handler_result.source.value)] = (
                                handler_result.latency_ms
                            )

                metadata_dict["router_decomposition_total_latency_ms"] = execution_result.total_latency_ms

                synthesizer = ResponseSynthesizer()
                t = time.perf_counter()
                with pipeline_step(DurationKey.SYNTHESIS):
                    answer, synthesis_metadata = await synthesizer.synthesize_from_subqueries(
                        original_query=rewritten_chat.message,
                        sub_results=execution_result.results,
                        language=_reply_language(chat, lang),
                        script=context.detected_script,
                    )
                duration_details[DurationKey.SYNTHESIS] = (time.perf_counter() - t) * 1000

                primary_source = self.SOURCE_DECOMPOSITION

                # aggregate metadata from answered subqueries
                total_documents_count = 0
                all_document_ids: list[str] = []
                all_cited_ids: list[str] = []
                all_entities: list[str] = []
                retrieved_chunks: list[str] = []
                temporal_type_val: str | None = None
                temporal_ref_val: str | None = None
                temporal_window_val: int | None = None
                temporal_weight_val: float | None = None
                recency_first_used_val: bool | None = None
                recency_first_window_val: int | None = None
                recency_first_fallback_val: bool | None = None

                for sub_result in execution_result.results:
                    if not sub_result.answer:
                        continue
                    for handler_result in sub_result.handler_results:
                        if handler_result.source == KnowledgeSource.INTERNAL_KB and handler_result.metadata:
                            doc_count = handler_result.metadata.get("documents_count")
                            if doc_count is not None and doc_count > 0:
                                total_documents_count += doc_count

                            doc_ids = handler_result.metadata.get("document_ids_used")
                            if doc_ids:
                                all_document_ids.extend(doc_ids)

                            cited_ids = handler_result.metadata.get("document_ids_cited")
                            if cited_ids:
                                all_cited_ids.extend(cited_ids)

                            entities = handler_result.metadata.get("entities")
                            if entities:
                                all_entities.extend(entities)

                            handler_chunks = handler_result.metadata.get("retrieved_chunks") or []
                            if handler_chunks:
                                retrieved_chunks.extend(handler_chunks)

                            temporal_type_val = handler_result.metadata.get("temporal_type")
                            temporal_ref_val = handler_result.metadata.get("temporal_reference_date")
                            temporal_window_val = handler_result.metadata.get("temporal_recency_window_days")
                            temporal_weight_val = handler_result.metadata.get("temporal_recency_weight")

                            if handler_result.metadata.get("recency_first_used") is not None:
                                recency_first_used_val = handler_result.metadata.get("recency_first_used")
                                recency_first_window_val = handler_result.metadata.get("recency_first_window_days")
                                if handler_result.metadata.get("recency_first_fallback_used"):
                                    recency_first_fallback_val = True

                unique_document_ids = list(dict.fromkeys(all_document_ids))
                unique_cited_ids = list(dict.fromkeys(all_cited_ids))
                unique_entities = list(dict.fromkeys(all_entities))

                final_metadata = Metadata(
                    answerable=True,
                    retriever_detected_lang=lang,
                    language=lang,
                    **rewriter_metadata_fields(metadata),
                    documents_count=total_documents_count if total_documents_count > 0 else None,
                    document_ids_used=unique_document_ids if unique_document_ids else None,
                    document_ids_cited=unique_cited_ids if unique_cited_ids else None,
                    entities=unique_entities if unique_entities else None,
                    temporal_reference_date=temporal_ref_val,
                    temporal_recency_window_days=temporal_window_val,
                    temporal_recency_weight=temporal_weight_val,
                    recency_first_used=recency_first_used_val,
                    recency_first_window_days=recency_first_window_val,
                    recency_first_fallback_used=recency_first_fallback_val,
                    router_decomposition_used=True,
                    router_subquery_count=len(decomposition_result.sub_queries),
                    router_subquery_answered_count=synthesis_metadata.get("subquery_answered_count"),
                    router_synthesis_status=synthesis_metadata.get("synthesis_status"),
                    duration_details=duration_details or None,
                    retrieved_chunks=retrieved_chunks if retrieved_chunks else None,
                    **classification_metadata_fields(
                        intent=classification.intent,
                        temporal_type=temporal_type_val or classification.temporal.type,
                        synthesis=classification.synthesis,
                        include_temporal_details=False,
                    ),
                )

                duration = time.perf_counter() - start_time
                logger.info(f"RAGRouter completed (decomposed) in {duration:.2f}s")

                if (
                    synthesis_metadata.get("synthesis_status") in NO_ANSWER_SYNTHESIS_STATUSES
                    or not answer
                    or answer.strip() == ""
                ):
                    error_type = ErrorType.NO_ANSWER_AVAILABLE
                    logger.warning(
                        f"No answer produced (decomposed) for query: '{rewritten_chat.message[:120]}' "
                        f"(temporal={classification.temporal.type.value})"
                    )
                    msg = errors.get_error_message(
                        error_type,
                        _reply_language(chat, lang),
                        external_resources=unanswerable_resources,
                        question=rewritten_chat.message,
                        notes=rewritten_chat.conversation_context,
                        force_all_resources=False,
                    )
                    return ChatResponse(
                        error_type=error_type,
                        answer=msg,
                        metadata=_fallback_metadata(final_metadata),
                        topics=subquery_topics,
                    )

                await _backfill_language(final_metadata, answer, chat)
                return ChatResponse(answer=answer, metadata=final_metadata, topics=subquery_topics)

            enricher_routes = [r for r in classification.routes if r.source != KnowledgeSource.INTERNAL_KB]

            enrichment_facts: list[str] = []
            enrichment_sources: list[str] = []

            if enricher_routes and self.enrichers:
                logger.info(f"Running {len(enricher_routes)} enrichers: {[r.source.value for r in enricher_routes]}")
                enricher_results = await self.enricher_aggregator.aggregate(
                    rewritten_chat.message,
                    context,
                    enricher_routes,
                )

                if enricher_results.total_latency_ms is not None:
                    duration_details[DurationKey.ENRICHMENT_AGGREGATION] = enricher_results.total_latency_ms

                for result in enricher_results.results:
                    if result.latency_ms is not None:
                        duration_details[result.source.value] = result.latency_ms
                    if result.success and result.context_snippets:
                        enrichment_facts.extend(result.context_snippets)
                        enrichment_sources.append(result.source.value)
                        metadata_dict[f"router_{result.source.value}_latency_ms"] = result.latency_ms
                        metadata_dict[f"router_{result.source.value}_facts_count"] = len(result.context_snippets)

                logger.info(f"Enrichment gathered {len(enrichment_facts)} facts from {enrichment_sources}")

            internal_result: HandlerResult | None = None

            if self.internal_handler and self.internal_handler.is_enabled():
                logger.info(f"Running InternalKB with {len(enrichment_facts)} enrichment facts")
                self._notify("searching_sources")
                internal_result = await self.internal_handler.retrieve(
                    rewritten_chat.message,
                    context,
                    enrichment_facts=enrichment_facts,
                    status_callback=self.status_callback,
                )

                if internal_result.latency_ms is not None:
                    duration_details[DurationKey.INTERNAL_KB] = internal_result.latency_ms

                handler_durations = (
                    internal_result.metadata.get("duration_details") if internal_result.metadata else None
                )
                if handler_durations:
                    duration_details.update(handler_durations)

                if internal_result.metadata:
                    metadata_dict["documents_count"] = internal_result.metadata.get("documents_count")
                    metadata_dict["document_ids_used"] = internal_result.metadata.get("document_ids_used")
                    metadata_dict["document_ids_cited"] = internal_result.metadata.get("document_ids_cited")
                    metadata_dict["retrieved_chunks"] = internal_result.metadata.get("retrieved_chunks")
                    metadata_dict["entities"] = internal_result.metadata.get("entities")
                    metadata_dict["enrichment_facts_used"] = internal_result.metadata.get("enrichment_facts_used")
                    metadata_dict["temporal_type"] = internal_result.metadata.get("temporal_type")
                    metadata_dict["temporal_reference_date"] = internal_result.metadata.get("temporal_reference_date")
                    metadata_dict["temporal_recency_window_days"] = internal_result.metadata.get(
                        "temporal_recency_window_days"
                    )
                    metadata_dict["temporal_recency_weight"] = internal_result.metadata.get("temporal_recency_weight")
                    metadata_dict["recency_first_used"] = internal_result.metadata.get("recency_first_used")
                    metadata_dict["recency_first_window_days"] = internal_result.metadata.get(
                        "recency_first_window_days"
                    )
                    metadata_dict["recency_first_fallback_used"] = internal_result.metadata.get(
                        "recency_first_fallback_used"
                    )
                    metadata_dict["answer_model"] = internal_result.metadata.get("answer_model")
                    metadata_dict["llm_fallback_used"] = internal_result.metadata.get("llm_fallback_used")

                if internal_result.success:
                    metadata_dict["router_internal_kb_latency_ms"] = internal_result.latency_ms
                    metadata_dict["router_internal_kb_confidence"] = internal_result.confidence

            if internal_result and internal_result.success and internal_result.answer:
                answer = internal_result.answer
                primary_source = KnowledgeSource.INTERNAL_KB.value
                logger.info("Answer from InternalKB")

            # elif enrichment_facts:
            #     logger.info(f"No InternalKB answer, falling back to enrichment ({len(enrichment_facts)} facts)")
            #     answer = await self._generate_answer_from_enrichment(
            #         enrichment_facts,
            #         rewritten_chat.message,
            #         lang,
            #     )
            #     primary_source = self.SOURCE_ENRICHMENT_FALLBACK
            #     metadata_dict["enrichment_source"] = ", ".join(enrichment_sources)

            final_metadata = Metadata(
                answerable=True,
                retriever_detected_lang=lang,
                language=lang,
                **rewriter_metadata_fields(metadata),
                documents_count=metadata_dict.get("documents_count"),
                document_ids_used=metadata_dict.get("document_ids_used"),
                document_ids_cited=metadata_dict.get("document_ids_cited"),
                retrieved_chunks=metadata_dict.get("retrieved_chunks"),
                entities=metadata_dict.get("entities"),
                enrichment_facts_used=metadata_dict.get("enrichment_facts_used") or len(enrichment_facts),
                enrichment_source=primary_source if primary_source == self.SOURCE_ENRICHMENT_FALLBACK else None,
                temporal_reference_date=metadata_dict.get("temporal_reference_date"),
                temporal_recency_window_days=metadata_dict.get("temporal_recency_window_days"),
                temporal_recency_weight=metadata_dict.get("temporal_recency_weight"),
                recency_first_used=metadata_dict.get("recency_first_used"),
                recency_first_window_days=metadata_dict.get("recency_first_window_days"),
                recency_first_fallback_used=metadata_dict.get("recency_first_fallback_used"),
                answer_model=metadata_dict.get("answer_model"),
                llm_fallback_used=metadata_dict.get("llm_fallback_used"),
                router_decomposition_used=decomposition_result.should_decompose,
                router_subquery_count=None,
                duration_details=duration_details or None,
                **classification_metadata_fields(
                    intent=classification.intent,
                    temporal_type=metadata_dict.get("temporal_type") or classification.temporal.type,
                    synthesis=classification.synthesis,
                    include_temporal_details=False,
                ),
            )

            duration = time.perf_counter() - start_time
            logger.info(f"RAGRouter completed in {duration:.2f}s, primary_source={primary_source}")

            if not answer or answer.strip() == "":
                handler_error = _handler_error(internal_result)
                if handler_error is not None:
                    error_type, handler_message = handler_error
                    logger.warning(
                        f"InternalKB failed with {error_type.value} for query: '{rewritten_chat.message[:120]}'"
                    )
                    msg = handler_message or errors.get_error_message(
                        error_type,
                        _reply_language(chat, lang),
                        external_resources=resources_for_scenario(chat.personalization, "error_occurred") or None,
                    )
                    return ChatResponse(error_type=error_type, answer=msg, metadata=_error_metadata(final_metadata))

                error_type = ErrorType.NO_ANSWER_AVAILABLE
                logger.warning(
                    f"No answer produced for query: '{rewritten_chat.message[:120]}' "
                    f"(temporal={classification.temporal.type.value}, used_llm={classification.used_llm})"
                )
                msg = errors.get_error_message(
                    error_type,
                    _reply_language(chat, lang),
                    external_resources=unanswerable_resources,
                    question=rewritten_chat.message,
                    notes=rewritten_chat.conversation_context,
                    force_all_resources=False,
                )
                return ChatResponse(error_type=error_type, answer=msg, metadata=_fallback_metadata(final_metadata))

            await _backfill_language(final_metadata, answer, chat)
            return ChatResponse(answer=answer, metadata=final_metadata)

        except Exception as e:
            return await self._internal_error_response(chat, e)

    _NON_QUESTION_FALLBACK = "Hello! How can I help you?"
    _CONFIRM_PLACE_FALLBACK = "Did you mean {place}? If not, where are you?"

    # fallbacks are English-only by design: they are only used when the LLM call
    # failed, so LLM-based localization is unavailable (same as get_error_message)
    _SCENARIO_HANDLING: dict[QueryIntent, _ScenarioHandling] = {
        QueryIntent.SPEAK_TO_PERSON: _ScenarioHandling(
            scenario="speak_to_person",
            instruction=(
                "The user wants to speak to a human or get in touch with a real person. "
                "Acknowledge their request warmly and direct them to the external resources listed below."
            ),
            fallback="You can reach a person here:",
        ),
        QueryIntent.PURCHASE_SUBSCRIBE: _ScenarioHandling(
            scenario="purchase_subscribe",
            instruction=(
                "The user wants to buy, purchase, or subscribe to products or services. "
                "Direct them to the external resources listed below."
            ),
            fallback="You can find our products and services here:",
        ),
    }

    async def _try_handle_scenario_intent(
        self,
        chat: ChatRequest,
        intent: QueryIntent,
        lang: str | None,
        start_time: float,
        duration_details: dict[str, float],
    ) -> ChatResponse | None:
        handling = self._SCENARIO_HANDLING.get(intent)
        if handling is None:
            return None
        resources = resources_for_scenario(chat.personalization, handling.scenario)
        if not resources:
            return None
        return await self._handle_scenario_intent(chat, intent, handling, resources, lang, start_time, duration_details)

    async def _handle_scenario_intent(
        self,
        chat: ChatRequest,
        intent: QueryIntent,
        handling: _ScenarioHandling,
        resources: list[ExternalResource],
        lang: str | None,
        start_time: float,
        duration_details: dict[str, float],
    ) -> ChatResponse:
        t = time.perf_counter()
        with pipeline_step(DurationKey.SCENARIO_REPLY):
            answer = await self._generate_scenario_reply(chat, handling, resources, lang)
        duration_details[DurationKey.SCENARIO_REPLY] = (time.perf_counter() - t) * 1000

        final_metadata = Metadata(
            retriever_detected_lang=lang,
            language=_reply_language(chat, lang),
            duration_details=duration_details,
            **classification_metadata_fields(intent=intent),
        )

        duration = time.perf_counter() - start_time
        logger.info(f"RAGRouter completed ({intent.value}) in {duration:.2f}s")

        await _backfill_language(final_metadata, answer, chat)
        return ChatResponse(answer=answer, metadata=final_metadata)

    async def _generate_scenario_reply(
        self,
        chat: ChatRequest,
        handling: _ScenarioHandling,
        resources: list[ExternalResource],
        lang: str | None,
    ) -> str:
        persona_prompt, persona_in_scope = _scenario_persona(chat.personalization, resources)

        system_parts: list[str] = [persona_prompt]
        system_parts.append(handling.instruction)
        system_parts.append(SCENARIO_REPLY_RESOURCE_GROUNDING)
        system_parts.append(PLAIN_TEXT_ONLY_INSTRUCTION)

        reply_lang = _reply_language(chat, lang)
        system_parts.extend(language.reply_language_instructions(reply_lang))

        messages: list[tuple[str, str]] = [("system", "\n\n".join(system_parts))]

        if chat.history:
            messages.extend((msg.role.value, msg.content) for msg in chat.history[-4:])

        messages.append(("user", chat.message))

        try:
            llm = create_chat_model(self.llm_config.llm_scenario_reply, self.llm_config)
            response = await llm.ainvoke(messages)
            answer = str(response.content).strip()
            answer = await self._enforce_reply_language(answer, reply_lang, messages, llm)
            answer = errors.dedupe_questions(answer, resources)
            answer = await directive_gate.enforce_profile_directives(
                answer,
                directive_gate.profile_texts(persona_in_scope),
                what="Scenario reply",
                llm_config=self.llm_config,
                marked=directive_gate.marked_values(resources),
            )
            answer = errors.strip_description_contacts(answer, resources)
            return errors.ensure_contact_tokens(answer, resources)
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Scenario reply LLM call failed: {e}")
            return errors.append_resources(handling.fallback, resources)

    async def _check_unsupported_language(
        self,
        chat: ChatRequest,
        lang: str | None,
        start_time: float,
        duration_details: dict[str, float],
    ) -> ChatResponse | None:
        """Return a ChatResponse if the detected language is not in the hub's supported languages.

        `lang` must be the current-message verdict. History-only codes are too weak to refuse
        and must not be passed in.
        """
        if not chat.personalization or not chat.personalization.supported_languages:
            return None  # no restriction configured

        supported = chat.personalization.supported_languages
        if lang and lang not in supported:
            logger.info(
                f"Language '{lang}' not in hub supported languages {supported}, "
                f"generating unsupported-language response in '{lang}'"
            )
            supported_names = [LANGUAGE_NAMES.get(code, code) for code in supported]
            answer = await self._generate_unsupported_language_reply(chat, lang, supported_names)

            duration = time.perf_counter() - start_time
            logger.info(f"RAGRouter completed (unsupported language) in {duration:.2f}s")

            return ChatResponse(
                answer=answer,
                metadata=Metadata(
                    retriever_detected_lang=lang,
                    language=lang,
                    duration_details=duration_details or None,
                    **classification_metadata_fields(unsupported_language=True),
                ),
            )

        return None

    async def _generate_unsupported_language_reply(
        self,
        chat: ChatRequest,
        reply_lang: str,
        supported_names: list[str],
    ) -> str:
        """Generate a refusal informing the user which languages are supported.

        reply_lang is the user's detected (unsupported) language.
        """
        supported_list = ", ".join(supported_names)
        system_prompt = (
            f"The user wrote in a language that is not supported by this chatbot. "
            f"CRITICAL: You MUST reply in the language with the following ISO 639-1 code: {reply_lang}. "
            f"Do NOT answer the user's question. "
            f"Politely inform them that this chatbot only supports the following languages: {supported_list}. "
            f"Keep your response to 1-2 sentences. "
            f"{PLAIN_TEXT_ONLY_INSTRUCTION}"
        )

        messages: list[tuple[str, str]] = [
            ("system", system_prompt),
            ("user", chat.message),
        ]

        try:
            llm = create_chat_model(self.llm_config.llm_error_handler, self.llm_config)
            response = await llm.ainvoke(messages)
            return str(response.content).strip()
        except Exception as e:
            logger.warning(f"Unsupported language LLM call failed: {e}")
            return f"Sorry, this chatbot only supports: {supported_list}."

    async def _handle_non_question(
        self,
        chat: ChatRequest,
        lang: str | None,
        start_time: float,
        duration_details: dict[str, float] | None = None,
        located: bool = False,
    ) -> ChatResponse:
        """Handle non-question queries (greetings, thanks, etc.) with a lightweight LLM reply.

        located marks a message that only says where the user is: the reply notes it and asks for their question.
        """
        if duration_details is None:
            duration_details = {}

        if located:
            lang = await self._place_turn_language(chat, lang)
        answer = await self._generate_conversational_reply(chat, lang, located=located)

        final_metadata = Metadata(
            retriever_detected_lang=lang,
            language=_reply_language(chat, lang),
            duration_details=duration_details or None,
            **classification_metadata_fields(
                intent=QueryIntent.LOCATION_NOTED if located else QueryIntent.NON_QUESTION
            ),
        )

        duration = time.perf_counter() - start_time
        logger.info(f"RAGRouter completed (non-question) in {duration:.2f}s")

        await _backfill_language(final_metadata, answer, chat)
        return ChatResponse(answer=answer, metadata=final_metadata)

    async def _handle_role_description(
        self,
        chat: ChatRequest,
        lang: str | None,
        start_time: float,
        duration_details: dict[str, float] | None = None,
    ) -> ChatResponse:
        """Handle identity/capability questions ("who are you?", "what can I ask about?").

        Answers with a friendly description built from the hub's personalization (name,
        description) plus any role_description-tagged resources, rather than the metaquestion
        refusal.
        """
        if duration_details is None:
            duration_details = {}

        t = time.perf_counter()
        with pipeline_step(DurationKey.SCENARIO_REPLY):
            answer = await self._generate_role_description_reply(chat, lang)
        duration_details[DurationKey.SCENARIO_REPLY] = (time.perf_counter() - t) * 1000

        final_metadata = Metadata(
            retriever_detected_lang=lang,
            language=_reply_language(chat, lang),
            duration_details=duration_details or None,
            **classification_metadata_fields(intent=QueryIntent.ROLE_DESCRIPTION),
        )

        duration = time.perf_counter() - start_time
        logger.info(f"RAGRouter completed (role_description) in {duration:.2f}s")

        await _backfill_language(final_metadata, answer, chat)
        return ChatResponse(answer=answer, metadata=final_metadata)

    async def _generate_role_description_reply(self, chat: ChatRequest, lang: str | None) -> str:
        role_resources = resources_for_scenario(chat.personalization, "role_description")
        persona_prompt, persona_in_scope = _scenario_persona(chat.personalization, role_resources)

        system_parts: list[str] = [persona_prompt]

        system_parts.append(
            "The user is asking who you are, what you can do, or what they can ask about. "
            "Warmly and briefly describe your identity, purpose, and the kinds of topics or questions you can help "
            "with, based on your name and description above. Do not refuse, and do not discuss your internal sources, "
            "data, or reasoning. 2-4 sentences."
        )
        system_parts.append(PLAIN_TEXT_ONLY_INSTRUCTION)

        reply_lang = _reply_language(chat, lang)
        system_parts.extend(language.reply_language_instructions(reply_lang))

        messages: list[tuple[str, str]] = [("system", "\n\n".join(system_parts))]

        if chat.history:
            messages.extend((msg.role.value, msg.content) for msg in chat.history[-4:])

        messages.append(("user", chat.message))

        try:
            llm = create_chat_model(self.llm_config.llm_error_handler, self.llm_config)
            response = await llm.ainvoke(messages)
            answer = str(response.content).strip()
            answer = await self._enforce_reply_language(answer, reply_lang, messages, llm)
            answer = errors.dedupe_questions(answer, role_resources)
            answer = await directive_gate.enforce_profile_directives(
                answer,
                directive_gate.profile_texts(persona_in_scope),
                what="Role description reply",
                llm_config=self.llm_config,
                marked=directive_gate.marked_values(role_resources),
            )
            answer = errors.strip_description_contacts(answer, role_resources)
            return errors.ensure_contact_tokens(answer, role_resources)
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Role description reply LLM call failed: {e}")
            name = chat.personalization.name if chat.personalization and chat.personalization.name else "This assistant"
            description = chat.personalization.description if chat.personalization else None
            if description:
                return f"{name}: {description}"
            return f"{name} is here to help answer your questions."

    async def _enforce_reply_language(
        self,
        answer: str,
        reply_lang: str | None,
        messages: list[tuple[str, str]],
        llm: BaseChatModel | Runnable[LanguageModelInput, BaseMessage],
    ) -> str:
        """Detect-and-rewrite gate for lightweight replies (greetings, role descriptions, scenarios).

        These prompts carry the hub-admin persona in the same system message as the language
        instruction, and small models demonstrably obey a description like "respond in X only"
        over that instruction — prompt wording alone does not hold. Exemptions and the
        detect/compare decision are shared with language.enforce_language_standalone, the
        gate the RAG answer and /preview paths use. The rewrite here replays the
        conversation, which is why only the decision is shared.
        """
        detected = await language.reply_language_violation(answer, reply_lang)
        if detected is None:
            return answer

        logger.warning(f"Lightweight reply came back in {detected!r} instead of {reply_lang!r}; rewriting")
        retry_messages: list[tuple[str, str]] = [
            *messages,
            ("assistant", answer),
            (
                "user",
                f"Rewrite your reply in the language with the following ISO 639-1 code: {reply_lang}. "
                "Keep the same meaning and tone. Output only the rewritten reply.",
            ),
        ]
        try:
            response = await llm.ainvoke(retry_messages)
            return str(response.content).strip()
        except Exception as e:
            logger.opt(exception=sys.exc_info()).warning(f"Reply language rewrite failed: {e}")
            return answer

    _CONVERSATIONAL_INSTRUCTION = (
        "Reply naturally and briefly to this conversational message "
        "(greeting, thanks, farewell, acknowledgment, or an input too fragmentary to act on). "
        "1-2 sentences max. Never state a fact about the world - no people, places, dates, "
        "events, numbers, or definitions - even when the message looks like a topic you "
        "recognize. If it is not a clear greeting or acknowledgment, ask the user what they "
        "would like to know about it."
    )
    _LOCATED_INSTRUCTION = (
        "The user has just said where they are, answering a question about their location. "
        "The user turn below is the location on record for them, not their own words. "
        "Reply in 1-2 sentences: confirm that it has been noted, then ask what they would like to know. "
        "The place is where they are, not a topic: do not ask what they want to know about it, and never "
        "state a fact about it or about anything else in the world."
    )
    _CONFIRM_PLACE_INSTRUCTION = (
        "The user was asked where they are and replied with a short word that could be the abbreviation of the "
        "place in the user turn below, or just an everyday word. The user turn below is that place, not their own "
        "words. Reply in 1-2 sentences: ask whether they meant that place, and if not, where they are. Never state "
        "a fact about the place or about anything else in the world."
    )

    async def _generate_conversational_reply(
        self, chat: ChatRequest, lang: str | None, located: bool = False, confirm_place: str | None = None
    ) -> str:
        system_parts: list[str] = []

        if chat.personalization:
            # first_message / other scenario resources are not for mid-chat greetings
            system_parts.append(prompt_without_resources(chat.personalization))
        else:
            system_parts.append(
                "You are a helpful assistant. " + NO_NAME_INSTRUCTION + "\n\n" + NEUTRAL_VOICE_INSTRUCTION
            )

        if confirm_place is not None:
            system_parts.append(self._CONFIRM_PLACE_INSTRUCTION)
        else:
            system_parts.append(self._LOCATED_INSTRUCTION if located else self._CONVERSATIONAL_INSTRUCTION)
        system_parts.append(PLAIN_TEXT_ONLY_INSTRUCTION)

        reply_lang = _reply_language(chat, lang)
        system_parts.extend(language.reply_language_instructions(reply_lang))

        messages: list[tuple[str, str]] = [("system", "\n\n".join(system_parts))]

        if confirm_place is not None:
            # same as located: only the extracted place reaches this reply, never the user's words
            messages.append(("user", confirm_place))
        elif located:
            # the user's words never reach this reply: a misread question would be answered from model knowledge.
            # the note is all an acknowledgment needs
            messages.append(("user", "\n".join(note.text for note in chat.conversation_context or [])))
        else:
            if chat.history:
                messages.extend((msg.role.value, msg.content) for msg in chat.history[-4:])
            messages.append(("user", chat.message))

        try:
            llm = create_chat_model(self.llm_config.llm_error_handler, self.llm_config)
            response = await llm.ainvoke(messages)
            answer = str(response.content).strip()
            answer = await self._enforce_reply_language(answer, reply_lang, messages, llm)
            # the conversational prompt renders no resources; judge only what it saw
            return await directive_gate.enforce_profile_directives(
                answer,
                directive_gate.profile_texts(chat.personalization, include_resources=False),
                what="Conversational reply",
                llm_config=self.llm_config,
            )
        except Exception as e:
            logger.warning(f"Conversational reply LLM call failed: {e}")
            if confirm_place is not None:
                return self._CONFIRM_PLACE_FALLBACK.format(place=confirm_place)
            return self._NON_QUESTION_FALLBACK

    def _handle_metaquestion(
        self,
        chat: ChatRequest,
        context: QueryContext,
        lang: str | None,
        metadata: Metadata,
        start_time: float,
        unanswerable_resources: list[ExternalResource] | None = None,
        duration_details: dict[str, float] | None = None,
    ) -> ChatResponse:
        """Handle metaquestions (questions about the system, its sources, or its reasoning).

        Returns a refusal message without performing any knowledge base retrieval.
        """
        if duration_details is None:
            duration_details = {}

        error_type = ErrorType.METAQUESTION
        msg = errors.get_error_message(
            error_type,
            _reply_language(chat, lang),
            external_resources=unanswerable_resources,
            question=context.rewritten_query or chat.message,
            notes=chat.conversation_context,
            force_all_resources=False,
        )

        final_metadata = Metadata(
            answerable=False,
            retriever_detected_lang=lang,
            language=lang,
            **rewriter_metadata_fields(metadata),
            duration_details=duration_details or None,
            **classification_metadata_fields(intent=QueryIntent.METAQUESTION),
        )

        duration = time.perf_counter() - start_time
        logger.info(f"RAGRouter completed (metaquestion) in {duration:.2f}s")

        return ChatResponse(error_type=error_type, answer=msg, metadata=final_metadata)

    def _handle_vote_recommendation(
        self,
        chat: ChatRequest,
        context: QueryContext,
        lang: str | None,
        metadata: Metadata,
        start_time: float,
        unanswerable_resources: list[ExternalResource] | None = None,
        duration_details: dict[str, float] | None = None,
    ) -> ChatResponse:
        """Refuse a request to pick a candidate, party, or side, without retrieval.

        The generator and judge carry a no-recommendations rule, but a rule the model must apply
        on every call is one layer; a question that never reaches the generator cannot be answered
        with an endorsement. The refusal invites a neutral question about stated positions, which
        takes the normal grounded path. answerable stays False as for metaquestions: a refusal by
        design is not a content gap the cms should rank among unanswered questions.
        """
        if duration_details is None:
            duration_details = {}

        error_type = ErrorType.VOTE_RECOMMENDATION
        msg = errors.get_error_message(
            error_type,
            _reply_language(chat, lang),
            external_resources=unanswerable_resources,
            question=context.rewritten_query or chat.message,
            notes=chat.conversation_context,
            force_all_resources=False,
        )

        final_metadata = Metadata(
            answerable=False,
            retriever_detected_lang=lang,
            language=lang,
            **rewriter_metadata_fields(metadata),
            duration_details=duration_details or None,
            **classification_metadata_fields(intent=QueryIntent.VOTE_RECOMMENDATION),
        )

        duration = time.perf_counter() - start_time
        logger.info(f"RAGRouter completed (vote_recommendation) in {duration:.2f}s")

        return ChatResponse(error_type=error_type, answer=msg, metadata=final_metadata)

    def _handle_election_results(
        self,
        chat: ChatRequest,
        context: QueryContext,
        lang: str | None,
        metadata: Metadata,
        start_time: float,
        unanswerable_resources: list[ExternalResource] | None = None,
        duration_details: dict[str, float] | None = None,
    ) -> ChatResponse:
        """Refuse a question about an election's outcome, without retrieval.

        answerable stays False as for vote recommendations: a refusal by design is not a content
        gap the cms should rank among unanswered questions.
        """
        if duration_details is None:
            duration_details = {}

        error_type = ErrorType.ELECTION_RESULTS
        msg = errors.get_error_message(
            error_type,
            _reply_language(chat, lang),
            external_resources=unanswerable_resources,
            question=context.rewritten_query or chat.message,
            notes=chat.conversation_context,
            force_all_resources=False,
        )

        final_metadata = Metadata(
            answerable=False,
            retriever_detected_lang=lang,
            language=lang,
            **rewriter_metadata_fields(metadata),
            duration_details=duration_details or None,
            **classification_metadata_fields(intent=QueryIntent.ELECTION_RESULTS),
        )

        duration = time.perf_counter() - start_time
        logger.info(f"RAGRouter completed (election_results) in {duration:.2f}s")

        return ChatResponse(error_type=error_type, answer=msg, metadata=final_metadata)

    def _handle_missing_location(
        self,
        chat: ChatRequest,
        classification: ClassificationResult,
        lang: str | None,
        metadata: Metadata,
        start_time: float,
        unanswerable_resources: list[ExternalResource] | None,
        duration_details: dict[str, float],
    ) -> ChatResponse:
        """Refuse a location-dependent question while the conversation holds no location note.

        Nothing is retrieved: the corpus may cover the question for several places, and without knowing
        which one the answer would be a guess. The reply asks which state the user lives in and the context
        extractor records the answer on the next turn; a question resource configured for the unanswerable
        scenario is left out so the state is not asked for twice.
        answerable stays true as on every NO_ANSWER_AVAILABLE path, so the cms counts the question as unanswered.
        """
        error_type = ErrorType.NO_ANSWER_AVAILABLE
        msg = errors.get_error_message(
            error_type,
            _reply_language(chat, lang),
            external_resources=[r for r in unanswerable_resources or [] if r.resource_type != "question"] or None,
            question=chat.message,
            notes=chat.conversation_context,
            force_all_resources=False,
            error_description=errors.LOCATION_REQUIRED_DESCRIPTION,
            fallback_message=errors.LOCATION_REQUIRED_FALLBACK,
        )

        final_metadata = Metadata(
            answerable=True,
            user_location_missing=True,
            retriever_detected_lang=lang,
            language=lang,
            **rewriter_metadata_fields(metadata),
            duration_details=duration_details or None,
            **classification_metadata_fields(
                intent=classification.intent, temporal=classification.temporal, synthesis=classification.synthesis
            ),
        )

        duration = time.perf_counter() - start_time
        logger.info(f"RAGRouter completed (location required) in {duration:.2f}s")

        return ChatResponse(error_type=error_type, answer=msg, metadata=final_metadata)

    async def _handle_synthesis(
        self,
        chat: ChatRequest,
        context: QueryContext,
        classification: ClassificationResult,
        lang: str | None,
        metadata: Metadata,
        start_time: float,
        unanswerable_resources: list[ExternalResource] | None = None,
        duration_details: dict[str, float] | None = None,
    ) -> ChatResponse:
        """Handle synthesis/digest queries with broad retrieval + summarization."""
        synthesis_ctx = classification.synthesis
        if synthesis_ctx is None:
            logger.opt(exception=sys.exc_info()).error("Synthesis context missing despite SYNTHESIS intent")
            error_type = ErrorType.INTERNAL_ERROR
            error_resources = resources_for_scenario(chat.personalization, "error_occurred") or None
            msg = errors.get_error_message(error_type, _reply_language(chat, lang), external_resources=error_resources)
            return ChatResponse(
                error_type=error_type,
                answer=msg,
                metadata=Metadata(
                    retriever_detected_lang=lang,
                    language=lang,
                    **classification_metadata_fields(error_type=error_type),
                ),
            )

        is_topical = synthesis_ctx.type == SynthesisType.TOPICAL

        # temporal-context only matters for the recency-biased path; the topical retriever
        # ignores it but constructing the Retriever still requires a value.
        temporal_context = (
            TemporalContext(type=TemporalType.NONE)
            if is_topical
            else TemporalContext(type=TemporalType.RECENCY, confidence=0.8)
        )

        chat_request = ChatRequest(
            hub_id=chat.hub_id,
            message_id=chat.message_id,
            message=chat.message,
            history=None,
            personalization=chat.personalization,
        )

        try:
            lang = context.detected_language
            lang_confidence = context.language_confidence or 0.0
            if lang is None:
                lang, lang_confidence = await language.detect(chat_request)
            retriever = Retriever(
                chat_request,
                pipeline=None,
                enable_rephrasing=False,
                enable_hyde=False,
                detected_language=lang,
                detected_script=context.detected_script,
                language_confidence=lang_confidence,
                temporal_context=temporal_context,
                person_names=context.person_entities or None,
                place_names=context.place_entities or None,
            )

            self._notify("searching_sources")

            retrieval_start = time.perf_counter()
            with neo4j_stage(DurationKey.RETRIEVAL):
                if is_topical:
                    # the bare topic drops constraints like place or period, so retrieve on the rewritten message
                    chunks = await asyncio.to_thread(retriever.retrieve_for_topical_summary, chat.message, metadata)
                else:
                    chunks = await asyncio.to_thread(
                        retriever.retrieve_for_synthesis, chat.message, synthesis_ctx, metadata
                    )
            retrieval_ms = (time.perf_counter() - retrieval_start) * 1000

            if not chunks:
                logger.info(f"{'Topical' if is_topical else 'Synthesis'} retrieval returned no chunks")
                final_metadata = Metadata(
                    answerable=True,
                    retriever_detected_lang=lang,
                    language=lang,
                    **rewriter_metadata_fields(metadata),
                    synthesis_chunks_used=0,
                    **classification_metadata_fields(
                        intent=QueryIntent.SYNTHESIS,
                        temporal=temporal_context,
                        synthesis=synthesis_ctx,
                    ),
                )
                error_type = ErrorType.NO_ANSWER_AVAILABLE
                msg = errors.get_error_message(
                    error_type,
                    _reply_language(chat, lang),
                    external_resources=unanswerable_resources,
                    question=chat.message,
                    notes=chat.conversation_context,
                    force_all_resources=False,
                )
                return ChatResponse(error_type=error_type, answer=msg, metadata=final_metadata)

            # truncate chunks to fit the summarizer's token budget
            max_chars = self.config.summarizer_max_input_chars
            trimmed: list[str] = []
            total_chars = 0
            for chunk in chunks:
                if total_chars + len(chunk) > max_chars:
                    break
                trimmed.append(chunk)
                total_chars += len(chunk)

            if len(trimmed) < len(chunks):
                logger.info(
                    f"Trimmed synthesis chunks from {len(chunks)} to {len(trimmed)} to fit {max_chars} char budget"
                )
                chunks = trimmed

            logger.info(f"Synthesizing {'topical summary' if is_topical else 'digest'} from {len(chunks)} chunks")
            summarization_start = time.perf_counter()
            summarizer = Summarizer(
                chunks,
                request_sources=True,
                target_max_chars=ANSWER_TARGET_MAX_CHARS,
                topical=is_topical,
                language=_reply_language(chat, lang),
                request=chat.message,
            )
            with pipeline_step(DurationKey.SUMMARIZATION):
                summary = await asyncio.to_thread(summarizer.run)
            summary, cited_ids = extract_and_reconcile_cited_ids(summary, metadata.document_ids_used)
            summarization_ms = (time.perf_counter() - summarization_start) * 1000

            if duration_details is None:
                duration_details = {}
            duration_details[DurationKey.RETRIEVAL] = retrieval_ms
            duration_details[DurationKey.SUMMARIZATION] = summarization_ms

            # synthesis: reject via answer judge (markup / quality)
            self._notify("evaluating_results")
            judge_start = time.perf_counter()
            with pipeline_step(DurationKey.ANSWER_JUDGING):
                judge_result = await asyncio.to_thread(
                    AnswerJudge().evaluate,
                    question=chat.message,
                    answer=summary,
                    context=chunks,
                    temporal_context=classification.temporal,
                    language=lang,
                    cited_sources=cited_ids,
                    source_document_ids=metadata.document_ids_used or [],
                    is_synthesis=True,
                )
            if not judge_result:
                duration_details[DurationKey.ANSWER_JUDGING] = (time.perf_counter() - judge_start) * 1000
                logger.warning("Synthesis summary rejected by semantic answer judge")
                final_metadata = Metadata(
                    answerable=True,
                    retriever_detected_lang=lang,
                    language=lang,
                    **rewriter_metadata_fields(metadata),
                    synthesis_chunks_used=len(chunks),
                    duration_details=duration_details,
                    **classification_metadata_fields(
                        intent=QueryIntent.SYNTHESIS,
                        temporal=temporal_context,
                        synthesis=synthesis_ctx,
                    ),
                )
                error_type = ErrorType.NO_ANSWER_AVAILABLE
                msg = errors.get_error_message(
                    error_type,
                    _reply_language(chat, lang),
                    external_resources=unanswerable_resources,
                    question=chat.message,
                    notes=chat.conversation_context,
                    force_all_resources=False,
                )
                return ChatResponse(error_type=error_type, answer=msg, metadata=final_metadata)
            duration_details[DurationKey.ANSWER_JUDGING] = (time.perf_counter() - judge_start) * 1000

            final_metadata = Metadata(
                answerable=True,
                retriever_detected_lang=lang,
                language=lang,
                **rewriter_metadata_fields(metadata),
                documents_count=metadata.documents_count,
                document_ids_used=metadata.document_ids_used,
                document_ids_cited=cited_ids,
                retrieved_chunks=metadata.retrieved_chunks,
                synthesis_chunks_used=len(chunks),
                duration_details=duration_details,
                **classification_metadata_fields(
                    intent=QueryIntent.SYNTHESIS,
                    temporal=temporal_context,
                    synthesis=synthesis_ctx,
                ),
            )

            duration = time.perf_counter() - start_time
            logger.info(f"RAGRouter completed (synthesis) in {duration:.2f}s")

            if not summary or summary.strip() == "":
                error_type = ErrorType.NO_ANSWER_AVAILABLE
                msg = errors.get_error_message(
                    error_type,
                    _reply_language(chat, lang),
                    external_resources=unanswerable_resources,
                    question=chat.message,
                    notes=chat.conversation_context,
                    force_all_resources=False,
                )
                return ChatResponse(error_type=error_type, answer=msg, metadata=final_metadata)

            await _backfill_language(final_metadata, summary, chat)
            return ChatResponse(answer=summary, metadata=final_metadata)

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Synthesis pipeline failed: {e}")
            error_type = ErrorType.INTERNAL_ERROR
            error_resources = resources_for_scenario(chat.personalization, "error_occurred") or None
            msg = errors.get_error_message(error_type, _reply_language(chat, lang), external_resources=error_resources)
            return ChatResponse(
                error_type=error_type,
                answer=msg,
                metadata=Metadata(
                    retriever_detected_lang=lang,
                    language=lang,
                    **classification_metadata_fields(error_type=error_type),
                ),
            )

    async def _generate_answer_from_enrichment(
        self,
        facts: list[str],
        query: str,
        lang: str | None,
    ) -> str:
        """Fallback: synthesize answer from enrichment facts when no internal docs found."""
        logger.info(f"Generating answer from {len(facts)} enrichment facts")

        lang_lines = language.reply_language_instructions(lang)
        language_instruction = "\n\n" + "\n".join(lang_lines) if lang_lines else ""

        facts_text = "\n".join(f"- {fact}" for fact in facts[: self.MAX_ENRICHMENT_FACTS])

        prompt = f"""Based on the following facts, answer the question concisely and accurately.

Facts:
{facts_text}

Question: {query}

Provide a direct answer based only on the facts above. If the facts don't contain enough information to fully answer the question, say so.{language_instruction}"""

        try:
            llm = create_chat_model(self.llm_config.llm_rag_router, self.llm_config)
            response = await llm.ainvoke(prompt)
            return str(response.content)

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"Failed to generate answer from enrichment: {e}")
            return f"Based on available information:\n{facts_text}"

    def get_enabled_sources(self) -> list[KnowledgeSource]:
        sources: list[KnowledgeSource] = []
        if self.internal_handler and self.internal_handler.is_enabled():
            sources.append(KnowledgeSource.INTERNAL_KB)
        for enricher in self.enrichers:
            if enricher.is_enabled():
                sources.append(enricher.source)
        return sources
