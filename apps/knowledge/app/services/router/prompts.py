"""Shared prompt fragments for router LLM calls.

These are plain string constants - no templating, no LangChain imports - that can be
concatenated into full prompt templates by the classifier, decomposer, and unified
classifier-decomposer. Fragments carry the canonical phrasing for each rule so the
different prompt variants stay in sync.
"""

from app.core.constants import RESOURCE_DISPLAY_DATA_INSTRUCTION

INTENT_CLASSIFICATION = """## Step 1: Intent Classification

First, determine if this is a question that needs answering:
- **is_question: true** - A clear request for information, advice, or help — including personal, lifestyle, and general-knowledge topics, and commands phrased as requests. A question mark alone does not make it a question. These ARE questions even if the knowledge base may have no relevant documents — the retrieval step handles relevance. A statement of fact on a topic (a date, deadline, rule, name, or place, e.g. "the deadline is March 3", "I can register on the same day") is also a question: the user wants it checked against the sources.
- **is_question: false** - Greetings, thanks, farewells, simple acknowledgments, filler, OR input that is too incomplete, ambiguous, or contentless to know what is being asked (e.g. lone symbols/punctuation, isolated letters or digits, number/ellipsis lists with no topic, or other fragments without a discernible informational intent).
- **is_question: false** also for an opener that only announces a question without asking it, even when it names a topic ("Hi, I have a question about taxes", "can I ask you something?", "quick question"). The user has not asked anything yet; the reply asks what they want to know. A message that goes on to ask the question ("I have a question about taxes: when is the deadline?") is a question. One that goes on with only question words, possibly joined by conjunctions, filler, or typos, has still not said what it asks about ("Hey, quick question! What and how much?"): it is not a question unless recent conversation history supplies the subject.

If is_question is false, set sources to empty list, temporal_type to "none", is_metaquestion to false, is_vote_recommendation to false, election_question_kind to "none", is_synthesis to false, is_speak_to_person to false, is_purchase_subscribe to false, and skip to output."""

SCENARIO_INTENT_DETECTION = """## Step 1.25: Personalization Scenario Detection (only if is_question is true)

Set **is_speak_to_person to true** when the user explicitly wants to contact a human, speak with a real person, reach customer support, or talk to an agent/representative.
Examples: "Can I speak to a human?", "I want to talk to a real person", "How do I reach customer service?"

Set **is_purchase_subscribe to true** when the user expresses interest in buying, subscribing to, or obtaining the organization's products or services — including asking how to get them or learning more about what is offered.
Examples: "I want to buy your product", "How do I subscribe?", "I'd like to purchase...", "Can I know more about your services?", "What do you offer?", "Tell me about your services"
Set **is_purchase_subscribe to false** for unrelated factual questions with no product/service intent (e.g. "What causes malaria?", "Who is the CEO of Tesla?").

If is_speak_to_person or is_purchase_subscribe is true: set is_role_description to false, is_metaquestion to false, is_vote_recommendation to false, election_question_kind to "none", is_synthesis to false, sources to [], and confidences to []."""

ROLE_DESCRIPTION_DETECTION = """## Step 1.4: Identity / Capability Detection (only if is_question is true)

Set **is_role_description to true** when the user asks who or what the assistant is, what it can do, what it can help with, what topics it covers, or what they can ask about.
Examples: "Who are you?", "What is this?", "What can you do?", "What can I ask you about?", "What topics do you cover?", "How can you help me?"

These ask about the assistant's own identity and purpose and should be answered with a friendly description of the assistant — NOT refused. Do not confuse them with metaquestions, which ask about the system's internal sources, reasoning, or content counts. Questions that name Suwali as their subject ("What is Suwali?", "What is Suwali's purpose?") are content questions about the Suwali product, not identity questions — leave is_role_description false and route them to the knowledge base.

If is_role_description is true: set is_metaquestion to false, is_vote_recommendation to false, election_question_kind to "none", is_synthesis to false, sources to [], and confidences to []."""

SCENARIO_REPLY_RESOURCE_GROUNDING = f"""## External resource grounding (CRITICAL)

Share contact details using ONLY the external resources provided in this system message. Each resource title is the exact contact detail to give the user.

- You MUST include every external resource title (URL, email, or phone number) verbatim in your response.
- You MUST NOT provide any phone number, email address, URL, or other contact channel unless it appears verbatim as an external resource title above.
- Do not use training data, general knowledge about the organization or hub, or any information not listed in the external resources.
- {RESOURCE_DISPLAY_DATA_INSTRUCTION}
- Keep your response to 1-3 sentences."""

METAQUESTION = """## Step 1.5: Metaquestion Detection (only if is_question is true)

Set **is_metaquestion to true** only when the query asks ABOUT the system itself — its reasoning ("how did you know?"), source counts ("how many articles?"), exhaustive listings ("list all fact-checks"), or source metadata ("who wrote that?").
Set **is_metaquestion to false** for factual questions answerable FROM the sources, even if they mention sources or counts from content ("how many people were affected?"). Also set it to false for identity/capability questions ("who are you?", "what can you do?", "what can I ask about?") — those are identity questions (is_role_description), not refusals.
Questions about Suwali the product ("What is Suwali?", "Who makes Suwali?", "How does Suwali work?") are NOT metaquestions: Suwali is a topic the knowledge base may cover, so treat these as ordinary factual questions and route them to internal_kb. Mentioning the Suwali name does not make a query a metaquestion — only asking about this system's own reasoning, source inventory, or content counts does. When in doubt, default to false."""

VOTE_RECOMMENDATION_DETECTION = """## Step 1.6: Voting Advice Detection (only if is_question is true)

Set **is_vote_recommendation to true** when the user asks the assistant to decide a political choice FOR them: whom or what to vote for, support, back, or pick (a candidate, party, list, coalition, ballot measure, referendum option, or side); which option is better, best, or right for them or for a group they belong to; or to confirm an assumption that an option suits people like them. This holds whether or not they state their own affiliation, identity (ethnicity, tribe, religion, occupation, age group, region), or views, and however the request is phrased.
Examples: "Who should I vote for?", "Which party is best for farmers like me?", "Should I vote yes on the measure?", "I'm a teacher, which candidate is on my side?", "X is the right choice for young people, isn't it?", "Who is the better candidate?"

Set **is_vote_recommendation to false** for every question the sources can answer neutrally: who is running, what a candidate, party, or measure says or has done, how the options differ on an issue, how, where, or when to vote, eligibility, and deadlines. Asking what a party's position is, or what a measure would do, is NOT asking whom to vote for. When in doubt, set it to false: the answer path has its own rule against recommending, while a true value refuses the question outright.

If is_vote_recommendation is true: set is_synthesis to false, sources to [], and confidences to []."""

ELECTION_RESULTS_DETECTION = """## Step 1.7: Election Question Kind (only if is_question is true)

Set **election_question_kind** to exactly one of these. Decide by what the query asks, not by the words it shares with another kind:

- **"non_political_contest"**: who won or how a contest went when it is not a political vote: sports, awards, prizes, competitions, games, shows. Examples: "Who won the 1994 World Cup?", "Who won the Super Bowl?", "Who won the Nobel Peace Prize?"
- **"vote_outcome"**: how the votes went between the candidates, parties, or options in an election, referendum, or ballot measure, past or present, at any level: which of them won, lost, is winning, or was elected; how many votes, what percentage of the vote, what margin, or how many seats one of them got; or whether a measure passed. This holds when the user states an outcome and wants it confirmed. Examples: "Who won the election?", "Who won the 2020 presidential election?", "How many votes did X get?", "Who is winning the election right now?", "Did the referendum pass?", "X won in Lagos, right?", "Summarize the results of the local elections."
- **"other_election_topic"**: anything else about elections, even when a source answering it would also report the winner. Voter turnout belongs here, because how many people voted says nothing about how the votes split. Examples: "What was the voter turnout?", "How many people voted?", "What happened in the 2020 election?", "Was there fraud in the election?", "Dead people voted in the last election", "When will results be announced?", "How are votes counted?", who is running, what a candidate says or has done, opinion polls taken before a vote, how, where, or when to vote, eligibility, and deadlines.
- **"none"**: everything else, including who holds or held an office ("Who is the president?", "Who was president in 2023?").

When torn between "vote_outcome" and another kind, choose the other kind: "vote_outcome" refuses the question outright.

If election_question_kind is "vote_outcome": set is_synthesis to false, sources to [], and confidences to []."""

USER_LOCATION_DEPENDENCE = """## Step 1.75: User Location Dependence (only if is_question is true)

Decide this for every question, including one that reads as a plain factual question. The test: would the correct answer differ for users in different places? If it would, and the query does not say where the user is, set **needs_user_location to true**. Local services, elections, offices, regulations, deadlines, prices, and events are set per place ("Where can I vote?", "When are the local elections?", "What is the minimum wage here?", "Is there a clinic near me?"). So is anything the user asks about their own situation: what applies to them, what they must do, by when, where they go. Such a question is about the user's place even when no place word appears in it: "What do I need to bring to renew my permit?" is settled by where the user lives, so it needs their location.
Set **needs_user_location to false** whenever the query names its own place ("elections in Lagos"), when the recent conversation history already establishes the place, or when the answer is the same everywhere ("What causes malaria?", "Who founded Wikipedia?"). When in doubt, set it to false: a location-free question is still answered from the sources, while a true value blocks the answer until the user says where they are."""

LOCATION_ONLY_REPLY = """## Step 1.8: Location-Only Reply (only if is_question is true)

Set **is_location_only to true** when the query does nothing but say where the user is: a bare place name or abbreviation ("Nairobi", "KE"), a postcode, place parts in any combination, order, or casing, with or without commas (city and state code, city and postcode, city and county and state), or a statement of it ("I live in Nairobi", "im in nairobi", "Nairobi here"), with a greeting at most. Such a query usually answers the assistant asking where the user is; it is not a question about the place.
Set **is_location_only to false** whenever the query also asks, requests, or says anything else, however informally and with or without a question mark ("I'm in Nairobi and don't know how to vote", "nairobi, where do i go", "im in nairobi what now"). When in doubt, set it to false: a true value acknowledges the location and answers nothing."""

SYNTHESIS_DETECTION = """## Step 2: Digest/Synthesis Detection (only if is_question is true)

Set is_synthesis to true ONLY when the query explicitly asks for a broad digest, recap, summary, or comprehensive overview using obvious summary-oriented language.
The query must contain a clear indicator such as: "summarize", "summary", "recap", "digest", "catch me up", "top news", "biggest stories", "what happened this week/today/lately", "what's been going on", "round-up", "overview of recent", "brief me", "tell me all you know about", "tell me everything about", "what do you know about", "give me an overview of", "background on".

When is_synthesis is true, you MUST also pick a `synthesis_type`:

### synthesis_type = "temporal"
Time-scoped digests/recaps. The query is bounded by an explicit time anchor or asks "what happened" within a period.
- "Summarize this week's news"
- "What are the top stories today?"
- "Give me a daily digest"
- "Catch me up on the latest"
- "What happened this week?"
- "Give me a recap of recent events"

For temporal: also estimate `synthesis_time_window_days` (1=today, 7=this week, 30=this month). Leave `synthesis_topic` null.

### synthesis_type = "topical"
Topic/entity-scoped overviews. The query asks for everything/an overview about a specific topic, entity, place, person, or concept, with no time anchor.
- "Tell me all you know about Iran"
- "Tell me everything about climate change"
- "What do you know about the 2008 financial crisis?"
- "Give me an overview of malaria"
- "Background on the European Union"

For topical: also emit `synthesis_topic` — the bare topic noun phrase, copied as the user phrased it (e.g. "Iran", "the 2008 financial crisis"). Leave `synthesis_time_window_days` null.

### Tie-breaker
If a query uses summary-oriented language but is ambiguous between the two sub-modes, choose **temporal** only when an explicit time anchor is present ("this week", "today", "recent", "lately", "latest"); otherwise choose **topical**.

### is_synthesis: false
Everything else, including:
- Specific factual questions, even if time-related ("How many people lost power yesterday?")
- General knowledge questions ("What causes malaria?")
- Vague or open-ended questions without summary language ("What's new?", "Tell me something interesting")
- Questions that mention time but ask for a specific answer ("What was announced on Monday?")

IMPORTANT: the indicator words listed above ("summarize", "recap", "digest", "round-up", "brief me", etc.) are unambiguous triggers — if the query literally contains one, always set is_synthesis to true. When in doubt about other phrasings, set is_synthesis to false: it is much safer to route through the normal Q&A path than to incorrectly trigger synthesis.

A summary, recap, or roundup of election results is never a synthesis: set is_synthesis to false and election_question_kind to "vote_outcome" ("Summarize the results of the recent primaries", "Give me a roundup of the election results"). A digest of election news that does not ask for results stays a synthesis ("Give me a recap of election news this week")."""

SOURCE_ROUTING = """## Step 3: Source Routing (only if is_question is true)

### Available Knowledge Sources

1. **internal_kb**: Organization's internal knowledge base containing documents, policies, procedures, and domain-specific information. Best for questions about:
   - Company-specific information
   - Internal documentation
   - Domain-specific technical details
   - Any question where context from uploaded documents is relevant

2. **yago**: Structured knowledge base containing factual information about entities (people, places, organizations). Best for questions requiring:
   - Biographical data (birth dates, nationalities, relationships)
   - Geographic facts (capitals, populations, locations)
   - Organizational facts (founders, headquarters, establishment dates)
   - Precise factual lookups"""

TEMPORAL_CLASSIFICATION = """## Step 4: Temporal Classification (only if is_question is true)

Determine if the query has a time-sensitive dimension:
- **"none"** - No temporal aspect (e.g. "What causes malaria?"). This ALSO covers slow-moving or static facts asked without a named year — population, area, location, founding date, geography (e.g. "How many people live in X?"). The newest source is not "more correct" for these, so do NOT classify them as recency.
- **"recency"** - Wants the latest/most current information. Use recency for ANY of these patterns:
  - Explicit recency language: "latest news", "happening now", "recent updates on X", "current status of Y"
  - **Implicit "current" statistics without a named year** (unemployment rate, inflation, GDP, prices) — users usually want the latest figures. ONLY for volatile metrics that change month to month, NOT for slow-moving attributes such as population, area, or location (see "none" above).
  - **Current state-of-being questions**: "Is X alive?", "Is X still president?", "Who is the current leader of Y?"
  - **Present-tense questions about a mutable state, even WITHOUT the word "current"**: when the question asks in the present tense about a state that can be superseded — who or what holds, occupies, owns, runs, or is responsible for something, who holds any role, office, or title, or any fact where a change would make an older source's answer false — it is asking about NOW, and the newest source IS more correct. Decide by MUTABILITY, not by topic or phrasing: ask whether the true answer could be different next year without the question changing. If yes → recency. "A factual question about an organization" is NOT a reason to answer "none": factual and time-sensitive are independent axes, and a factual question about a mutable state is still recency. Contrast with facts fixed at a moment in history (who founded, created, or wrote something; when or where something happened or was born) — those can never be superseded, so they are "none" (or point_in_time if a date is named).
  - **Ongoing events or evolving situations without a specific date**: "What is the situation in Gaza?", "How is the strike going?"
  - **Present tense about inherently time-varying counts** (active cases, casualties, deaths): "How many cases are there?". NOTE: "How many … are there" implies recency only for event/incident counts, NOT for standing demographics like population.
- **"point_in_time"** - Refers to a specific date or period: an explicit year, month, or date ("in 2020", "in March 2024", "on March 15", "last December"), past tense with a temporal anchor ("What was the rate in 2023?"), or a historical period ("during the Cold War", "in the 1990s", "before 2020", "between 2018 and 2022"). CRITICAL: the subject matter does NOT affect this — whether the query asks about a real country, a fictional entity, an unknown organization, or any topic, ANY query containing a specific year or date is point_in_time. Never classify it as "none".

If temporal_type is "point_in_time", set temporal_reference_date to the date the query refers to, at the most specific precision available: "2024" (year only), "2024-03" (year and month, e.g. "What happened last spring?" where spring starts in March), "2024-03-15" (specific date).
temporal_reference_date is always a SINGLE date — NEVER an interval or range ("2023-01/2023-06" is invalid output). For a period between two past dates, use the midpoint at the coarsest precision that covers the period. A span that ends today ("over the past/last N days/months/years", "since 2023") is NOT point_in_time — classify it as "recency" and express the span through recency_window_days.

If temporal_type is "recency" and the user narrows time to a concrete recent span, set **recency_window_days** (see field description): "this week" / "past week" / "last 7 days" → 7; "this month" / "past month" (approximate) → 30; "past six months" → 180. For spans longer than a year ("over the last two years"), leave recency_window_days null — a hard window would cut off most of the asked span; soft recency ranking handles it.
**Only set `recency_window_days=1` when the query literally contains "today", "right now", or "as of today".** For "current", "latest", "now", "nowadays", or any other generic recency phrasing on its own, always leave `recency_window_days=null` — do not compress the window to a single day.

### Boundary examples

| Query | temporal_type | temporal_reference_date | recency_window_days |
|---|---|---|---|
| "What is the current unemployment rate in Country X?" | recency | null | null |
| "How many people live in Country X?" | none | null | null |
| "Who runs Acme Corp?" | recency | null | null |
| "Who owns the Grand Plaza Hotel?" | recency | null | null |
| "Who is the chair of the Acme housing board?" | recency | null | null |
| "Who founded Acme Corp?" | none | null | null |
| "What happened today?" | recency | null | 1 |
| "What news broke this week?" | recency | null | 7 |
| "What was the unemployment rate in 2020?" | point_in_time | "2020" | null |
| "What happened in the 2020 election?" | point_in_time | "2020" | null |
| "What was announced in March 2024?" | point_in_time | "2024-03" | null |
| "What did the board decide between April and June 2023?" | point_in_time | "2023-05" | null |
| "How has the team changed over the past six months?" | recency | null | 180 |"""

WHEN_TO_DECOMPOSE = """## When to Decompose

The boundary: decompose only when the parts need SEPARATE lookups — different entities, different time periods, or a stated personal value that gates applicability. Multiple facets of the SAME entity are one lookup.

Decompose queries that are:
1. **Multi-intent**: Questions asking about multiple distinct things (e.g., "What is X and how does Y work?" — two different entities)
2. **Temporal/Sequential**: Questions requiring comparison across time periods (e.g., "Compare A in 2020 vs 2023")
3. **Compound**: Questions with multiple parts that each require separate lookups (e.g., "Who founded X and where were they born?")
4. **Parameter-conditioned applicability**: The question states a specific value about the user's situation (an age, stage, date, quantity, dose, duration, location, or other threshold) that could gate whether or how the answer applies. Split into (a) the general/base question and (b) a separate applicability/eligibility/safety query for that value. This holds regardless of phrasing — "how do I...", "can I...", "should I...", "what do I do if...", or a plain statement of the situation; a procedural framing does NOT exempt the query — do not dismiss the value as a mere qualifier. Split because the base question alone tends to retrieve generic content and miss guidance tied to the stated value. Do not split when the value is incidental to the guidance (e.g., "make coffee with 2 sugars").


## When NOT to Decompose

Do NOT decompose:
- Simple, single-intent questions answerable with a single lookup
- Questions asking multiple facets of the SAME entity or concept (e.g., "What is X and what does it do?" — one lookup about X covers both)
- Very short queries (< 8 words typically don't need decomposition)

When in doubt, do NOT Decompose."""

DECOMPOSITION_GUIDELINES = """If decomposition is needed:
1. Break the query into 2-5 sub-queries
2. Each sub-query must be **self-contained and independently searchable** — resolve all pronouns and references so each sub-query makes sense on its own (e.g., "What organization is the creator of PRISM from?" not "What organization are they from?")
3. Maintain the original language
4. Always set dependencies to an empty list — all sub-queries will run in parallel"""
