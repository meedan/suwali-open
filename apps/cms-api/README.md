# Suwali: CMS/API Service

This is the CMS/API service for the Suwali platform. It provides APIs for registration, login, content management of knowledge hubs, and handling conversations.

## Running locally for development

### 1. Copy environment variables

```bash
cp .env.sample .env
```

### 2. Set the credentials file for the Google service account

To use the Google Drive Folder source ingestor, you must have a `config/credentials.json` file for a Google service account. Either:
- Create `config/credentials.json` file manually, or
- Add it to `$GOOGLE_DRIVE_CREDENTIALS_JSON` environment variable (which will create the file automatically when Sidekiq starts).

### 3. Set the Google credentials for the Google Drive data source wizard

The wizard signs the user in with Google and lets them pick the documents to add, then creates a folder in their Drive and shares it with the service account above. It needs a Google OAuth client and a Google Picker key, which are read from `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_PICKER_API_KEY` and `GOOGLE_PICKER_APP_ID`. Add them to `.env`.

These values are exposed to the browser by `/api/about` on purpose: the Google Picker runs client-side. They grant no access on their own: the OAuth client only works from our authorized origins, and the Picker key is restricted to the Google Picker API. Do not add an HTTP referrer ("Websites") restriction to the key — Firefox does not reliably send a referrer for the Picker request, and the Picker then fails with "The API developer key is invalid". When these values are missing, the wizard tells the user that Google Drive is not available, and no Google Drive data source can be created.

### 4. Build and run with Docker Compose

```bash
docker compose -f docker-compose-development.yml up --build
```

#### Run tests while developing

```bash
$ docker compose -f docker-compose-development.yml exec -e RAILS_ENV=test cms-api bundle exec rspec
```

### 5. Health Endpoint: make sure everything is running smoothly
```bash
$ curl http://localhost:3000/health # Main application
{"status":"ok"}
$ curl http://localhost:9393/health # Sidekiq - healthcheck not available outside the Docker network
{"status":"ok"}
```

### Public URL for webhooks

Messaging integrations like Telegram, WhatsApp and SMS call the CMS API from the internet, so port 3000 must be reachable at a public HTTPS URL.

1. Expose port 3000 with a tunnel, such as `cloudflared tunnel --url http://localhost:3000` or ngrok.
2. Set `CMS_API_EXTERNAL_URL` to the tunnel's URL in `.env`, then recreate the container. Stop the stack and start it again. `make restart` does not reload `.env`.

### 6. Seeding data
We have a seeds script that creates minimal data:
- Three Hubs
  - One Hub
    - with only one user
  - Two Hubs
    - Users: multiple
    - Trusted external users: two
    - Sources: varying, with limited imported documents/articles
    - Notebooks: two
    - Notes: varying
    - Internal Message: one, incoming
    - Messaging Integration: one, non-functional

**If you want more information on each hub's data, you can look at their yaml files in [db/seeds/data](db/seeds/data)**

#### Populating everything at once
After `rake db:seed`, `rake populate_hubs` runs the three steps below in order. Each also runs on its own — see `lib/tasks/populate_hubs.rake`.

#### Adding end-user conversations
To add a partial end-user conversation, you can either use the latest snaphost in the repo, or export from staging.

- Export
  - If in development, run: `rake enduser_conversation_snapshot:export[<hub_name>,<hub_dir>]`
  - If in staging, run: `RAILS_ENV=production bundle exec rake enduser_conversation_snapshot:export[<hub_name>,<hub_dir>]`
  - Download the file from S3
  - Save it in apps/cms-api/db/seeds/data/<hub_data_directory>/enduser_conversation_snapshot
  - Important notes:
    - The export includes the topics assigned to the exported messages, and strips
      `Message#metadata["entities"]` and `["retrieved_chunks"]` — Knowledge Service debug output that
      nothing reads back and that accounts for roughly half the file size.
    - On top of the five most recently active end users, the export reaches for up to five
      conversations that contain contributions, and carries the whole four-message contribution flow.
    - The export refuses to upload if anything identifying survives masking, listing what
      escaped. See `EnduserConversationMasker.leaks`.
    - Hub names can differ between environments — pass the name as it is in the environment you
      are exporting from.
- Import
  - In development, run: `rake populate_hubs:conversations`, or
    `rake enduser_conversation_snapshot:import[<hub_name>,<hub_data_directory>]` for a single hub
  - Important notes:
    - The import uses `UPSERT`, keyed on the source environment's primary keys. If a local
      record already holds one of those ids it will be overwritten — re-run `rake db:seed` afterwards
      if a seeded external user disappears.
    - The import rewrites every timestamp so the newest lands at import time and the whole
      timeline fits the last 30 days. Ordering is preserved, and so is the timing within each
      conversation — only the long silences between conversations are compressed. This happens on
      import rather than on export so that a snapshot committed months ago still seeds
      recent-looking conversations. See `db/seeds/enduser_conversation_timeshifter.rb`.
    - Topics are matched by name in the target hub, so importing into a hub that already
      curates the same topics reuses them instead of creating duplicates.
    - Imported contributions are queued for ingestion into the Knowledge Service, and paused
      ones for topic extraction, so that service and Sidekiq need to be running. A dozen
      contributions take roughly a minute and a half to reach `complete`.
    - The import resets the id sequences for external users, conversations and messages.
      Without it the next record created locally collides.

#### Adding topic subscriptions
- Run `rake populate_hubs:topic_subscriptions`, after the conversations import has created the topics
- Subscriptions are never exported, so they are made up locally to give the hub dashboard an audience

#### Generating Top Questions
- Run `rake top_questions:backfill`

### 7. Access the CMS-API service: Manage access and create new hubs

#### Authenticate and ensure you're logged in
```bash
# get token (from response header `Authorization`)
$ curl -i -X POST -H 'Accept: application/json' -H 'Content-Type: application/json' -d '{"user":{"email":"user@example.org","password":"xyz123@@"}}' http://localhost:3000/api/login
$ curl -H 'Content-Type: application/json' -H 'Authorization: Bearer <returned above>' http://localhost:3000/api/me
{"user":{"id":1,"name":"Test User","email":"user@example.org","hubs":[{"id":1,"name":"Meedan Hub"}]}}
```

#### Create a new hub
```bash
# Open Rails Console, create a hub/organization and print the invite code
$ docker compose -f docker-compose-development.yml exec cms-api bundle exec rails c
irb> hub = Hub.create!(name: "Hub Name", organization: Organization.create!(name: "Organization Name"))
irb> puts hub.invite_code
```

### 8. Access other services

#### Swagger: API endpoints
You can try the API endpoints by going to the Swagger UI: http://localhost:3000/api-docs/index.html.

#### Mailcatcher: Check emails
You can check emails sent by the application by using [Mailcatcher](https://mailcatcher.me/). Just open http://localhost:1080 in your browser.

#### Sidekiq: Manage background jobs
You can manage Sidekiq (background jobs) through Sidekiq Web: http://localhost:3000/sidekiq.

#### Silo: Manage object store
Silo console is available at http://localhost:9001.

## Running linter, full tests and coverage

### 1. Copy environment variables

```bash
cp .env.sample .env.test
```

### 2. Build and run tests with Docker Compose

```bash
docker compose -f docker-compose-test.yml build
docker compose -f docker-compose-test.yml run cms-api bin/run-linter-and-tests-with-coverage.sh
```

## Running only linter and unit tests

### 1. Build and run tests with Docker

```bash
docker build -t suwali-cms-api .
docker run --rm -e RAILS_ENV=test suwali-cms-api bin/run-linter-and-unit-tests.sh
```
