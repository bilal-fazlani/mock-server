# syntax=docker/dockerfile:1

# --- rds-ca: download and verify the AWS RDS/DocumentDB trust bundle ---
FROM alpine:3.22 AS rds-ca
ARG RDS_GLOBAL_BUNDLE_URL=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
ARG RDS_GLOBAL_BUNDLE_SHA256=e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3
RUN apk add --no-cache ca-certificates curl \
  && curl -fsSL "${RDS_GLOBAL_BUNDLE_URL}" -o /global-bundle.pem \
  && echo "${RDS_GLOBAL_BUNDLE_SHA256}  /global-bundle.pem" | sha256sum -c -

# --- deps: install all deps (incl. dev, needed for the build) ---
# Debian/glibc base (matching the runner) so native addons traced into the
# standalone bundle — notably sharp's @img/sharp-linux-* binary — are glibc-linked
# and load under node:22-bookworm-slim. An alpine/musl build stage would bake a
# musl-linked sharp binary that crashes at runtime on the glibc runner.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: produce the standalone server ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Git SHA to bake into the build (.git is dockerignored, so it must be passed
# in). Defaults to "unknown" for local `docker build` without --build-arg.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- run: minimal glibc image with mongod baked in for the embedded fallback ---
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Use the system mongod (installed below) instead of downloading at runtime,
# so `docker run` with no MONGODB_CONNECTION_STRING works offline.
ENV MONGOMS_SYSTEM_BINARY=/usr/bin/mongod

# Install MongoDB server so the embedded in-memory fallback has a real mongod
# to launch. Both arches are pinned to MONGODB_VERSION: amd64 installs that exact
# version from MongoDB's official Debian apt repo, matching upstream packaging.
# That repo does not publish arm64 .deb packages at all
# (verified against the 6.0/7.0/8.0 bookworm/mongodb-org binary-arm64 package
# indexes: only mongodb-mongosh* and CLI tools are listed, never
# mongodb-org-server) -- MongoDB only ships arm64 server builds for Ubuntu, so
# arm64 installs the official Ubuntu 22.04 tarball's mongod binary directly
# (pinned by version + sha256); it runs unmodified on Debian bookworm's newer
# glibc (verified: `mongod --version` succeeds under node:22-bookworm-slim).
ARG TARGETARCH
ARG MONGODB_VERSION=7.0.37
ARG MONGODB_ARM64_SHA256=769d083ba0185ce3bfda9c6b7fb3cf46a8cda24bf1b99c7a8254c114f0845d61
RUN set -eu; \
  apt-get update \
  && apt-get install -y --no-install-recommends gnupg curl ca-certificates tini \
  && if [ "${TARGETARCH}" = "amd64" ]; then \
       curl -fsSL https://pgp.mongodb.com/server-7.0.asc \
         | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor \
       && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
         > /etc/apt/sources.list.d/mongodb-org-7.0.list \
       && apt-get update \
       && apt-get install -y --no-install-recommends "mongodb-org-server=${MONGODB_VERSION}"; \
     elif [ "${TARGETARCH}" = "arm64" ]; then \
       apt-get install -y --no-install-recommends libcurl4 \
       && curl -fsSL "https://fastdl.mongodb.org/linux/mongodb-linux-aarch64-ubuntu2204-${MONGODB_VERSION}.tgz" -o /tmp/mongodb.tgz \
       && echo "${MONGODB_ARM64_SHA256}  /tmp/mongodb.tgz" | sha256sum -c - \
       && tar -xzf /tmp/mongodb.tgz -C /tmp \
       && cp "/tmp/mongodb-linux-aarch64-ubuntu2204-${MONGODB_VERSION}/bin/mongod" /usr/bin/mongod \
       && chmod 0755 /usr/bin/mongod \
       && rm -rf /tmp/mongodb.tgz "/tmp/mongodb-linux-aarch64-ubuntu2204-${MONGODB_VERSION}"; \
     else \
       echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2 && exit 1; \
     fi \
  && apt-get purge -y gnupg curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

COPY --from=rds-ca /global-bundle.pem ./global-bundle.pem

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && chmod 0444 /app/global-bundle.pem

# Standalone server bundle + assets it does not copy itself.
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Runtime data read via process.cwd() at request time.
COPY --from=build --chown=nextjs:nodejs /app/catalog ./catalog

USER nextjs
EXPOSE 3000

# HOSTNAME/PORT come from the ENV above; no shell wrapper needed. tini runs as
# PID 1 so it forwards SIGTERM to node for graceful shutdown and reaps the mongod
# child that the embedded fallback spawns.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ui/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
