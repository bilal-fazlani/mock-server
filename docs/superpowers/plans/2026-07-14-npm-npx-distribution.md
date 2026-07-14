# npm / npx Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the mock server to npm so it runs via `npx mock-server ./catalog`, using the same standalone build the Docker image already produces, and add an in-memory MongoDB fallback so it runs with no external Mongo.

**Architecture:** Three shared code changes reused by both channels — a configurable `CATALOG_PATH`, an embedded-Mongo fallback in the single DB connection point, and forced file-tracing of `mongodb-memory-server` — plus a thin `bin/` launcher around the existing `.next/standalone` server, packaging metadata, a Debian-based Docker image with `mongod` baked in, and a release-triggered npm publish job.

**Tech Stack:** Next.js 16 (`output: "standalone"`), Node 22, MongoDB driver, `mongodb-memory-server`, vitest, GitHub Actions, Docker (multi-arch buildx).

## Global Constraints

- Node version floor: **>= 22** (matches the Docker `node:22` base and CI).
- Do **not** change mock-serving semantics, catalog schema, scenarios, profiles, or UI behavior.
- Mongo is always present at runtime; only its **source** varies (external via `MONGODB_CONNECTION_STRING`, else embedded in-memory). No feature becomes conditionally available.
- `CATALOG_PATH` default is `./catalog`; relative values resolve against the process cwd; absolute values pass through. A CLI positional arg overrides the env var.
- The npm package ships the **same** `output: "standalone"` bundle the Dockerfile produces. The bin is a launcher, not a reimplementation.
- `mongodb-memory-server` version stays pinned at `^11.2.0` (already in the repo).
- Bin files are CommonJS (the package has no `"type": "module"`).
- This work lives on the `npx-distribution` worktree branch; commit after every task.

---

### Task 1: Configurable catalog path

**Files:**
- Modify: `src/lib/config.ts` (add `resolveCatalogDir` + `node:path` import)
- Modify: `src/lib/runtime.ts:90-91` (use the helper)
- Test: `tests/lib/config-catalog-dir.test.ts` (create)

**Interfaces:**
- Produces: `resolveCatalogDir(raw: string | undefined): string` — returns an absolute path; `path.resolve(raw ?? 'catalog')`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/config-catalog-dir.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCatalogDir } from '../../src/lib/config'

describe('resolveCatalogDir', () => {
  it('defaults to <cwd>/catalog when unset', () => {
    expect(resolveCatalogDir(undefined)).toBe(path.resolve('catalog'))
  })

  it('resolves a relative path against cwd', () => {
    expect(resolveCatalogDir('./fixtures/catalog')).toBe(path.resolve('fixtures/catalog'))
  })

  it('passes an absolute path through unchanged', () => {
    expect(resolveCatalogDir('/srv/catalog')).toBe('/srv/catalog')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- config-catalog-dir`
Expected: FAIL — `resolveCatalogDir is not a function` / import error.

- [ ] **Step 3: Add the helper**

At the top of `src/lib/config.ts`, add the import (the file currently has no imports):

```ts
import path from 'node:path'
```

At the end of `src/lib/config.ts`, add:

```ts
// Resolve the catalog directory from CATALOG_PATH. A relative value is
// resolved against the current working directory; an absolute value is used
// as-is. Defaults to ./catalog. The npx launcher always passes an absolute
// path here (its own cwd differs from the user's), so this stays cwd-agnostic.
export function resolveCatalogDir(raw: string | undefined): string {
  return path.resolve(raw ?? 'catalog')
}
```

- [ ] **Step 4: Wire it into runtime**

In `src/lib/runtime.ts`, replace lines 90-91:

```ts
  const root = process.cwd()
  const catalogDir = path.join(root, 'catalog')
```

with:

```ts
  const catalogDir = resolveCatalogDir(process.env.CATALOG_PATH)
```

Add `resolveCatalogDir` to the existing import from `./config`. The current import (around line 8) looks like:

```ts
import {
  parseConsoleLogLevel,
  parseDynamicHistoryLimit,
  parsePassthroughAsDefault,
  parseUnmockedUsers,
  type ConsoleLogLevel,
  type UnmockedUsers,
} from './config'
```

Add `resolveCatalogDir,` to that list. Verify `root` is not referenced elsewhere in `getRuntime`; if it is, keep only the `catalogDir` change. Leave the `import path from 'node:path'` line in `runtime.ts` (it may still be used elsewhere; if lint flags it as unused, remove it).

- [ ] **Step 5: Run tests + lint**

Run: `npm test -- config-catalog-dir && npm run lint`
Expected: PASS; no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts src/lib/runtime.ts tests/lib/config-catalog-dir.test.ts
git commit -m "feat: resolve catalog dir from CATALOG_PATH env"
```

---

### Task 2: Embedded MongoDB fallback

**Files:**
- Create: `src/lib/mongo/embedded.ts`
- Modify: `src/lib/profiles/store.ts` (getDb uses `resolveMongoUri`)
- Modify: `package.json` (move `mongodb-memory-server` to `dependencies`)
- Modify: `next.config.ts` (force-trace `mongodb-memory-server` into standalone)
- Test: `tests/mongo/embedded.test.ts` (create)

**Interfaces:**
- Produces: `resolveMongoUri(): Promise<string>` — returns `MONGODB_CONNECTION_STRING` if set, else boots one shared in-memory `mongod` (memoized) and returns its URI.
- Produces: `stopEmbeddedMongo(): Promise<void>` — stops the embedded server if running and resets state (used by tests and shutdown).
- Consumes (in store): `getDb()` calls `resolveMongoUri()` instead of reading the env var directly.

- [ ] **Step 1: Write the failing test**

Create `tests/mongo/embedded.test.ts`:

```ts
import { MongoClient } from 'mongodb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveMongoUri, stopEmbeddedMongo } from '../../src/lib/mongo/embedded'

const ORIGINAL = process.env.MONGODB_CONNECTION_STRING

beforeEach(() => {
  delete process.env.MONGODB_CONNECTION_STRING
})

afterEach(async () => {
  await stopEmbeddedMongo()
  if (ORIGINAL === undefined) delete process.env.MONGODB_CONNECTION_STRING
  else process.env.MONGODB_CONNECTION_STRING = ORIGINAL
})

describe('resolveMongoUri', () => {
  it('returns the configured connection string without booting embedded', async () => {
    process.env.MONGODB_CONNECTION_STRING = 'mongodb://configured.example:27017'
    expect(await resolveMongoUri()).toBe('mongodb://configured.example:27017')
  })

  it('boots an embedded mongod when no connection string is set', async () => {
    const uri = await resolveMongoUri()
    expect(uri).toMatch(/^mongodb:\/\//)

    const client = new MongoClient(uri)
    await client.connect()
    const ping = await client.db('admin').command({ ping: 1 })
    expect(ping.ok).toBe(1)
    await client.close()
  })

  it('reuses a single embedded instance across concurrent calls', async () => {
    const [a, b] = await Promise.all([resolveMongoUri(), resolveMongoUri()])
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- mongo/embedded`
Expected: FAIL — cannot import `resolveMongoUri` (module missing).

- [ ] **Step 3: Create the embedded module**

Create `src/lib/mongo/embedded.ts`:

```ts
import type { MongoMemoryServer } from 'mongodb-memory-server'

// A single embedded mongod, booted lazily and shared process-wide. The boot is
// memoized as a promise so concurrent callers await the same instance rather
// than racing to start two servers. Data is ephemeral by design: this path is
// only taken when no external MONGODB_CONNECTION_STRING is configured.
let embeddedPromise: Promise<string> | null = null
let server: MongoMemoryServer | null = null

async function bootEmbedded(): Promise<string> {
  // Dynamic import keeps mongodb-memory-server out of the hot path when an
  // external connection string is configured.
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  // eslint-disable-next-line no-console
  console.log(
    '[mock-server] MONGODB_CONNECTION_STRING not set; starting embedded in-memory MongoDB (data is ephemeral)…',
  )
  server = await MongoMemoryServer.create()
  return server.getUri()
}

export async function resolveMongoUri(): Promise<string> {
  const configured = process.env.MONGODB_CONNECTION_STRING
  if (configured) return configured
  if (!embeddedPromise) embeddedPromise = bootEmbedded()
  return embeddedPromise
}

export async function stopEmbeddedMongo(): Promise<void> {
  const running = server
  server = null
  embeddedPromise = null
  if (running) await running.stop()
}
```

- [ ] **Step 4: Point getDb at the resolver**

In `src/lib/profiles/store.ts`, add the import near the top (after the existing `mongodb` import):

```ts
import { resolveMongoUri } from '../mongo/embedded'
```

Replace the body of `getDb` (currently at `src/lib/profiles/store.ts`):

```ts
export async function getDb(): Promise<Db> {
  if (!client) {
    const uri = process.env.MONGODB_CONNECTION_STRING
    if (!uri) throw new Error('MONGODB_CONNECTION_STRING is not set')
    client = new MongoClient(uri)
    await client.connect()
    await ensureIndexes(client.db(dbName()))
  }
  return client.db(dbName())
}
```

with:

```ts
export async function getDb(): Promise<Db> {
  if (!client) {
    const uri = await resolveMongoUri()
    client = new MongoClient(uri)
    await client.connect()
    await ensureIndexes(client.db(dbName()))
  }
  return client.db(dbName())
}
```

- [ ] **Step 5: Move the dependency and force tracing**

In `package.json`, remove `mongodb-memory-server` from `devDependencies` and add it to `dependencies` (keep the same `^11.2.0` version):

```json
    "mongodb": "^7.4.0",
    "mongodb-memory-server": "^11.2.0",
```

In `next.config.ts`, add tracing config so the standalone build includes the package (it is loaded via dynamic import, so make inclusion explicit):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a minimal server.js for a lean Docker image.
  output: "standalone",
  // Loaded via dynamic import() at runtime for the embedded-Mongo fallback;
  // force it (and its bundled tooling) into the standalone output.
  serverExternalPackages: ["mongodb-memory-server"],
  outputFileTracingIncludes: {
    "**": ["./node_modules/mongodb-memory-server/**"],
  },
};

export default nextConfig;
```

- [ ] **Step 6: Run tests**

Run: `npm test -- mongo/embedded`
Expected: PASS (first run may download the mongod binary; `hookTimeout` is already 120s).

Then run the existing store tests to confirm no regression:

Run: `npm test -- profiles/store`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mongo/embedded.ts src/lib/profiles/store.ts package.json next.config.ts tests/mongo/embedded.test.ts
git commit -m "feat: fall back to embedded MongoDB when no connection string is set"
```

---

### Task 3: CLI launcher + package metadata

**Files:**
- Create: `bin/args.js` (pure arg parser + help text, CommonJS)
- Create: `bin/mock-server.js` (env prep + spawn standalone server, CommonJS)
- Modify: `package.json` (drop `private`, add `bin`/`engines`/`files`/`prepublishOnly`)
- Test: `tests/bin/args.test.ts` (create)

**Interfaces:**
- Produces (`bin/args.js`): `module.exports = { parseArgs, HELP }` where
  `parseArgs(argv: string[]): { catalogPath?: string, port?: string, help: boolean, version: boolean }`.
- Consumes (`bin/mock-server.js`): `parseArgs`, `HELP` from `./args`; resolves the effective catalog path to absolute against the user's cwd and sets `CATALOG_PATH`; spawns `<pkg>/.next/standalone/server.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/bin/args.test.ts`:

```ts
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { parseArgs, HELP } = require('../../bin/args.js') as {
  parseArgs: (argv: string[]) => {
    catalogPath?: string
    port?: string
    help: boolean
    version: boolean
  }
  HELP: string
}

describe('parseArgs', () => {
  it('reads a positional catalog path', () => {
    expect(parseArgs(['./catalog']).catalogPath).toBe('./catalog')
  })

  it('reads --port and -p', () => {
    expect(parseArgs(['--port', '8080']).port).toBe('8080')
    expect(parseArgs(['-p', '8080']).port).toBe('8080')
    expect(parseArgs(['--port=8080']).port).toBe('8080')
  })

  it('reads catalog path alongside a port', () => {
    const opts = parseArgs(['./catalog', '--port', '4000'])
    expect(opts.catalogPath).toBe('./catalog')
    expect(opts.port).toBe('4000')
  })

  it('does not treat a flag as the catalog path', () => {
    expect(parseArgs(['--help']).catalogPath).toBeUndefined()
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['--version']).version).toBe(true)
  })

  it('exposes help text mentioning usage', () => {
    expect(HELP).toContain('mock-server')
    expect(HELP).toContain('CATALOG_PATH')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- bin/args`
Expected: FAIL — cannot find `../../bin/args.js`.

- [ ] **Step 3: Write the arg parser**

Create `bin/args.js`:

```js
'use strict'

const HELP = `mock-server — run a mock API server from a catalog directory

Usage:
  mock-server [catalogPath] [options]

Arguments:
  catalogPath            Path to the catalog directory (default: ./catalog).
                         Overrides the CATALOG_PATH environment variable.

Options:
  -p, --port <number>    Port to listen on (default: 3000, or $PORT).
  -h, --help             Show this help and exit.
  -v, --version          Print the version and exit.

Environment:
  CATALOG_PATH                 Catalog directory (relative or absolute).
  MONGODB_CONNECTION_STRING    External MongoDB. If unset, an in-memory
                               MongoDB is started automatically (ephemeral).
`

function parseArgs(argv) {
  const opts = { catalogPath: undefined, port: undefined, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (arg === '--version' || arg === '-v') {
      opts.version = true
    } else if (arg === '--port' || arg === '-p') {
      opts.port = argv[++i]
    } else if (arg.startsWith('--port=')) {
      opts.port = arg.slice('--port='.length)
    } else if (!arg.startsWith('-') && opts.catalogPath === undefined) {
      opts.catalogPath = arg
    }
  }
  return opts
}

module.exports = { parseArgs, HELP }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- bin/args`
Expected: PASS.

- [ ] **Step 5: Write the launcher**

Create `bin/mock-server.js`:

```js
#!/usr/bin/env node
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { parseArgs, HELP } = require('./args')

const pkgRoot = path.join(__dirname, '..')
const pkg = require(path.join(pkgRoot, 'package.json'))

function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.help) {
    process.stdout.write(HELP)
    return
  }
  if (opts.version) {
    process.stdout.write(`${pkg.version}\n`)
    return
  }

  // The launcher's cwd differs from the server's (we spawn inside the
  // standalone dir), so always hand the server an ABSOLUTE catalog path,
  // resolved against the user's real cwd. Precedence: positional arg > env.
  const userCwd = process.cwd()
  const rawCatalog = opts.catalogPath ?? process.env.CATALOG_PATH ?? 'catalog'

  const env = { ...process.env }
  env.CATALOG_PATH = path.resolve(userCwd, rawCatalog)
  if (opts.port !== undefined) env.PORT = String(opts.port)

  const standaloneDir = path.join(pkgRoot, '.next', 'standalone')
  const serverJs = path.join(standaloneDir, 'server.js')
  if (!fs.existsSync(serverJs)) {
    process.stderr.write(
      'mock-server: build output not found at .next/standalone/server.js. ' +
        'This usually means the package was not built before publishing.\n',
    )
    process.exit(1)
  }

  const child = spawn(process.execPath, [serverJs], {
    cwd: standaloneDir,
    stdio: 'inherit',
    env,
  })

  const forward = (signal) => {
    if (!child.killed) child.kill(signal)
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 0)
  })
}

main()
```

- [ ] **Step 6: Update package metadata**

Edit `package.json`:
- Remove the `"private": true,` line.
- Add these keys (place `bin`/`engines`/`files` after `"version"`, and `prepublishOnly` inside `scripts`):

```json
  "bin": {
    "mock-server": "bin/mock-server.js"
  },
  "engines": {
    "node": ">=22"
  },
  "files": [
    ".next/standalone",
    "bin"
  ],
```

Add to `scripts`:

```json
    "prepublishOnly": "npm run build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public",
```

Rationale: Next's standalone `server.js` expects `.next/static` and `public` beside it inside the standalone tree. `prepublishOnly` copies them in, so shipping only `.next/standalone` yields a self-contained package. (`server.js` also lives inside `.next/standalone`, and the launcher spawns it with `cwd` set there.)

- [ ] **Step 7: Verify the packaged file list**

Run: `npm pack --dry-run`
Expected: the listed contents include `bin/mock-server.js`, `bin/args.js`, and files under `.next/standalone/` (including `.next/standalone/server.js`, `.next/standalone/.next/static/`, `.next/standalone/public/`, and `.next/standalone/node_modules/mongodb-memory-server/`). If `mongodb-memory-server` is absent, revisit the `next.config.ts` tracing from Task 2.

- [ ] **Step 8: Smoke-test the launcher**

Run: `node bin/mock-server.js --help`
Expected: prints the usage text, exits 0.

Run: `node bin/mock-server.js --version`
Expected: prints the package version, exits 0.

Run (boots the real server on an ephemeral embedded Mongo, no external Mongo needed):

```bash
PORT=3999 node bin/mock-server.js ./catalog &
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3999/ui
kill %1
```

Expected: an HTTP status (e.g. `200`/`307`) rather than a connection error, and the server log shows the embedded-Mongo notice. (Requires `npm run build` to have produced `.next/standalone` first; run it if the launcher reports missing build output.)

- [ ] **Step 9: Commit**

```bash
git add bin/args.js bin/mock-server.js package.json tests/bin/args.test.ts
git commit -m "feat: add mock-server CLI launcher and npm package metadata"
```

---

### Task 4: Bake mongod into the Docker image

**Files:**
- Modify: `Dockerfile` (runner stage → Debian glibc base with `mongod` installed)

**Interfaces:**
- Consumes: the embedded fallback from Task 2. Setting `MONGOMS_SYSTEM_BINARY` makes `mongodb-memory-server` use the pre-installed `mongod` instead of downloading at runtime.

- [ ] **Step 1: Switch the runner stage to a glibc base with mongod**

In `Dockerfile`, replace the entire `runner` stage. The current stage begins with `FROM node:22-alpine AS runner`. Replace from that line through the end of the file with:

```dockerfile
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

# Install MongoDB server from the official apt repo (amd64 + arm64) so the
# embedded in-memory fallback has a real mongod to launch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gnupg curl ca-certificates \
  && curl -fsSL https://pgp.mongodb.com/server-7.0.asc \
     | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor \
  && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
     > /etc/apt/sources.list.d/mongodb-org-7.0.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends mongodb-org-server \
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
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
```

Note: `groupadd`/`useradd` replace Alpine's `addgroup`/`adduser`. The `deps` and `build` stages stay on `node:22-alpine` — the build does not need `mongod`.

- [ ] **Step 2: Build the image (amd64) and verify it runs with no external Mongo**

Run:

```bash
docker build -t mock-server:embedded-test .
docker run --rm -e PORT=3000 -p 3000:3000 --name mst mock-server:embedded-test &
sleep 12
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ui
docker stop mst
```

Expected: the container starts, the log shows the embedded-Mongo notice (no `MONGODB_CONNECTION_STRING` provided), and `curl` returns an HTTP status rather than a connection failure. If `mongod` fails to launch, the log names the missing shared library — add it to the `apt-get install` list and rebuild.

- [ ] **Step 3: Verify external Mongo still works (regression)**

Run (points at any reachable Mongo, e.g. a throwaway container):

```bash
docker run -d --rm --name mst-mongo -p 27017:27017 mongo:7
docker run --rm --network host -e MONGODB_CONNECTION_STRING="mongodb://localhost:27017" -e PORT=3001 mock-server:embedded-test &
sleep 10
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/ui
docker stop mst-mongo
```

Expected: server uses the supplied connection string (no embedded-Mongo notice) and responds.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: bake mongod into the Docker image for the embedded fallback"
```

---

### Task 5: Release-triggered npm publish workflow

**Files:**
- Create: `.github/workflows/publish-npm.yml`

**Interfaces:**
- Consumes: `prepublishOnly` from Task 3 (runs the build during `npm publish`), the `NPM_TOKEN` repo secret.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/publish-npm.yml`:

```yaml
name: Publish npm package

# Publish to npm only on releases, in lockstep with the container image:
#   - Publishing a GitHub Release "v1.2.0" builds and publishes the package.
#   - Manual runs are supported for re-publishing a release: dispatch against
#     a tag ref (v*).
on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # npm provenance
    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm ci

      # `prepublishOnly` runs `next build` and stages static/public into the
      # standalone tree before packing.
      - name: Publish
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Validate workflow syntax**

Run: `npx --yes @action-validator/cli .github/workflows/publish-npm.yml` (or visually confirm indentation matches `publish-image.yml`).
Expected: no schema errors.

- [ ] **Step 3: Note the manual prerequisite**

The `NPM_TOKEN` secret (an npm automation token with publish rights for the `mock-server` package name) must be added to the repo before the first release. Record this in the PR description — it is a human step, not automatable here. Also confirm the package name `mock-server` is available/owned on npm; if taken, choose a scoped name (e.g. `@<org>/mock-server`) and update `package.json` `name` accordingly.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/publish-npm.yml
git commit -m "ci: publish npm package on release"
```

---

### Task 6: Documentation (gated on user consent per AGENTS.md)

**Files:**
- Modify: `docs/site/docs/guide/reference/configuration.md`
- Modify: `docs/site/docs/index.md` and/or `docs/site/docs/guide/getting-started.md`
- Modify: `README.md`

Per `AGENTS.md`, this change touches configuration and the request lifecycle, so the guide must be kept in sync — **but only after explicitly confirming with the user.** Do not edit the guide unprompted. Before starting this task, tell the user exactly what looks affected and ask whether to update it.

- [ ] **Step 1: Confirm with the user**

State: `CATALOG_PATH` (new env var, relative/absolute resolution, CLI-arg precedence) and the optional-Mongo behavior (embedded fallback when `MONGODB_CONNECTION_STRING` is unset; ephemeral data; Docker bakes in `mongod`) affect `guide/reference/configuration.md`; the npx install path affects `index.md`/`getting-started.md`; and the README needs an npm/npx usage section. Ask whether to proceed. **If the user declines, stop here — the code tasks are independently complete.**

- [ ] **Step 2: Update `configuration.md`**

Add a `CATALOG_PATH` entry to the env-var reference (default `./catalog`, relative resolved against cwd, absolute used as-is, CLI positional arg overrides it) and document that `MONGODB_CONNECTION_STRING` is now optional: when unset, an in-memory MongoDB starts automatically with ephemeral data; in Docker a `mongod` is baked in so this works offline. Ground every statement in the code from Tasks 1–4.

- [ ] **Step 3: Add the npx path to the getting-started / index page**

Add an `npx mock-server ./catalog` quickstart alongside the existing Docker instructions, noting no external Mongo is required for a quick start.

- [ ] **Step 4: Update the README**

Add an "Install via npm" section: `npx mock-server ./catalog`, the `--port`/`--help`/`--version` flags, and the `MONGODB_CONNECTION_STRING` note (optional; embedded fallback).

- [ ] **Step 5: Build the docs site**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: builds with no errors and all internal links resolve.

- [ ] **Step 6: Commit**

```bash
git add docs/site/docs README.md
git commit -m "docs: document CATALOG_PATH, embedded Mongo, and npx usage"
```

---

## Notes for the implementer

- **Merge discipline:** this branch overlaps the active `feat/dynamic-scenario-resolver` branch in `package.json`, `next.config.ts`, `src/lib/runtime.ts`, and possibly `src/lib/profiles/store.ts`. Keep each task's commit small and focused so a later rebase onto that branch's final state is mechanical.
- **First test run downloads a mongod binary** (npm channel) — expected, one-time, covered by the 120s `hookTimeout`.
- **Task ordering** front-loads new-file work (Tasks 1–3, 5) and isolates shared-file edits so conflicts are easy to resolve. Task 4 (Dockerfile) and Task 6 (docs) can follow.
