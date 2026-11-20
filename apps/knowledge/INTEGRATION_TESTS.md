# Integration Tests

This document describes how to run integration tests for the Knowledge Service.

## Overview

Integration tests validate the entire system working together:
- FastAPI web service
- RQ worker for async job processing
- Redis for job queue
- Neo4j for knowledge graph storage

## Prerequisites

1. **Docker and Docker Compose** installed
2. **Environment variables** configured:
   ```bash
   # Create .env.integration file for integration test configuration
   cp .env.sample .env.integration

   # Edit .env.integration and add your OpenAI API key
   # OPENAI_API_KEY=sk-your-api-key-here
   ```

   Required variables in `.env.integration`:
   - `OPENAI_API_KEY` - Required for LLM operations
   - `NEO4J_PASSWORD` - Neo4j authentication password
   - `NEO4J_HUB_CONFIG` - JSON configuration for Neo4j hub connections
   - `NEO4J_URI` - Direct Neo4j connection URI (only needed for integration tests)
   - `NEO4J_USERNAME` - Neo4j username (only needed for integration tests)

   See `.env.sample` for comments on which variables are specific to integration tests.

## Running Integration Tests

### Quick Start

Run the integration test suite with a single command:

```bash
bin/run-integration-tests.sh
```

This script will:
1. Build fresh Docker images (no cache)
2. Start all required services (Redis, Neo4j, Knowledge API, RQ Worker)
3. Wait for services to be healthy
4. Execute the integration test suite
5. Capture all logs to `test-logs/integration_test_<timestamp>.log`
6. Shut down and remove all containers and volumes
7. Exit with the test exit code (0 for success, non-zero for failure)

### Manual Test Execution

If you need more control, you can run the services manually:

```bash
# Start dependency services first
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml up -d redis neo4j

# Start application services
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml up -d knowledge rq_worker

# Run tests
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml run --rm test-runner

# View logs
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml logs

# Clean up
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml down -v --remove-orphans
```

### Running Tests Locally (without Docker)

You can also run integration tests against locally running services:

```bash
# Ensure services are running (Redis, Neo4j, Knowledge API, RQ Worker)
# Then run:
uv run pytest -m integration -vv
```

Note: You'll need to update the connection settings in `tests/test_integration.py` to match your local setup.

## Test Logs

All test execution logs are saved to `test-logs/` directory with timestamps:
- `test-logs/integration_test_YYYYMMDD_HHMMSS.log`

These logs include:
- Service startup logs
- Test execution output
- All container logs from Redis, Neo4j, Knowledge API, and RQ Worker
- Shutdown and cleanup logs

## Test Architecture

The integration test setup uses a **composable Docker Compose configuration**:

- **Base**: `docker-compose-development.yml` - Defines core service structure
- **Override**: `docker-compose-integration.yml` - Adds test-specific optimizations

When composed together with `-f docker-compose-development.yml -f docker-compose-integration.yml`, the override file applies test-optimized settings to the base services.

### Services

1. **redis** - Redis 7 for job queue
   - **Ephemeral storage (tmpfs)** - Data stored in RAM, auto-cleaned on shutdown
   - Fast health checks (5s interval)
   - No persistent volumes in test mode

2. **neo4j** - Neo4j Community with plugins
   - **Ephemeral storage (tmpfs)** - Both data and logs in RAM
   - Optimized memory settings for faster startup (256M pagecache, 512M heap)
   - Plugins: APOC, GenAI, Graph Data Science
   - Enhanced health check verifies both HTTP and Bolt connectivity
   - No persistent volumes in test mode

3. **knowledge** - Knowledge API service
   - Runs on port 8000
   - Test-optimized health checks (10s interval)
   - Connected to test Redis and Neo4j
   - Environment: `DEPLOY_ENV=staging`, reduced worker count

4. **rq_worker** - RQ Worker for async jobs
   - Health check endpoint on port 8001
   - Processes document ingestion jobs
   - Test-optimized settings

5. **test-runner** - Pytest test executor
   - Runs integration test suite marked with `@pytest.mark.integration`
   - Exits after tests complete
   - Mounts local directory to preserve test outputs

### Key Features

- **Tmpfs mounts**: Redis and Neo4j use in-memory storage for speed and automatic cleanup
- **Override pattern**: Test settings override development configuration without duplication
- **Shared network**: All services communicate on the `dev` network
- **Health checks**: Ensures services are ready before running tests
- **Automatic cleanup**: Tmpfs data auto-removed when containers stop
- **Log preservation**: Complete logs saved to local filesystem
- **Isolated project**: Uses `-p test` project name to avoid conflicts with development containers

### Configuration Override

The `docker-compose-integration.yml` file uses Docker Compose's merge behavior to:
- Clear persistent volumes with `volumes: !reset []`
- Add tmpfs mounts for ephemeral storage
- Optimize health check intervals for faster test startup
- Set test-specific environment variables
- Add the `test-runner` service

## Test Coverage

The integration test suite (`tests/test_integration.py`) covers:

1. **Health checks** - FastAPI and RQ Worker health endpoints
2. **Document ingestion** - Upload and process documents
3. **Update handling** - Re-ingesting same document (no duplicates)
4. **RAG pipeline** - Question answering with context retrieval
5. **Conversation history** - Multi-turn conversations with query rewriting
6. **Document deletion** - Remove documents and verify cleanup
7. **Error handling** - Invalid job IDs, non-existent documents
8. **Scenario intent routing** (`tests/test_integration_scenario_intent.py`) - `/chat` with personalization external resources for `speak_to_person` and `purchase_subscribe` in `en`, `ar`, `fr`, `pt`, `es`, and `hi`; no document ingestion required
9. **Summarize prompt-injection** (`tests/test_integration_summarize_prompt_injection.py`) - Verify that `/summarize/` and chat synthesis treat input as untrusted data. Chat synthesis uses hub 4 (`SUMMARIZER_INJECTION_HUB_ID`) so topical retrieval is not mixed with hub 1's corpus.
10. **Query decomposition** (`tests/test_integration_decomposition.py`) - Multi-intent and mixed-success `/chat` paths: both sub-queries answered, partial synthesis, both failed, and a simple query that must not decompose.

## Troubleshooting

### Services not starting

Check service health:
```bash
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml ps
```

View service logs:
```bash
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml logs <service-name>
```

### Test failures

1. Check logs: `tail -f test-logs/integration_test_*.log`
2. Verify `OPENAI_API_KEY` is set correctly in `.env.integration`
3. Verify `NEO4J_PASSWORD` matches between `.env.integration` and `NEO4J_HUB_CONFIG`
4. Ensure no port conflicts (8000, 8001, 7474, 7687, 6379)
5. Verify `.env.integration` file exists and contains all required variables
6. **Common issue**: Ensure `NEO4J_HUB_CONFIG` uses `bolt://neo4j:7687` (Docker service name), not `bolt://localhost:7687`. The integration tests run in isolated Docker containers that cannot access localhost.

### Cleanup issues

Force cleanup:
```bash
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml down -v --remove-orphans
docker system prune -f
```

### Validate configuration

Check the merged configuration:
```bash
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml config
```

## CI/CD Integration

To run integration tests in CI/CD pipelines:

```bash
# Example GitHub Actions
- name: Run Integration Tests
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: |
    cd apps/knowledge
    bin/run-integration-tests.sh
```

The script exits with the pytest exit code, making it suitable for CI/CD integration.

## Advanced Usage

### Running specific tests

```bash
# Run a specific test file
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml run --rm test-runner \
  sh -c "pytest tests/test_integration.py::test_health_check -vvv"

# Run with custom pytest flags
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml run --rm test-runner \
  sh -c "pytest -m integration --tb=short -k 'not slow'"
```

### Inspecting running containers

```bash
# Access Neo4j browser
open http://localhost:7474

# Access Knowledge API docs
open http://localhost:8000/docs

# Shell into a container
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml exec knowledge bash
```

### Keeping containers running after tests

```bash
# Start services without running tests
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml up -d redis neo4j knowledge rq_worker

# Manually run tests when ready
docker compose -p test -f docker-compose-development.yml -f docker-compose-integration.yml run --rm test-runner
```
