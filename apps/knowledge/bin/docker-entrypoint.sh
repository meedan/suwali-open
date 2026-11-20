#!/bin/bash
set -e

# We could ensure here that all required environment variables are set

# If no command is passed, assume starting the Python server
if [ $# -eq 0 ]; then
  # Download models
  python init_models.py

  if [ "${DEPLOY_ENV}" = 'local' ]; then
    echo "Starting Python server for development..."
    exec uvicorn app.main:app --host 0.0.0.0 --port "${KNOWLEDGE_API_PORT:-8000}" --reload
  else
    echo "Starting Python server for $DEPLOY_ENV..."
    exec gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:${KNOWLEDGE_API_PORT:-8000} --timeout 600 --keep-alive 5
  fi
else
  # Execute the passed command (e.g., test runner)
  # We could add argument handling here (run different commands based on the argument)
  echo "Executing custom command: $@"
  exec "$@"
fi
