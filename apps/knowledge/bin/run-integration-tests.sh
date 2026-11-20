#!/bin/bash

# Script to run integration tests using composed Docker Compose files
# Usage: ./bin/run-integration-tests.sh [--with-yago]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# explicitly passing "--with-yago" enables the YAGO Neo4j container
YAGO_FLAG=""
YAGO_COMPOSE=""
for arg in "$@"; do
  case $arg in
    --with-yago)
      YAGO_FLAG="--profile yago"
      YAGO_COMPOSE="-f docker-compose-integration-yago.yml"
      ;;
  esac
done

# Configuration
PROJECT_NAME="test"
COMPOSE_FILES="-f docker-compose-development.yml -f docker-compose-integration.yml $YAGO_COMPOSE $YAGO_FLAG"
LOG_DIR="./test-logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_DIR}/integration_test_${TIMESTAMP}.log"

# Create log directory if it doesn't exist
mkdir -p "${LOG_DIR}"

echo -e "${YELLOW}Starting integration test environment...${NC}"

# Clean up function
cleanup() {
    echo -e "\n${YELLOW}Capturing final logs...${NC}"

    # Capture logs from all services
    docker compose -p "${PROJECT_NAME}" ${COMPOSE_FILES} logs > "${LOG_FILE}" 2>&1 || true

    echo -e "${YELLOW}Shutting down test environment...${NC}"
    docker compose -p "${PROJECT_NAME}" ${COMPOSE_FILES} down -v --remove-orphans 2>&1 | tee -a "${LOG_FILE}"

    echo -e "${GREEN}Logs saved to: ${LOG_FILE}${NC}"
}

# Set up trap to ensure cleanup runs even if script fails
trap cleanup EXIT

# Check if .env.integration file exists
if [ ! -f .env.integration ]; then
    echo -e "${RED}Error: .env.integration file not found${NC}"
    echo "Please create a .env.integration file with required environment variables (especially OPENAI_API_KEY)"
    exit 1
fi

echo -e "${YELLOW}Building services...${NC}"
docker compose -p "${PROJECT_NAME}" ${COMPOSE_FILES} build --no-cache

echo -e "\n${GREEN}Starting services and running integration tests...${NC}\n"

# only needed for benchmark reporting but simplest to run it always
export GIT_COMMIT_HASH=$(git rev-parse --short HEAD)
export GIT_COMMIT_MESSAGE=$(git log -1 --format=%s)
export GIT_REPO_DIRTY=$(git diff --quiet HEAD)

# Run the test-runner service and capture exit code
set +e
docker compose -p "${PROJECT_NAME}" ${COMPOSE_FILES} run --rm \
    -e GIT_COMMIT_HASH="${GIT_COMMIT_HASH}" \
    -e GIT_COMMIT_MESSAGE="${GIT_COMMIT_MESSAGE}" \
    -e GIT_DIRTY="${GIT_DIRTY}" \
    test-runner
TEST_EXIT_CODE=$?
set -e

echo -e "\n${YELLOW}Test execution completed with exit code: ${TEST_EXIT_CODE}${NC}"

# Print summary
if [ ${TEST_EXIT_CODE} -eq 0 ]; then
    echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ Integration tests PASSED${NC}"
    echo -e "${GREEN}═══════════════════════════════════════${NC}\n"
else
    echo -e "\n${RED}═══════════════════════════════════════${NC}"
    echo -e "${RED}  ✗ Integration tests FAILED${NC}"
    echo -e "${RED}═══════════════════════════════════════${NC}\n"
fi

exit ${TEST_EXIT_CODE}
