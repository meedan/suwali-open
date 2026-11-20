#!/bin/sh
set -e

# Write runtime environment variables to an external config.js (CSP-friendly).
write_runtime_config() {
  local html_root="$1"
  local config_file="${html_root}/config.js"

  if [ -z "$VITE_API_BASE_URL" ]; then
    echo "ERROR: VITE_API_BASE_URL must be set for DEPLOY_ENV=$DEPLOY_ENV" >&2
    exit 1
  fi

  case "$VITE_API_BASE_URL" in
    *localhost*)
      echo "ERROR: VITE_API_BASE_URL must not point to localhost in $DEPLOY_ENV (got $VITE_API_BASE_URL)" >&2
      exit 1
      ;;
  esac

  CONFIG_JSON=$(cat <<EOF
{"VITE_API_BASE_URL":"${VITE_API_BASE_URL}","VITE_SENTRY_DSN":"${VITE_SENTRY_DSN}","VITE_SENTRY_ENV":"${VITE_SENTRY_ENV}","VITE_SENTRY_RELEASE":"${VITE_SENTRY_RELEASE}","VITE_ENABLE_ANALYTICS":"${VITE_ENABLE_ANALYTICS}","VITE_MIN_TOPIC_SUBSCRIBERS":"${VITE_MIN_TOPIC_SUBSCRIBERS}"}
EOF
)

  printf 'window.CONFIG = %s;\n' "$CONFIG_JSON" > "$config_file"
  echo "Wrote runtime config to $config_file"
}

if [ $# -eq 0 ]; then
  if [ "$DEPLOY_ENV" = "local" ]; then
    echo "Starting application for local development..."

    # Use local nginx config (proxy to Vite dev server)
    cp /etc/nginx/nginx-local.conf /etc/nginx/sites-available/default

    # Start NGINX in the background (proxy to Node.js dev server)
    echo "Starting NGINX proxy..."
    nginx -g 'daemon off;' &

    # Start Node.js dev server in the foreground
    echo "Starting Vite dev server..."
    exec npm run dev
  else
    echo "Starting application for $DEPLOY_ENV..."

    # Use production nginx config (serve static files)
    cp /etc/nginx/nginx-prod.conf /etc/nginx/sites-available/default

    write_runtime_config "/usr/share/nginx/html"
    exec nginx -g 'daemon off;'
  fi
else
  # Execute the passed command (e.g., test runner)
  echo "Executing custom command: $@"
  exec "$@"
fi
