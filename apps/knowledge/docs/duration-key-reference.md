# DurationKey Reference

---

## LANGUAGE_DETECTION

**Measures:** `language.detect(chat)` — detects the language of the incoming message.

Always the first key recorded, before any routing logic.

**Neo4j:** No.

---

## REWRITING

**Measures:** `Rewriter.apply(chat, pipeline, metadata)` — runs `HistoryAwareQuestionRewriter` to make the question self-contained using conversation history (including relative-date conversion when history is present). Also published as a CloudWatch metric via `publish_metric`. Recorded in both the parallel path and the sequential fallback.

**Neo4j:** No.

---

## UNIFIED_CLASSIFICATION_DECOMPOSITION

**Measures:** `UnifiedClassifierDecomposer.analyze()` — a single LLM call that performs both intent classification and query decomposition simultaneously. Only set when `router_unified_classifier_decomposer` is enabled; mutually exclusive with `CLASSIFICATION` + `DECOMPOSITION_ANALYSIS`.

**Neo4j:** No.

---

## CLASSIFICATION

**Measures:** `QueryClassifier.classify()` — classifies query intent (e.g. `FACTUAL`, `SYNTHESIS`, `NON_QUESTION`, `METAQUESTION`) using heuristics or an LLM fallback. Only recorded when the unified classifier is disabled.

**Neo4j:** No.

---

## DECOMPOSITION_ANALYSIS

**Measures:** `QueryDecomposer.analyze()` — decides whether to decompose the query into sub-queries and, if so, produces them. Only recorded when the unified classifier is disabled and `router_enable_decomposition` is true.

**Neo4j:** No.

---

## DECOMPOSITION_TOTAL

**Measures:** Total wall-clock for `SubQueryExecutor.execute()` across all sub-queries (pulled from `execution_result.total_latency_ms`, measured inside the executor). Only on the decomposition path.

**Neo4j:** Yes. Each sub-query runs `InternalKBHandler` → `Retriever.run()` → `_perform_search()` → `graph_rag.search()` → `HybridCypherRetriever.search()`, which issues vector index + fulltext index + Cypher queries against Neo4j.

---

## SYNTHESIS *(decomposition path)*

**Measures:** `ResponseSynthesizer.synthesize_from_subqueries()` — LLM call that combines results from all sub-queries into a single answer, including unanswered halves marked NOT FOUND. All Neo4j retrieval is already complete at this point. Not recorded when every sub-query misses (`no_subquery_results` uses the localized fallback instead).

**Neo4j:** No.

---

## ENRICHMENT_AGGREGATION

**Measures:** Total time for all enrichers (e.g. `YAGOHandler`) to run in parallel via `ResultAggregator`, pulled from `enricher_results.total_latency_ms`. Per-enricher latency is also stored under a dynamic key using the enricher's source name (e.g. `"yago"`), not a `DurationKey` constant.

**Neo4j:** No. Enrichers hit external knowledge graphs (Wikidata/YAGO API).

---

## INTERNAL_KB

**Measures:** Total wall-clock for `InternalKBHandler.retrieve()` → `Retriever.run()`, pulled from `internal_result.latency_ms` (measured inside the handler). After recording this key, the router also merges `handler_durations` from `internal_result.metadata["duration_details"]`, adding the finer-grained sub-keys written inside `Retriever` (see below).

**Neo4j:** Yes — this key wraps the entire internal retrieval path, which includes one or more Neo4j queries.

### Sub-keys merged from InternalKBHandler into `duration_details`

| Sub-key | Neo4j? | What it measures |
|---|---|---|
| `INITIAL_SEARCH` | Yes | Wraps `_perform_search()` → `_run_graph_rag_search()` → `graph_rag.search()` → `HybridCypherRetriever.search()` (vector + fulltext + Cypher). The outermost timer around the initial Neo4j round-trip; includes query escaping, embedding, and result parsing in addition to the network call. |
| `SEARCH_TOTAL` | Yes | Just `execute_with_retry(graph_rag.search, ...)` inside `_run_graph_rag_search()` — the most direct timer around the Neo4j query itself. `INITIAL_SEARCH` ≥ `SEARCH_TOTAL`. |
| `RELEVANCE_FILTERING` | No | Time spent in `ContextRelevanceGate` re-scoring already-returned chunks using local embeddings. Runs after Neo4j returns results. |
| `REPHRASING` | Yes | Time for `_run_rephrasing_strategy()` — generates query variations via LLM, then fires each as a parallel `_perform_search()` call (each hitting Neo4j). Takes the first sufficient answer. |
| `HYDE` | Yes | Time for `_run_hyde_strategy()` — generates a hypothetical document via LLM (`HydeGenerator`), embeds it, then calls `_run_graph_rag_search()` with the HyDE vector against Neo4j. |
| `ANSWER_JUDGING` | No | Time for `AnswerJudge.evaluate()` — LLM call to assess whether the retrieved answer is sufficient. Can be recorded multiple times (initial search, each improvement strategy). |

---

## RETRIEVAL

**Measures:** Time to retrieve chunks for synthesis — either `retriever.retrieve_for_synthesis()` or `retriever.retrieve_for_topical_summary()` → `_run_broad_retrieval()` → `execute_with_retry(retriever.search, ...)`.

**Neo4j:** Yes. Runs a `HybridCypherRetriever` with a synthesis-specific Cypher query (temporal decay scoring or topical filtering) against the hub's vector and fulltext indexes.

---

## SUMMARIZATION

**Measures:** `Summarizer.run()` — LLM call to produce a digest/summary from already-retrieved chunks.

**Neo4j:** No.

---

## ANSWER_JUDGING *(synthesis path)*

**Measures:** `AnswerJudge.evaluate()` on the synthesis result — LLM call to decide whether the summary is usable. Recorded regardless of whether the judge accepts or rejects the answer.

**Neo4j:** No.
