import sys
from collections.abc import Callable
from typing import Any

from loguru import logger

from app.core.config import Config
from app.models.chat import ChatRequest
from app.services.retriever import Retriever
from app.services.router.handler import KnowledgeHandler
from app.services.router.models import HandlerResult, KnowledgeSource, QueryContext


class InternalKBHandler(KnowledgeHandler):
    def __init__(self) -> None:
        self.config = Config()

    @property
    def source(self) -> KnowledgeSource:
        return KnowledgeSource.INTERNAL_KB

    def is_enabled(self) -> bool:
        return getattr(self.config, "router_enable_internal_kb", True)

    def _retrieve(
        self,
        query: str,
        context: QueryContext,
        **kwargs: Any,
    ) -> HandlerResult:
        enrichment_facts: list[str] | None = kwargs.get("enrichment_facts")
        enable_rephrasing: bool | None = kwargs.get("enable_rephrasing")
        enable_hyde: bool | None = kwargs.get("enable_hyde")
        status_callback: Callable[[str], None] | None = kwargs.get("status_callback")

        logger.info(f"InternalKBHandler processing query for hub {context.hub_id}")
        if enrichment_facts:
            logger.info(f"Using {len(enrichment_facts)} enrichment facts for query expansion")

        chat_request = ChatRequest(
            hub_id=context.hub_id,
            message_id=context.message_id,
            message=query,
            history=None,  # already incorporated into rewritten query
            personalization=context.personalization,
            conversation_context=context.conversation_context,
        )

        try:
            retriever = Retriever(
                chat_request,
                pipeline=None,  # rewriting and validation already done by RAGRouter
                enable_rephrasing=enable_rephrasing,
                enable_hyde=enable_hyde,
                detected_language=context.detected_language,
                detected_script=context.detected_script,
                language_confidence=context.language_confidence,
                enrichment_facts=enrichment_facts,
                temporal_context=context.temporal,
                person_names=context.person_entities or None,
                place_names=context.place_entities or None,
                status_callback=status_callback,
                recency_first_enabled=context.recency_first_enabled,
            )
            response = retriever.run()

            metadata = {}
            if response.metadata:
                metadata = {
                    "documents_count": response.metadata.documents_count,
                    "document_ids_used": response.metadata.document_ids_used,
                    "document_ids_cited": response.metadata.document_ids_cited,
                    "retrieved_chunks": response.metadata.retrieved_chunks,
                    "entities": response.metadata.entities,
                    "hyde_used": response.metadata.hyde_used,
                    "hyde_successful": response.metadata.hyde_successful,
                    "rephrased_query": response.metadata.rephrased_query,
                    "rephrase_attempts": response.metadata.rephrase_attempts,
                    "enrichment_facts_used": response.metadata.enrichment_facts_used,
                    "temporal_type": response.metadata.temporal_type,
                    "temporal_reference_date": response.metadata.temporal_reference_date,
                    "temporal_recency_window_days": response.metadata.temporal_recency_window_days,
                    "temporal_recency_weight": response.metadata.temporal_recency_weight,
                    "relevance_gate_enabled": response.metadata.relevance_gate_enabled,
                    "relevance_shadow_mode": response.metadata.relevance_shadow_mode,
                    "relevance_threshold": response.metadata.relevance_threshold,
                    "relevance_candidates_count": response.metadata.relevance_candidates_count,
                    "relevance_kept_count": response.metadata.relevance_kept_count,
                    "relevance_dropped_count": response.metadata.relevance_dropped_count,
                    "relevance_score_min": response.metadata.relevance_score_min,
                    "relevance_score_p50": response.metadata.relevance_score_p50,
                    "relevance_score_p90": response.metadata.relevance_score_p90,
                    "relevance_score_max": response.metadata.relevance_score_max,
                    "relevance_fallback_used": response.metadata.relevance_fallback_used,
                    "relevance_fallback_mode": response.metadata.relevance_fallback_mode,
                    "relevance_embedder_id": response.metadata.relevance_embedder_id,
                    "recency_first_used": response.metadata.recency_first_used,
                    "recency_first_window_days": response.metadata.recency_first_window_days,
                    "recency_first_fallback_used": response.metadata.recency_first_fallback_used,
                    "answer_model": response.metadata.answer_model,
                    "llm_fallback_used": response.metadata.llm_fallback_used,
                    "duration_details": response.metadata.duration_details,
                }

            success = response.error_type is None
            confidence = 0.0

            if success and response.answer:
                confidence = 0.7

                if response.metadata:
                    if response.metadata.documents_count and response.metadata.documents_count > 0:
                        confidence += 0.1

                    if response.metadata.hyde_used and not response.metadata.hyde_successful:
                        confidence -= 0.1

            context_snippets = []
            if response.metadata and response.metadata.retrieved_chunks:
                context_snippets = [
                    chunk for chunk in response.metadata.retrieved_chunks[:5] if chunk and chunk.strip()
                ]

            return HandlerResult(
                source=self.source,
                success=success,
                answer=response.answer if success else None,
                confidence=max(0.0, min(1.0, confidence)),
                context_snippets=context_snippets,
                metadata=metadata,
                error=str(response.error_type) if response.error_type else None,
                error_type=response.error_type,
                # the retriever already localized this one; regenerating it costs another llm call
                error_message=None if success else response.answer,
            )

        except Exception as e:
            logger.opt(exception=sys.exc_info()).error(f"InternalKBHandler retrieval failed: {e}")
            return HandlerResult(
                source=self.source,
                success=False,
                error=str(e),
            )
