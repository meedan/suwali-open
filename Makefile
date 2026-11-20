PROJECT_NAME = suwali
COMPOSE_FILES = -f docker-compose-development.yml -f docker-compose-development-sidekiq.override.yml
DOCKER_COMPOSE = docker compose -p $(PROJECT_NAME) $(COMPOSE_FILES)

.PHONY: up
up:
	$(DOCKER_COMPOSE) up --build --abort-on-container-exit --remove-orphans

.PHONY: up-service
up-service:
	@echo "Usage: make up-service SERVICE=<service>"
	docker compose -p $(PROJECT_NAME) -f apps/$(SERVICE)/docker-compose-development.yml up $(SERVICE) --build --abort-on-container-exit --remove-orphans

.PHONY: down
down:
	$(DOCKER_COMPOSE) down --remove-orphans

.PHONY: ps
ps:
	$(DOCKER_COMPOSE) ps

.PHONY: logs
logs:
	@echo "Usage: make logs SERVICE=<service>"
	$(DOCKER_COMPOSE) logs -f $(SERVICE)

.PHONY: build
build:
	$(DOCKER_COMPOSE) build

.PHONY: up-rebuild-cms-api
up-rebuild-cms-api:
	@echo "Rebuilds cms-api and sidekiq without cache, so pg_dump matches the Postgres server, then starts the stack."
	$(DOCKER_COMPOSE) build --no-cache cms-api sidekiq
	./scripts/build-and-run.sh

.PHONY: restart
restart:
	$(DOCKER_COMPOSE) restart

.PHONY: bash
bash:
	@echo "Usage: make bash SERVICE=<service>"
	$(DOCKER_COMPOSE) exec $(SERVICE) bash

.PHONY: rspec
rspec:
	@echo "Usage: make rspec OR make rspec TEST_PATH=<path/to/spec_file_or_directory>"
	$(DOCKER_COMPOSE) exec cms-api bundle exec rspec $(TEST_PATH)

.PHONY: rake
rake:
	@echo "Usage: run rake task TASK=<task_name>"
	$(DOCKER_COMPOSE) exec cms-api bundle exec rake $(TASK)

.PHONY: npm-linter
npm-linter:
	@echo "Usage: Run linter in frontend"
	$(DOCKER_COMPOSE) exec frontend npm run lint

