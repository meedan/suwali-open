#!/bin/bash
set -e

# We could ensure here that all required environment variables are set

# Map DEPLOY_ENV to RAILS_ENV if needed
if [ -z "$RAILS_ENV" ]; then
  case "$DEPLOY_ENV" in
    ci)
      export RAILS_ENV=test
      ;;
    local)
      export RAILS_ENV=development
      ;;
    *)
      export RAILS_ENV=production
      ;;
  esac
else
  echo "RAILS_ENV is already set to '$RAILS_ENV'; skipping DEPLOY_ENV mapping."
fi
echo "Using RAILS_ENV=$RAILS_ENV"
echo "Using DEPLOY_ENV=$DEPLOY_ENV"

if [ "$RAILS_ENV" != "test" ]; then
  echo "Checking for config/credentials.json for Google Drive integration..."
  ./bin/ensure-google-config.sh
fi

# Take actions based on application name
if [ "${APP}" == "cms-api-worker" ]; then
  echo "Starting Sidekiq..."
  ./bin/start-sidekiq.sh
fi

# If no command is passed, assume starting the Rails server
if [ $# -eq 0 ]; then
  # Run DB migrations and other setup
  bundle exec rails db:prepare
  bundle exec rails db:seed

  if [ "${DEPLOY_ENV}" = 'local' ] || [ "${RAILS_ENV}" = 'development' ]; then
    # Remove a potentially pre-existing server.pid
    rm -f /app/tmp/pids/server.pid

    echo "Starting Rails server for development..."
    exec bundle exec rails server -b 0.0.0.0 -p "${CMS_API_PORT:-3000}"
  else
    # Remove a potentially pre-existing server.pid
    rm -f /app/tmp/pids/server.pid

    echo "Starting Rails server for $DEPLOY_ENV..."
    exec bundle exec puma -C config/puma.rb
  fi
else
  # Execute the passed command (e.g., test runner, rake task)
  # We could add argument handling here (run different commands based on the argument)
  echo "Executing custom command: $@"
  exec "$@"
fi
