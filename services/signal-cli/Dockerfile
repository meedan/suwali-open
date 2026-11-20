FROM debian:bookworm-slim AS download

# Signal stops accepting clients older than ~3 months, so this must be bumped at least that often
ARG SIGNAL_CLI_VERSION=0.14.9

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ca-certificates curl gpg gpgv && \
    rm -rf /var/lib/apt/lists/*

# Public key of signal-cli's maintainer (AsamK), fingerprint FA10 826A 7490 7F9E C6BB B7FC 2BA2 CD21 B5B0 9570,
# as published at https://github.com/AsamK.gpg. The build fails unless the release is signed with it.
COPY asamk.asc /tmp/asamk.asc

# The Java build rather than the native one: in 0.14.9 the native binary links a device but then crashes
# returning finishLink's result (MissingReflectionRegistrationError on JsonFinishLink.aci)
RUN cd /tmp && \
    release="https://github.com/AsamK/signal-cli/releases/download/v${SIGNAL_CLI_VERSION}/signal-cli-${SIGNAL_CLI_VERSION}.tar.gz" && \
    curl -fsSL -o signal-cli.tar.gz "$release" && \
    curl -fsSL -o signal-cli.tar.gz.asc "$release.asc" && \
    gpg --dearmor < asamk.asc > asamk.gpg && \
    gpgv --keyring ./asamk.gpg signal-cli.tar.gz.asc signal-cli.tar.gz && \
    mkdir /opt/signal-cli && \
    tar -xzf signal-cli.tar.gz -C /opt/signal-cli --strip-components=1

# signal-cli needs Java 25 or newer. The image only works as linux/amd64: libsignal, which signal-cli
# bundles, ships its Linux native library for amd64 only.
FROM eclipse-temurin:25-jre

# curl is only for the healthcheck
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=download /opt/signal-cli /opt/signal-cli

# uid 1000 owns the existing account data in the volume; the base image's own uid 1000 user ("ubuntu") goes
RUN (userdel --remove ubuntu 2>/dev/null || true) && \
    useradd --uid 1000 --create-home signal && \
    mkdir -p /var/lib/signal-cli && \
    chown signal:signal /var/lib/signal-cli

USER signal

EXPOSE 8080

# Multi-account JSON-RPC daemon over HTTP: POST /api/v1/rpc, GET /api/v1/events (SSE), GET /api/v1/check.
# --no-receive-stdout keeps message contents out of the logs.
ENTRYPOINT ["/opt/signal-cli/bin/signal-cli", "--config", "/var/lib/signal-cli"]
# The 5-second keep-alive lets the listener notice newly linked accounts quickly (see SignalEventListener).
CMD ["--trust-new-identities", "always", "daemon", "--http", "0.0.0.0:8080", "--sse-keepalive-interval", "5", \
     "--no-receive-stdout", "--ignore-attachments", "--ignore-stories", "--ignore-avatars", "--ignore-stickers"]
