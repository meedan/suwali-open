FROM node:24-slim

# Install NGINX and curl for health checks
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y nginx curl libcap2-bin && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Use UID 1000 for bind-mount compatibility; chown only specific paths to keep it fast.
RUN sed -i -e '/^user /d' -e 's|^pid .*|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf && \
    chown node:node /app \
      /usr/share/nginx/html /usr/share/nginx/html/index.html \
      /etc/nginx/sites-available/default \
      /var/lib/nginx /var/log/nginx/access.log /var/log/nginx/error.log

# Let non-root NGINX bind port 80. Local Docker allows it via ip_unprivileged_port_start=0; Fargate does not.
RUN setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx

COPY bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# 0755, not +x: COPY preserves the source mode, which depends on the dev's umask.
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

USER node

COPY --chown=node:node package.json package-lock.json* ./
RUN npm install

COPY --chown=node:node . .

ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE

ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV VITE_SENTRY_RELEASE=$SENTRY_RELEASE

RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    npm run build

# Copy built static files for production serving
RUN cp -r dist/* /usr/share/nginx/html/

# Copy NGINX configurations
COPY nginx-local.conf /etc/nginx/nginx-local.conf
COPY nginx.conf /etc/nginx/nginx-prod.conf
COPY nginx_security_headers.conf /etc/nginx/security-headers.conf

EXPOSE 80

# Health check for container orchestration (ECS)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
