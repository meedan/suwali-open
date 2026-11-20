FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# Install OS packages
RUN apt-get update -qq && \
    apt-get upgrade -y && \
    apt-get install -y build-essential curl ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set working dir
WORKDIR /app

# nltk data lives where init_models.py downloads it; without this, chat-only
# workers never register the path and punkt_tab lookups fail
ENV NLTK_DATA=/app/.models

# Place venv outside /app so volume mounts don't clobber it
ENV UV_PROJECT_ENVIRONMENT=/opt/venv

# Create the non-root user before copying anything so COPY --chown can set
# ownership inline instead of a slow recursive chown at the end. /app and
# /opt/venv are still empty here, so chowning them (not -R) is cheap; app
# then owns both and can run uv sync itself below with no chown needed after.
RUN groupadd --system app && \
    useradd --system --gid app --home-dir /app --no-create-home app && \
    mkdir -p /opt/venv && \
    chown app:app /app /opt/venv

COPY bin/docker-entrypoint.sh /usr/bin/
# Absolute mode, not +x: the source file's permissions (which COPY preserves)
# depend on the checking-out user's umask and may deny read/execute to non-owners.
# Copied and chmod'd as root, before the USER switch below, since chmod needs
# ownership of the file and doesn't depend on the app source being present yet.
RUN chmod 0755 /usr/bin/docker-entrypoint.sh

USER app

# Install dependencies (including dev dependencies to support development tools)
COPY --chown=app:app pyproject.toml uv.lock ./

# Install dependencies only (project source isn't available yet). Runs as the
# app user so /opt/venv is created with correct ownership, no chown needed.
# Use uv.lock as the source of truth: https://docs.astral.sh/uv/reference/cli/#uv-run--frozen
ENV UV_HTTP_TIMEOUT=300
RUN uv sync --no-cache --frozen --group dev --no-install-project

ENV PATH="/opt/venv/bin:$PATH"

# Copy entire app (volume mount can override for hot reload)
COPY --chown=app:app . .

# Install the project itself now that source is available
RUN uv sync --frozen --group dev

ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
