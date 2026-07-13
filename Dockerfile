# syntax=docker/dockerfile:1

# --- rds-ca: download and verify the AWS RDS/DocumentDB trust bundle ---
FROM alpine:3.22 AS rds-ca
ARG RDS_GLOBAL_BUNDLE_URL=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
ARG RDS_GLOBAL_BUNDLE_SHA256=e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3
RUN apk add --no-cache ca-certificates curl \
  && curl -fsSL "${RDS_GLOBAL_BUNDLE_URL}" -o /global-bundle.pem \
  && echo "${RDS_GLOBAL_BUNDLE_SHA256}  /global-bundle.pem" | sha256sum -c -

# --- deps: install all deps (incl. dev, needed for the build) ---
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: produce the standalone server ---
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- run: minimal image, just the standalone server + runtime data ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=rds-ca /global-bundle.pem ./global-bundle.pem

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && chmod 0444 /app/global-bundle.pem

# Standalone server bundle + assets it does not copy itself.
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Runtime data read via process.cwd() at request time.
COPY --from=build --chown=nextjs:nodejs /app/catalog ./catalog

USER nextjs
EXPOSE 3000
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
