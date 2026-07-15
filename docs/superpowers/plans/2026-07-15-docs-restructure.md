# Docs Restructure (Build / Drive IA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Zensical docs site under `docs/site/` into a two-audience Build/Drive information architecture, add the missing Install, Runtime-control API, and dev/CI pages, and make the docs site the canonical source for install/Docker/configuration.

**Architecture:** Physically move existing Markdown pages into section folders (`get-started/ building/ driving/ reference/`), rewrite `zensical.toml` `nav` to match, and add three new pages grounded in real source (route handlers for the API page, README for Install, the API design spec for the CI workflow). Every task ends with a clean strict Zensical build — the build (`--strict`) is the test: it fails on any unresolved internal link.

**Tech Stack:** Zensical 0.0.50 (Markdown + `zensical.toml`), invoked via `docs/site/.venv/bin/zensical`.

## Global Constraints

- **Canonical source of truth:** docs site, not README. Install/Docker/configuration detail lives in the docs site; README carries only a quickstart that links to it.
- **Ground every factual claim in code.** The API page reflects the actual route handlers under `src/app/ui/api/`; never invent status codes, body fields, or query params. Verify against the source file named in each task.
- **The test for every docs task is:** `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict` exits 0 with no unresolved-link warnings.
- **Keep prose changes minimal on moved pages.** Moved Building/Reference pages change only their internal links (and the two API cross-links called out in Task 4), not their body content.
- **`AGENTS.md` path references must track file moves** (Task 1).

### Old → new path map (used for every link fix)

| Old path (`docs/site/docs/`) | New path (`docs/site/docs/`) |
|---|---|
| `guide/getting-started.md` | `get-started/first-mock.md` |
| `guide/reference/endpoints.md` | `building/endpoints.md` |
| `guide/reference/profiles.md` | `building/profiles.md` |
| `guide/reference/scenarios.md` | `building/scenarios.md` |
| `guide/reference/dynamic.md` | `building/dynamic.md` |
| `guide/reference/fixtures.md` | `building/fixtures.md` |
| `guide/reference/schemas.md` | `building/schemas.md` |
| `guide/reference/request-logs.md` | `driving/request-logs.md` |
| `guide/reference/configuration.md` | `reference/configuration.md` |
| `request-lifecycle.md` | `reference/request-lifecycle.md` |
| `guide/gotchas.md` | `reference/gotchas.md` |
| `index.md` | `index.md` (unchanged) |

---

### Task 1: Relocate existing pages into the Build/Drive tree

Atomic move — file relocations, `nav`, cross-links, and `AGENTS.md` are interdependent, so they land together and the build must be green at the end.

**Files:**
- Move (git mv): all 11 pages per the Old → new path map above.
- Modify: `docs/site/zensical.toml` (nav), every moved page + `index.md` (internal links), `AGENTS.md` (path references).

**Interfaces:**
- Produces: the folder layout `get-started/ building/ driving/ reference/` and a `nav` referencing only pages that exist after this task (the three new pages are added in Tasks 3–5).

- [ ] **Step 1: Create folders and move files**

```bash
cd docs/site/docs
mkdir -p get-started building driving reference
git mv guide/getting-started.md        get-started/first-mock.md
git mv guide/reference/endpoints.md    building/endpoints.md
git mv guide/reference/profiles.md     building/profiles.md
git mv guide/reference/scenarios.md    building/scenarios.md
git mv guide/reference/dynamic.md      building/dynamic.md
git mv guide/reference/fixtures.md     building/fixtures.md
git mv guide/reference/schemas.md      building/schemas.md
git mv guide/reference/request-logs.md driving/request-logs.md
git mv guide/reference/configuration.md reference/configuration.md
git mv request-lifecycle.md            reference/request-lifecycle.md
git mv guide/gotchas.md                reference/gotchas.md
rmdir guide/reference guide 2>/dev/null || true
cd -
```

- [ ] **Step 2: Rewrite the nav to the moved pages (new pages come later)**

Replace the `nav = [ ... ]` array in `docs/site/zensical.toml` with exactly:

```toml
nav = [
  { "Overview" = "index.md" },
  { "Get started" = [
    { "Your first mock endpoint" = "get-started/first-mock.md" },
  ] },
  { "Building mocks" = [
    { "Endpoints" = "building/endpoints.md" },
    { "Profiles" = "building/profiles.md" },
    { "Scenarios" = "building/scenarios.md" },
    { "Dynamic scenarios" = "building/dynamic.md" },
    { "Fixtures" = "building/fixtures.md" },
    { "Schemas" = "building/schemas.md" },
  ] },
  { "Driving mocks" = [
    { "Request logs" = "driving/request-logs.md" },
  ] },
  { "Reference" = [
    { "Configuration" = "reference/configuration.md" },
    { "Request lifecycle" = "reference/request-lifecycle.md" },
    { "Gotchas" = "reference/gotchas.md" },
  ] },
]
```

- [ ] **Step 3: Run the strict build to surface every broken link**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: FAIL — it lists unresolved internal links in the moved pages (e.g. a Building page linking `reference/configuration.md` from its old relative depth, `index.md` linking `guide/getting-started.md`).

- [ ] **Step 4: Fix every reported link using the path map**

For each unresolved link the build reports, rewrite the relative target to the moved location per the Old → new path map, recomputing the relative prefix for the page's new folder. Guidance:
- Links between two Building pages (same folder) are unchanged (`profiles.md` → `profiles.md`).
- A Building page → Configuration becomes `../reference/configuration.md`; → Request lifecycle becomes `../reference/request-lifecycle.md`.
- `index.md` links: `guide/getting-started.md` → `get-started/first-mock.md`, `guide/reference/endpoints.md` → `building/endpoints.md`, `request-lifecycle.md` → `reference/request-lifecycle.md`, `guide/gotchas.md` → `reference/gotchas.md`.
- Re-run the strict build after each batch; repeat until it exits 0.

- [ ] **Step 5: Run the strict build to verify green**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: PASS — exit 0, no unresolved-link warnings.

- [ ] **Step 6: Update `AGENTS.md` path references**

In `AGENTS.md` (the "Keep the mock-endpoint guide in sync" section), rewrite every `docs/site/docs/...` path and every "→ page" reference per the Old → new path map. Grep to confirm none remain:

Run: `grep -nE 'docs/site/docs/(guide|request-lifecycle)' AGENTS.md`
Expected: no output (all references updated).

- [ ] **Step 7: Commit**

```bash
git add -A docs/site AGENTS.md
git commit -m "docs: relocate guide pages into Build/Drive tree"
```

---

### Task 2: Retitle and trim the Overview page

**Files:**
- Modify: `docs/site/docs/index.md`

**Interfaces:**
- Consumes: the new `get-started/install.md` path (created in Task 3) — link to it as `get-started/install.md`; the strict build will confirm it once Task 3 lands. To keep this task's build green, point the teaser link at `get-started/first-mock.md` for now and re-point to `install.md` in Task 3, **or** run Tasks 2 and 3 back-to-back. Simplest: do Task 3 before Task 2's build check. (If executing strictly in order, use the note in Step 2.)

- [ ] **Step 1: Retitle the page**

Change the H1 on line 1 of `docs/site/docs/index.md` from `# Creating a Mock Endpoint` to `# Mock Server`. Update the intro paragraph so it reads as an overview of the whole tool (what it is, data-driven, no handler code), not "how to add an endpoint."

- [ ] **Step 2: Trim the "Running the server" section to a teaser**

Replace the `## Running the server` block (currently the `npx` + Docker + README-link prose) with a two-sentence teaser that defers detail:

```markdown
## Running the server

The fastest start is `npx @bilal-fazlani/mock-server ./catalog`; no external
MongoDB is required (an in-memory one auto-starts when
`MONGODB_CONNECTION_STRING` is unset). See **[Install & run](get-started/install.md)**
for Docker, from-source, and CI setups, and **[Configuration](reference/configuration.md)**
for every environment variable.
```

Note: `get-started/install.md` is created in Task 3. If you run this task's build before Task 3, temporarily point the link at `get-started/first-mock.md` and restore it in Task 3.

- [ ] **Step 3: Repoint "Where to go next" links**

In the closing list, ensure links use the new paths: `get-started/first-mock.md`, `building/endpoints.md`, `reference/request-lifecycle.md`, `reference/gotchas.md`. Add a bullet for **[Install & run](get-started/install.md)** and one for **[Driving mocks](driving/api.md)** (both created in later tasks — see the ordering note).

- [ ] **Step 4: Run the strict build**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: PASS (assuming Task 3/4 pages exist; otherwise run after them).

- [ ] **Step 5: Commit**

```bash
git add docs/site/docs/index.md
git commit -m "docs: retitle Home to Overview and trim running-the-server teaser"
```

---

### Task 3: New page — Get started → Install & run

**Files:**
- Create: `docs/site/docs/get-started/install.md`
- Modify: `docs/site/zensical.toml` (add nav entry)

**Interfaces:**
- Consumes: README install content (`README.md` sections "Getting started", "Install via npm", "Running via Docker", "Configuration") and `.env.example`.
- Produces: `get-started/install.md`, linked from `index.md` (Task 2) and the Configuration page.

- [ ] **Step 1: Write the page**

Create `docs/site/docs/get-started/install.md`. Adapt content from `README.md` (read those sections first; keep commands verbatim). Required structure and commands:

````markdown
# Install & run

Requirements: **Node.js 22+**. MongoDB is optional — if
`MONGODB_CONNECTION_STRING` isn't set, an in-memory MongoDB starts automatically
(data is ephemeral, lost on restart). Set it to use an external, persistent
MongoDB instead.

## npx (quickest)

```bash
npx @bilal-fazlani/mock-server ./catalog
```

The `[catalogPath]` argument overrides the `CATALOG_PATH` environment variable
(default `./catalog`). See [Configuration](../reference/configuration.md) for the
full list.

## Docker

```bash
docker run --rm -p 3000:3000 ghcr.io/bilal-fazlani/mock-server:latest
```

The image bakes in `mongod`, so with no `MONGODB_CONNECTION_STRING` it starts an
in-memory MongoDB (ephemeral). For a persistent MongoDB:

```bash
docker run --rm -p 3000:3000 \
  -e MONGODB_CONNECTION_STRING='mongodb://host.docker.internal:27017' \
  ghcr.io/bilal-fazlani/mock-server:latest
```

## From source (development)

```bash
git clone https://github.com/bilal-fazlani/mock-server
cd mock-server
npm install
cp .env.example .env
npm run dev
```

## Health check

`GET /ui/api/health` returns `200 {"status":"ok","mongo":"up"}` when MongoDB is
reachable, or `503 {"status":"error","mongo":"down"}` otherwise — useful as a
readiness probe (see [Using it in dev & CI](../driving/dev-and-ci.md)).
````

Verify the `npx`, `docker run`, and env details against `README.md` before saving; correct any drift in favor of the README's exact strings.

- [ ] **Step 2: Add the nav entry**

In `docs/site/zensical.toml`, add `Install & run` as the **first** child of `Get started`:

```toml
  { "Get started" = [
    { "Install & run" = "get-started/install.md" },
    { "Your first mock endpoint" = "get-started/first-mock.md" },
  ] },
```

- [ ] **Step 3: Run the strict build**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/site/docs/get-started/install.md docs/site/zensical.toml
git commit -m "docs: add Install & run page (canonical install/Docker)"
```

---

### Task 4: New page — Driving → Runtime-control API

**Files:**
- Create: `docs/site/docs/driving/api.md`
- Modify: `docs/site/zensical.toml` (nav), `docs/site/docs/building/scenarios.md` + `docs/site/docs/building/profiles.md` (cross-links)

**Interfaces:**
- Consumes (verify each before writing): `src/app/ui/api/catalog/route.ts`, `src/app/ui/api/global-mocks/route.ts`, `src/app/ui/api/global-mocks/[system]/[endpoint]/route.ts`, `src/app/ui/api/profiles/[profileId]/route.ts`, `src/app/ui/api/profiles/[profileId]/reset/route.ts`, `src/app/ui/api/logs/route.ts`, `src/app/ui/api/health/route.ts`, `src/lib/profiles/api-scenarios.ts`, `src/lib/scenarios.ts`.
- Produces: `driving/api.md`, linked from Building pages, the dev/CI page (Task 5), and Overview.

- [ ] **Step 1: Write the API page**

Create `docs/site/docs/driving/api.md`. Content, grounded verbatim in the routes:

````markdown
# Runtime-control API

A JSON HTTP API for **driving a running mock server** — flip scenarios, manage
profiles, reset sequence progress, and read request logs — without the UI. It
exists for local development and automated tests (see
[Using it in dev & CI](dev-and-ci.md)).

!!! warning "Local-dev only"

    The API is **unauthenticated** (matching the UI) and gives **no isolation
    guarantees** — global mocks are a single shared switch that parallel callers
    can clobber. Use profiles for per-caller isolation. It does **not** author
    mocks; you create endpoints and fixtures by writing catalog files.

## Why `/ui/api`

Mock endpoints are served at the root (`/…`), so the control API cannot live
there without colliding with a mocked route. `/ui` is the reserved admin
namespace; every control route lives under `/ui/api/*`.

## Endpoints

| Method & path | Request body | Success | Errors |
|---|---|---|---|
| `GET /ui/api/catalog` | — | `200` catalog projection | — |
| `GET /ui/api/global-mocks` | — | `200 { "scenarios": … }` | — |
| `PUT /ui/api/global-mocks/{system}/{endpoint}` | `{ "scenario": "<key>" }` | `200 { system, endpoint, scenario }` | `404` unknown endpoint · `400` not a global mock / scenario missing / not declared / bad JSON |
| `DELETE /ui/api/global-mocks/{system}/{endpoint}` | — | `204` (idempotent) | `404` unknown endpoint |
| `GET /ui/api/profiles/{profileId}` | — | `200` profile | `404 { "error": "not_found" }` |
| `PUT /ui/api/profiles/{profileId}` | `{ displayName?, endpointScenarios }` | `200` stored profile | `400` undeclared scenario / unknown endpoint / bad JSON |
| `DELETE /ui/api/profiles/{profileId}` | — | `204` (cascades) | — |
| `POST /ui/api/profiles/{profileId}/reset` | `{ endpoint? }` | `204` | — |
| `GET /ui/api/logs` | — (query params below) | `200 { "entries": … }` | — |
| `GET /ui/api/logs/{logId}` | — | `200` log entry | — |
| `GET /ui/api/health` | — | `200 { status, mongo }` | `503` Mongo down |

All routes are `force-dynamic` (never cached). Error responses are
`{ "error": "<message>" }`.

## `GET /ui/api/catalog`

Read-only discovery: systems → endpoints → declared scenarios. **No fixture
bodies.**

```json
{
  "systems": [
    {
      "slug": "hello-system",
      "name": "Hello System",
      "baseUrlEnv": "HELLO_BASE_URL",
      "endpoints": [
        {
          "name": "account_balance",
          "displayName": "Account Balance",
          "method": "POST",
          "path": "/accounts/balance",
          "mockType": "global",
          "hasResolver": true,
          "scenarios": { "default": "Balance available", "failure": "…" }
        }
      ]
    }
  ]
}
```

`scenarios` lists the **declared** fixtures only. The `real` passthrough is
always implicit; the `dynamic` scenario is available when `hasResolver` is
`true` (the endpoint has a `_dynamic.ts` resolver — see
[Dynamic scenarios](../building/dynamic.md)).

## `PUT /ui/api/profiles/{profileId}`

```json
{
  "displayName": "agent-run-42",
  "endpointScenarios": {
    "charge": "card_declined",
    "refund": ["pending", "settled"]
  }
}
```

`endpointScenarios` maps an endpoint **name** to either a single scenario key
(`string`) or an ordered [scenario sequence](../building/scenarios.md#scenario-sequences)
(`string[]`) served call-by-call. Every key is validated against the catalog: an
unknown endpoint name or a scenario that isn't declared (via the same rule the UI
uses) returns `400`. The response is the stored profile, as `GET` would return it.

## `PUT /ui/api/global-mocks/{system}/{endpoint}`

Body `{ "scenario": "<key>" }`. The endpoint must be `mockType: "global"`
(otherwise `400`); the scenario must be selectable on it (declared fixture,
`real`, or `dynamic` when it has a resolver) or `400`. `DELETE` reverts to the
implicit default and is idempotent (clearing an unset override still `204`s).

## `GET /ui/api/logs`

Query params: `profile`, `endpoint`, `errorsOnly=1`, `logId`, `since`, `before`,
`limit` (1–200). Returns `{ "entries": [ … ] }`. Fetch one full entry with
`GET /ui/api/logs/{logId}`. See [Request logs](request-logs.md) for the log shape.
````

Before saving, open each source file listed under **Interfaces** and confirm every status code, body field, and query param above matches. Correct the page to the code if anything differs (the code wins).

- [ ] **Step 2: Add cross-links on the Building pages**

In `docs/site/docs/building/scenarios.md`, add one sentence where scenario switching is described:

```markdown
You can also switch a scenario over the [Runtime-control API](../driving/api.md).
```

In `docs/site/docs/building/profiles.md`, add:

```markdown
Profiles can also be read, created, updated, and deleted via the
[Runtime-control API](../driving/api.md).
```

- [ ] **Step 3: Add the nav entry**

In `docs/site/zensical.toml`, make `Runtime-control API` the **first** child of `Driving mocks`:

```toml
  { "Driving mocks" = [
    { "Runtime-control API" = "driving/api.md" },
    { "Request logs" = "driving/request-logs.md" },
  ] },
```

- [ ] **Step 4: Run the strict build**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/site/docs/driving/api.md docs/site/docs/building/scenarios.md docs/site/docs/building/profiles.md docs/site/zensical.toml
git commit -m "docs: add Runtime-control API reference and cross-links"
```

---

### Task 5: New page — Driving → Using it in dev & CI

**Files:**
- Create: `docs/site/docs/driving/dev-and-ci.md`
- Modify: `docs/site/zensical.toml` (nav)

**Interfaces:**
- Consumes: `driving/api.md` (Task 4), `get-started/install.md` (Task 3), `src/app/ui/api/health/route.ts`, `src/lib/runtime.ts` (in-memory Mongo behavior).
- Produces: `driving/dev-and-ci.md`, linked from the API page and Overview.

- [ ] **Step 1: Write the page**

Create `docs/site/docs/driving/dev-and-ci.md`:

````markdown
# Using it in dev & CI

The mock server exists so your code can call it instead of real upstreams. Point
your app's upstream base URL (e.g. the value behind a system's `baseUrlEnv`) at
the running mock server, then choose scenarios in the UI or over the
[Runtime-control API](api.md).

## Local development

Run the server (`npx @bilal-fazlani/mock-server ./catalog`), set your app's
upstream URL to `http://localhost:3000`, and pick scenarios in `/ui`. Switch an
endpoint to the `real` scenario when you want that one call to hit the live
upstream — handy for migrating off real dependencies one endpoint at a time.

## Continuous integration

In CI the in-memory MongoDB is enough — each run starts clean and ephemeral data
is exactly what you want. Start the server, wait for `/ui/api/health`, then drive
it from your tests over the API.

```yaml
name: test
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Start mock server
        run: npx @bilal-fazlani/mock-server ./catalog &
      - name: Wait for health
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/ui/api/health && exit 0
            sleep 1
          done
          echo "mock server did not become healthy" >&2; exit 1
      - name: Run tests
        run: npm test
        env:
          PAYMENTS_BASE_URL: http://localhost:3000
```

### A worked control loop

Force a scenario, exercise your code, assert the call happened, clean up:

```bash
# 1. Force "charge" to the card_declined scenario for this caller
curl -sf -X PUT http://localhost:3000/ui/api/profiles/customer-123 \
  -H 'content-type: application/json' \
  -d '{"endpointScenarios":{"charge":"card_declined"}}'

# 2. ... run the code under test, which calls the mock as customer-123 ...

# 3. Assert your code actually called the endpoint
curl -sf 'http://localhost:3000/ui/api/logs?profile=customer-123&endpoint=charge'

# 4. Clean up
curl -sf -X DELETE http://localhost:3000/ui/api/profiles/customer-123
```

Use a **profile** (as above) for a profiled endpoint, or
`PUT /ui/api/global-mocks/{system}/{endpoint}` for a global one. Reset sequence
progress between tests with `POST /ui/api/profiles/{id}/reset`.

## Ephemeral vs persistent data

| Setting | When | Data |
|---|---|---|
| No `MONGODB_CONNECTION_STRING` | CI, quick local runs | In-memory Mongo, wiped on restart |
| `MONGODB_CONNECTION_STRING` set | Shared dev/staging, teams | External Mongo, survives restarts |

Profiles, global-mock selections, sequence progress, and request logs all live in
MongoDB, so a shared long-lived environment needs a real connection string; a
throwaway CI run does not.
````

Verify the health response shape and the in-memory-Mongo behavior against `src/app/ui/api/health/route.ts` and `src/lib/runtime.ts` before saving.

- [ ] **Step 2: Add the nav entry**

In `docs/site/zensical.toml`, insert `Using it in dev & CI` as the **second** child of `Driving mocks`:

```toml
  { "Driving mocks" = [
    { "Runtime-control API" = "driving/api.md" },
    { "Using it in dev & CI" = "driving/dev-and-ci.md" },
    { "Request logs" = "driving/request-logs.md" },
  ] },
```

- [ ] **Step 3: Run the strict build**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/site/docs/driving/dev-and-ci.md docs/site/zensical.toml
git commit -m "docs: add Using it in dev & CI page"
```

---

### Task 6: Trim the README to a quickstart

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the docs site (canonical). README now links to it for full install/Docker/config/CI detail.

- [ ] **Step 1: Reduce install/Docker/config prose to a quickstart**

In `README.md`, collapse the "Getting started" / "Install via npm" / "Running via Docker" / "Configuration" sections into a single short **Quickstart** that keeps only:
- the Node.js 22+ line,
- `npx @bilal-fazlani/mock-server ./catalog`,
- `docker run --rm -p 3000:3000 ghcr.io/bilal-fazlani/mock-server:latest`,

then a pointer: `Full install, Docker, CI, and configuration docs: <docs site URL>` (use the site's published URL; if unknown, link the repo's `docs/site/` and note "run `zensical serve`"). Keep the Features list, Scripts section, and the docs-build instructions. Do **not** remove the env-var table unless you first confirm `docs/site/docs/reference/configuration.md` carries the full table (it does) — then a one-line pointer replaces it.

- [ ] **Step 2: Verify README links resolve**

Run: `grep -nE '\]\(' README.md`
Expected: every relative link target exists; the docs pointer resolves. (README is not part of the Zensical build, so check by inspection.)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: trim README to quickstart; defer install detail to docs site"
```

---

## Self-Review

**Spec coverage:**
- Overview retitle + teaser → Task 2. ✔
- Install & run (npx/Docker/from-source) → Task 3. ✔
- Building pages moved → Task 1. ✔
- Runtime-control API reference → Task 4. ✔
- dev-and-ci (local + CI + ephemeral/persistent) → Task 5. ✔
- Request logs / Configuration / Request lifecycle / Gotchas moved → Task 1. ✔
- Cross-links from scenarios/profiles → Task 4. ✔
- README canonical trim → Task 6. ✔
- `AGENTS.md` path updates → Task 1 Step 6. ✔
- Strict build verification → every task. ✔

**Placeholder scan:** No TBD/TODO. New-page bodies are given in full; moved-page edits are link-only per the path map + strict build. Factual blocks (API table, catalog JSON, health, logs params) are copied from the routes read during planning.

**Type/name consistency:** Nav paths, folder names, and cross-link targets match across tasks (`get-started/ building/ driving/ reference/`, `driving/api.md`, `get-started/install.md`). Logs list response is `{ entries }` (verified against `src/app/ui/api/logs/route.ts`), health is `{ status, mongo }` (verified against `health/route.ts`).

**Ordering note:** Task 2's build turns green only once Tasks 3–4 exist (it links to `install.md` and `driving/api.md`). Recommended execution order: **1 → 3 → 4 → 5 → 2 → 6**, or run 2 immediately before its build with the temporary-link fallback noted in Task 2 Step 2. Subagent-driven execution should honor this ordering.
