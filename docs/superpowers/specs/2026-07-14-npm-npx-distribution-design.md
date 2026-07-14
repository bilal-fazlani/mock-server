# npm / npx distribution + optional embedded Mongo

**Date:** 2026-07-14
**Status:** Design — approved for planning
**Branch:** `npx-distribution` (worktree, branched from `e8272a6`)

## Problem

The server is currently distributed only as a Docker image published to ghcr.io on
release. For Node developers who want to spin up a mock server in local development or
CI, `docker run` is heavier than it needs to be. A published npm package would let them
run:

```
npx mock-server ./catalog
```

with no Docker daemon involved. The goal is a **thin alternative to Docker for the exact
same server** — not a behavioral fork. Two shared improvements make this possible while
maximizing code reuse, and they benefit the Docker path as well:

1. A configurable catalog path (`CATALOG_PATH`) instead of the hardcoded `<cwd>/catalog`.
2. The ability to run **without a real persistent MongoDB** — when no connection string is
   supplied, boot an in-memory `mongod` so every existing code path keeps working.

## Goals

- Publish an npm package exposing a `mock-server` bin runnable via `npx`.
- `npx mock-server [catalogPath] [--port <n>]` boots the existing Next.js standalone server.
- Support running with **no external MongoDB** by falling back to an embedded in-memory
  `mongod` (real server → maximum code reuse, zero per-feature branching).
- Keep Docker behavior byte-for-byte compatible; the two channels publish the same artifact
  from the same tagged release.

## Non-goals

- No change to the mock-serving semantics, catalog schema, scenarios, profiles, or UI.
- No per-feature "works without Mongo" degradation. Mongo is always present; only its
  *source* (external vs. embedded) varies.
- No new persistence guarantees for the embedded mode — its data is ephemeral by design.

## Design

### 1. Catalog path resolution (shared)

Replace the hardcoded catalog directory in `src/lib/runtime.ts`:

```ts
// before
const root = process.cwd()
const catalogDir = path.join(root, 'catalog')

// after
const catalogDir = path.resolve(process.env.CATALOG_PATH ?? 'catalog')
```

`path.resolve` makes a relative value absolute against `process.cwd()` and passes an
absolute value through unchanged, covering both forms:

- **Relative** (`./catalog`, `catalog`, `../fixtures/catalog`) → resolved against the
  current working directory.
- **Absolute** (`/srv/catalog`) → used as-is.

Default remains `./catalog`, so existing behavior is preserved.

**Critical subtlety — cwd differs by channel.** In the Next.js *standalone* build,
`process.cwd()` is the package's install directory, **not** the user's shell directory.
Therefore relative paths must be resolved by the CLI shim (§3) at launch, before the
server process starts. The shim captures the user's real cwd, resolves the catalog path to
an **absolute** path, and exports it as `CATALOG_PATH`. Runtime code then stays
context-agnostic — it only ever sees an absolute path in the npx case, and in Docker the
default `./catalog` resolves against `/app` (the WORKDIR) exactly as today.

**Precedence:** a CLI positional argument overrides an inherited `CATALOG_PATH` env var.

### 2. Optional embedded Mongo (shared — benefits Docker + npx)

Add a small helper module (e.g. `src/lib/mongo/embedded.ts`) and change `getDb()` in
`src/lib/profiles/store.ts`:

- If `MONGODB_CONNECTION_STRING` **is set** → today's behavior, unchanged.
- If it is **unset** → lazily boot a single in-memory `mongod` via `mongodb-memory-server`,
  reuse the URI it exposes, and connect the existing driver to it.

Properties:

- **Singleton, boot-guarded.** Concurrent `getDb()` calls must not start two servers; the
  first boot is memoized (a shared promise), all callers await it.
- **Graceful shutdown.** Stop the embedded server on `SIGINT` / `SIGTERM` so the child
  `mongod` process is not orphaned.
- **Ephemeral data.** The in-memory server starts empty each run. This is the intended
  semantics of "no persistence configured" — profile pins, scenario sequence progress, and
  request logs live only for the process lifetime.

Because the embedded server is a *real* `mongod`, every existing query, index creation,
duplicate-key handling, and aggregation works verbatim. No feature becomes conditionally
available; the only thing that changes is where the connection URI comes from.

`mongodb-memory-server` moves from `devDependencies` to `dependencies` so it is traced into
the standalone build and installed for npm consumers.

**Validation gate.** Verify `src/lib/catalog/validate.ts` (via `validateAppConfig`) does not
hard-require `MONGODB_CONNECTION_STRING`. If it does, relax that rule so an unset connection
string is valid (it now means "use embedded").

**Binary sourcing (per decision: hybrid).**

- **npm:** rely on `mongodb-memory-server`'s default download-on-first-run. The platform
  `mongod` binary (~90 MB) is fetched once to the user's cache directory the first time the
  fallback boots. Keeps the published package small.
- **Docker:** pre-download / cache the `mongod` binary at image build time so
  `docker run` with no `MONGODB_CONNECTION_STRING` starts instantly, works offline, and does
  not need to write to a read-only filesystem at runtime. (Configure the memory-server
  download/cache path to a build-time-populated location under `/app`.)

### 3. CLI / bin shim

New `bin/mock-server.js`, declared as the package `bin` (`mock-server`).

```
npx mock-server [catalogPath] [--port <n>] [--help] [--version]
```

Responsibilities (env preparation + launch only — no server logic):

- **`catalogPath`** (positional, optional): resolve to an absolute path against the user's
  cwd, then set `process.env.CATALOG_PATH`. Overrides any inherited env value.
- **`--port` / `-p`**: set `process.env.PORT`. Provided as an ergonomic convenience; all
  other configuration continues to flow through env vars, preserving "same server".
- **`--help`**: usage text. **`--version`**: package version.
- Then `spawn` the standalone server: `node <pkgRoot>/.next/standalone/server.js`, locating
  `pkgRoot` relative to `__dirname`, inheriting stdio, and forwarding the exit code and
  termination signals.

The shim adds no configuration surface beyond the catalog path and port; everything else is
the existing env-var contract.

### 4. Packaging

Changes to `package.json`:

- Remove `"private": true`.
- Set a real, publishable `version`.
- Add `"bin": { "mock-server": "bin/mock-server.js" }`.
- Add `"engines": { "node": ">=22" }` (matches the Docker `node:22-alpine` base).
- Add a `"files"` allowlist: `.next/standalone`, `.next/static`, `public`, `bin/`.
- Add `"prepublishOnly": "npm run build"` so the published tree matches the Docker artifact.
- Move `mongodb-memory-server` to `dependencies`.

The published package ships the same `output: "standalone"` bundle the Dockerfile already
produces; the bin is a launcher around it, not a reimplementation.

### 5. CI publish

Add an npm-publish job triggered on release, mirroring the release trigger in
`.github/workflows/publish-image.yml`. It builds and runs `npm publish` (ideally with npm
provenance / `--provenance` and an `NPM_TOKEN` / OIDC). Docker and npm publish from the same
tagged release so versions stay in lockstep.

### 6. Documentation (per AGENTS.md)

This change touches configuration and the request lifecycle, so on implementation update:

- `docs/site/docs/guide/reference/configuration.md` — document `CATALOG_PATH` (default,
  relative/absolute resolution, CLI precedence) and the optional-Mongo behavior (embedded
  fallback when `MONGODB_CONNECTION_STRING` is unset, ephemeral data, binary sourcing).
- `docs/site/docs/index.md` / getting-started — add an `npx` install-and-run path alongside
  Docker.
- `README.md` — npm/npx usage section.

After doc edits, run
`docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`.

## Testing

- **Catalog path resolution** — unit test that `CATALOG_PATH` relative/absolute/unset each
  resolve correctly; that a CLI arg overrides the env var.
- **Embedded Mongo** — test that `getDb()` with no connection string boots the embedded
  server, returns a working `Db`, and that concurrent calls share one instance; that
  `SIGTERM` stops it cleanly.
- **External Mongo unchanged** — existing store tests continue to pass against a supplied
  connection string (they already use `mongodb-memory-server`).
- **Bin smoke test** — invoking the bin with a catalog path boots the server, serves a known
  fixture, and exits cleanly; `--help` / `--version` print and exit 0.

## Risks & open points

- **Standalone tracing of `mongodb-memory-server`.** Confirm `@vercel/nft` traces it into
  `.next/standalone` (it is imported from runtime code, so it should). Verify the published
  package actually contains it.
- **First-run download UX (npm).** The ~90 MB `mongod` download on first fallback boot adds a
  one-time delay; surface a clear log line ("downloading embedded mongod…") so it does not
  look like a hang.
- **Docker image size.** Pre-bundling the `mongod` binary increases the image. Acceptable for
  the offline/read-only guarantee; keep it to the single target platform.
- **Port already in use.** The shim should surface the server's bind error clearly rather
  than exiting silently.

## Rollout

Ship behind a release: the first release that includes this both publishes the npm package
and keeps publishing the Docker image, from the same tag.
