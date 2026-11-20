# Suwali: Frontend Service

This is the frontend service for the Suwali platform. It provides a web interface for managing content associated with knowledge hubs.

## Running locally for development

### 1. Copy environment variables

```bash
cp .env.sample .env
```

#### When adding new env variables
Make sure to also include them in `bin/docker-entrypoint.sh` (`write_runtime_config` function).

### 2. Build and run with Docker Compose

```bash
docker compose -f docker-compose-development.yml up --build
```

### 3. Access the frontend service

Point your browser to http://localhost:5173.

## Building for production

The production build uses a multi-stage Dockerfile that:
- Builds static assets with Vite
- Serves them via NGINX
- Writes runtime environment variables to `config.js` at container startup via `bin/docker-entrypoint.sh`

`VITE_API_BASE_URL` must be set as a container environment variable at deploy time (e.g. in your orchestrator or Terraform). The entrypoint refuses to start without it in non-local environments, and rejects localhost URLs so the app cannot silently fall back to a dev API in production.

### Build production image

```bash
docker build --target production -t frontend:prod .
```

### Run production image

```bash
docker run -p 80:80 \
  -e DEPLOY_ENV=prod \
  -e VITE_API_BASE_URL=https://api.example.com/api \
  -e VITE_SENTRY_DSN=your-sentry-dsn \
  -e VITE_SENTRY_ENV=production \
  -e VITE_ENABLE_ANALYTICS=true \
  --rm \
  frontend:prod
```

Or using an env file:

```bash
docker run --env-file .env -p 80:80 --rm frontend:prod
```

Access at http://localhost

## Running only linter and unit tests

```bash
docker build -t frontend .
docker run --rm frontend bin/run-linter-and-unit-tests.sh
```

## Tracking bundle size

### Manual / visual check
Every time the frontend code is built with `npm run build`, rollup will report the chunk sizes, flat and compressed. Additionally a visual treemap (`stats.html`) is generated to allow visual inpection of the largest modules (core and npm dependencies).

### CI check

If any of the flat (uncompressed) assets grow past 3,000,000 bytes (3 MB, ~1 MB compressed), the `watch:bundle-size` script in `package.json` will cause the CI to break.
