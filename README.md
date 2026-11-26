# Suwali

Welcome to the **Suwali** monorepo. This platform enables partner organizations (such as CSOs and newsrooms) to create and manage localized knowledge hubs enriched by automated data ingestion and community engagement through conversational interfaces.

## Monorepo Structure

```
suwali/
├── apps/
│   ├── frontend/                  # Web client
│   ├── knowledge/                 # AI/ML service
│   └── cms-api/                   # Ruby On Rails API-only app (core backend + messaging)
├── docs/                          # Project documentation
├── scripts/                       # Dev automation scripts
└── docker-compose-development.yml # Docker Compose file to run the whole application locally
```

## Quick Start
*Note: For more details, see `README.md`'s inside each service under `apps/`.*

#### You will need
1. Docker Compose v2.20+.
  - On a Mac, we recommend [OrbStack](https://orbstack.dev) over Docker Desktop: it is generally faster.
  - On Apple Silicon, the `signal-cli` service runs as amd64 under emulation, so keep Rosetta for amd64 emulation enabled.
2. Google service account credentials, for the Google Drive data source. Either:
    - Create `config/credentials.json` file manually, or
    - Add it to `$GOOGLE_DRIVE_CREDENTIALS_JSON` environment variable (which will create the file automatically when Sidekiq starts).
3. Google credentials for the Google Drive data source wizard:
  - Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_PICKER_API_KEY` and `GOOGLE_PICKER_APP_ID` in `apps/cms-api/.env`.
  - Without them, Google Drive data sources cannot be created.
4. An Amazon Bedrock API key for the embedding model:
  - Set `AWS_BEARER_TOKEN_BEDROCK` in `apps/knowledge/.env`.
5. OpenAI API key:
  - Create one from https://platform.openai.com/api-keys,
  - Add it to `apps/knowledge/.env`.
6. Publicly reachable CMS API instance, for messaging webhooks:
  - Start the stack with `./scripts/build-and-run.sh`.
  - Expose port 3000 at a public HTTPS URL with a tunnel, such as [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) (`cloudflared tunnel --url http://localhost:3000`) or ngrok.
  - Set `CMS_API_EXTERNAL_URL` to that URL in `apps/cms-api/.env`. Recreate the `cms-api` container so it picks up the new value: stop the stack and start it again. `make restart` reuses the existing environment and is not enough.
7. For local development, all the other values from the `.env` files can be used from the respective sample files.

#### Build and run the APP
```bash
git clone https://github.com/meedan/suwali-open.git suwali
cd suwali
./scripts/build-and-run.sh
```

#### Stop the APP
```bash
./scripts/stop-all.sh
```

#### Delete and start over
If you want to delete all your local data and start over, you can run:

```bash
./scripts/reset-data.sh
./scripts/build-and-run.sh
```

#### Makefile
We also have a Makefile with a few docker compose commands for convenience, e.g.:

```bash
# stream a service's logs
make logs SERVICE=<service>

# exec into a service's bash
make bash SERVICE=<service>

# rebuild cms-api and sidekiq without cache, then start the stack (e.g. when a schema dump warns pg_dump does not match Postgres)
make up-rebuild-cms-api
```

#### Login
After building and running, you should be able to access the application interface at http://localhost:5173.

Our seed script creates 3 different hubs:
1. one that has only one user, and is empty,
2. two that have a few users and minimal data.

The script prints each hub's users' username and password.
Here are some credentials examples:
- **Hub 1 – Username:** `francis@example.org`
- **Hub 2 – Username:** `user@example.org`
- **Hub 3 – Username:** `laxmi@example.org`
- **Password:** `xyz123@@`

For more information on seeding go to the [CMS-API README](apps/cms-api/README.md).

#### Open a Bash session
You can open a Bash session in any running container this way: `docker compose -p suwali -f docker-compose-development.yml exec <name> bash`, where `<name>` can be `cms-api`, `frontend`, `knowledge`, etc.

###  Run End-to-End Integration Tests

#### 1. On CI

To run end-to-end integration tests on CI, add `[integration]` to your Git commit message.

#### 2. Locally

##### 2.1. Start the test environment

From the repository root, run:

```bash
./scripts/build-and-run.sh test
```

This command builds and starts the required containers, including the Playwright environment.

##### 2.2. Run the tests

Once the containers are up, open a shell inside the Playwright container:

```bash
docker exec -it suwali_playwright bash
```

Then run the tests:

```bash
npx playwright test
```

##### 2.3. (Optional) Watch the tests running via VNC

You can watch the browser activity in real-time using a VNC client (e.g., Remmina, RealVNC, or TigerVNC):

| Setting      | Value       |
| ------------ | ----------- |
| **Host**     | `localhost` |
| **Port**     | `5900`      |
| **Password** | `vncpass`   |

## Translation Worflow

The `crowdin-sync` GitHub Action pushes the localization sources to Crowdin and also downloads existing translations and creates a PR targeting `main` branch. It runs when the translation sources are updated on `main` or manually from the Actions tab in the github repo page.

Localization sources and translations are mapped in `crowdin.yml` in the suwali repo root.

See the [Translation Workflow Diagram](docs/translation-cycle.mermaid)

## Adding a New Supported Language

### Frontend

**`src/components/LanguageProvider.tsx`:**
- Import the translation file (e.g., `import fr from '@lang/fr.json';`)
- Add the locale code to the `supportedLocales` array
- Add it to the `messagesMap` object
- If RTL, update `isRTL()` to handle it (sets `document.documentElement.dir` accordingly)

**`src/ui-components/input/LanguageSelect.tsx`:**
- Add a `<SelectItem>` for the new language in the dropdown

### CMS API

**Crowdin setup (translation pipeline):**
1. Add the new locale to the Crowdin project settings
2. Add the new locale to the `crowdin-sync` GitHub Action configuration
3. Make a PR (#1) adding any new YAML files under `config/locales/` (files can't be empty — use a placeholder, e.g., `fr: {}`)
4. After PR (#1) is merged, trigger the `crowdin-sync` action — this generates translations and creates a new PR (#2)
5. Review and merge PR (#2)

**After translations are in place:**
- Add the new locale and its native display name to `config/initializers/languages.rb` (`SUPPORTED_LANGUAGES` hash) — this is the single source of truth that also sets `config.i18n.available_locales` automatically
- Update the string `mailer_hub_trial_halfway_body`
- If needed, add a mapping to `WhatsappMessagingIntegration::TEMPLATE_LANGUAGE_CODES`
- Run rake task to submit WhatsApp templates for new language

### Knowledge Service

- Add the language code to `app/core/config.py` (`supported_languages` default list)
- Add the language code and native name to `app/services/language/__init__.py` (`LANGUAGE_NAMES` dict)

---

## Documentation

The Suwali platform follows a cyclical knowledge flow that combines organizational expertise with community contributions:

[High-level Diagram](docs/high-level-diagram.mermaid)

1. **Hub Configuration & Data Ingestion**
  - Partner organizations (CSOs, local newsrooms, etc.) create isolated workspaces ("hubs")
  - Partners connect multiple data sources (websites, RSS feeds, Google Drive folders, documents)
  - System automatically extracts, processes, and indexes all content from connected sources, regularly
  - Each hub maintains a separate knowledge base tailored to its specific community

2. **Community Interaction**
  - Community members access knowledge through conversational chatbots
  - Chatbots are available through familiar messaging platforms (WhatsApp, Telegram, Messenger, etc.)
  - Questions are processed against the hub's knowledge base to provide relevant answers
  - All interactions are tracked to identify knowledge gaps, unanswered questions and common questions

3. **Knowledge Enrichment**
  - Community members can submit corrections, additions, or new information
  - Contributions create a feedback loop that improves the knowledge base
  - System captures these contributions and routes them to partners for review
  - This creates a "living" knowledge ecosystem that evolves over time

4. **Editorial Governance**
  - Partners maintain quality control through moderation/editoral workflows
  - Approved contributions are integrated into the hub's knowledge base
  - Partners can implement various governance models:
    - Editorial review processes
    - Community moderation systems
    - Contributor reputation tracking
    - Trusted user privileges
    - Etc.
  - Analytics provide insights on content quality and community engagement

## Core System Components

### Client Layer
- **Frontend**: Web client
 - Provides interfaces for partner administrators to manage knowledge hubs
 - Handles content moderation interfaces and approval workflows (or editorial workflows)
 - Displays analytics dashboards and system insights
 - Offers configuration tools for chatbots and data sources

### Backend Layer (CMS / API service)
**Content Management System**: Application serving as the central coordinator
 - Manages workspaces/hubs, content, users, permissions, and settings
 - Exposes API for frontend communication
 - Orchestrates data extraction from external sources
 - Handles authentication and authorization
 - Stores core application data

**Messaging Module**:
 - Integrates with various messaging platforms (WhatsApp, Telegram, Messenger, etc.)
 - Routes messages between community users and the knowledge system
 - Maintains conversation context and user sessions
 - Stores conversation history for reference
 - Handles message formatting for different platforms
 - (Future) Integration with Chatwoot or similar for human escalation

**Data Insights Module**:
 - Collects and analyzes system usage statistics
 - Tracks community engagement metrics
 - Monitors content quality and contribution patterns
 - Provides feedback on knowledge gaps and popular topics
 - Generates reports for partner organizations

### Backend Layer (Knowledge service)
- **AI Service**:
 - Manages the RAG (Retrieval-Augmented Generation) pipeline
 - Handles text vectorization and embedding creation
 - Performs semantic search across knowledge bases
 - Maintains knowledge graphs
 - Communicates with LLM services for response generation
 - Stores and retrieves vector embeddings from specialized databases

## System Workflows

### Hub Creation and Configuration
1. Partner administrators access the Frontend to create a new knowledge hub
2. Partners configure data source connections (websites, RSS feeds, documents, Google Drive, etc.)
3. CMS stores configuration settings
4. CMS initiates data extraction processes for the configured sources
5. AI Service consumes and processes the data:
  - Chunks content into appropriate segments
  - Creates vector embeddings of text chunks
  - Updates knowledge graph with new relationships
  - Indexes content for retrieval

### Community Question Answering
1. Community members submit questions via messaging platforms (WhatsApp, Telegram, etc.)
2. Messaging module receives the question and identifies the appropriate hub/workspace
3. CMS routes the query to the AI Service
4. AI Service processes the query:
  - Converts question to vector embedding
  - Performs similarity search to find relevant context
  - Retrieves knowledge graph relationships
  - Sends context and question to LLM Service
  - Receives and formats answer
5. Response returns through the Messaging module to the community member
6. Conversation history is stored for context maintenance and analytics

### End-User Contribution
1. Community members submit corrections, additions, or new information via messaging platforms
2. Messaging module captures the contribution and routes it to the hub team
3. Partner administrators are notified of pending contributions
4. Using the Frontend, administrators review, edit, and approve/reject contributions
5. Approved contributions are:
  - Stored in the database as verified knowledge
  - Queued for processing by the AI Service
  - Integrated into the knowledge base
7. Data Insights Module updates statistics on community contributions

### Partner Analytics and Management
1. Partners access the Frontend to view system analytics
2. Data Insights Module provides metrics on:
  - Question volumes and topics
  - Response quality (via user feedback)
  - Community contribution patterns
  - Knowledge gap identification
3. Partners can use these insights to:
  - Update configuration settings
  - Prioritize content additions
  - Identify valuable community contributors
  - Optimize chatbot performance

---

## Troubleshooting

### Running a Cypher query against Neo4j

Open a `cypher-shell` session against the local Neo4j instance:

```bash
docker compose -p suwali -f docker-compose-development.yml exec neo4j cypher-shell -u neo4j
```

You'll be prompted for the password. Once connected, type your query ending with a semicolon (`;`) and press Enter to run it.

### Normalize legacy String `published_at` before Cypher temporal comparisons

**Issue:** Some `Chunk_*` nodes have `published_at` stored as a `String` instead of a `datetime`, which breaks Cypher temporal comparisons.

**Solution:** Run the following query to convert legacy string values to proper `datetime` values (or `null` for empty strings):

```cypher
MATCH (n)
WHERE any(label IN labels(n) WHERE label STARTS WITH 'Chunk_')
  AND n.published_at IS NOT NULL
  AND n.published_at IS :: STRING
SET n.published_at =
  CASE
    WHEN trim(n.published_at) = '' THEN null
    ELSE datetime(n.published_at)
  END
RETURN count(n) AS updated_nodes;
```

## Contributing

We don't accept pull requests at the moment. To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2025 Meedan.

Suwali is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License, version 3. See [LICENSE](LICENSE).
