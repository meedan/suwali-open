# TODO for production:
# - Start production server by default

FROM ruby:3.3.10

# Install OS packages including ca-certificates (needed for staging/production)
RUN apt-get update -qq && \
    apt-get upgrade -y && \
    apt-get install -y build-essential ca-certificates curl gnupg lsb-release && \
    rm -rf /var/lib/apt/lists/*

# Install PostgreSQL Client 17, same version as PostgreSQL container
# Most useful for using pg_dump to generate db/structure.sql
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg && \
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
    https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
  apt-get update && \
  apt-get install -y libpq-dev postgresql-client-17 && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

# Download and install RDS CA certificate bundle (needed for staging/production)
RUN curl -o /usr/local/share/ca-certificates/rds-ca-2019-root.pem \
    https://truststore.pki.rds.amazonaws.com/eu-west-1/eu-west-1-bundle.pem && \
    update-ca-certificates

# Set working dir
WORKDIR /app

# uid 1000 to match the host user on Linux bind mounts; before the gems so the chown is cheap.
RUN groupadd --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home && \
    chown -R rails:rails /app /usr/local/bundle

COPY bin/docker-entrypoint.sh /usr/bin/
# 0755, not +x: COPY preserves the source mode, which depends on the dev's umask.
RUN chmod 0755 /usr/bin/docker-entrypoint.sh

USER rails

# Install gems
COPY --chown=rails:rails Gemfile* ./
ARG BUNDLE_WITHOUT=""
ARG BUNDLE_FROZEN=""

ENV BUNDLE_WITHOUT=${BUNDLE_WITHOUT}
ENV BUNDLE_FROZEN=${BUNDLE_FROZEN}
ENV BUNDLE_NO_DOCUMENT=true
RUN gem install bundler -v 2.4.10 --no-document && bundle install --jobs 4

# Copy entire app (volume mount can override for hot reload)
COPY --chown=rails:rails . .

ENTRYPOINT ["/usr/bin/docker-entrypoint.sh"]
