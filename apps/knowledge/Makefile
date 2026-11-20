.PHONY: install run run-rq test
.DEFAULT_GOAL := run

install:
	uv sync
	uv run python init_models.py

run:
	uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

run-rq:
	uv run python rq_worker.py

test:
	uv run ruff format .
	uv run ruff check --select I --fix .
	uv run ruff check .
	uv run mypy .
	uv run pytest -m "not integration" --cov=. --cov-report=term-missing --cov-config=pyproject.toml

integration:
	uv run pytest -m integration -vv
