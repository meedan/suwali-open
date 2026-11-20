#!/bin/bash
set -e
uv run ruff format .
uv run ruff check --select I --fix .
uv run ruff check .
uv run mypy .
uv run pytest -m "not integration" -s --cov=. --cov-report=term-missing --cov-config=pyproject.toml
