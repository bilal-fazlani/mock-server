# Docs restructure: Build / Drive information architecture

**Date:** 2026-07-15
**Status:** Proposed design, awaiting user review

## Problem

The docs site under `docs/site/` is an **authoring guide only** — every page
answers "how do I write a mock endpoint?" Four gaps follow from that:

1. **No installation section.** `npx`, Docker, and from-source setup exist only in
   the [README](../../../README.md); the site links out for Docker and shows one
   `npx` line ([index.md:7–22](../../site/docs/index.md)).
2. **No consumer/CI story.** Nothing shows how your app or test suite points at
   the mock server in local dev or CI.
3. **The new `/ui/api/*` runtime-control API is undocumented.** `grep` finds zero
   mentions of `/ui/api` across the guide, including the pre-existing logs API.
4. **"Home" vs "Getting started" have blurred responsibilities.** Home is titled
   "Creating a Mock Endpoint" but is actually orientation; Getting started is the
   tutorial. Both titles say "endpoint," so they read as duplicates.

### Root cause

There are **two audiences** and the current tree blends them:

- **The mock author** — builds the catalog: systems, endpoints, profiles,
  scenarios, fixtures, schemas. This is ~all of the current guide.
- **The mock consumer / test author** — whose app and CI call a running server
  and drive it via the UI or the new `/ui/api/*` API, then assert against request
  logs.

The current nav (and the first restructure proposal) interleaved these, so no
page signals "for *building* mocks" vs "for *using* them." It also had
inconsistent altitude (a top-level "Using in your workflow" beside a nested
"Getting started") and a single-child "How it works" section.

## Decision (approved)

Reorganize the whole site around the two audiences: **Building mocks** (authoring
the catalog) vs **Driving mocks** (operating a running server). Make the docs site
the **canonical** source for install/Docker/configuration; trim the README to a
quickstart that links to the site.

## Target navigation

```
Overview                         index.md
Get started
  Install & run                  get-started/install.md          (NEW, from README)
  Your first mock endpoint       get-started/first-mock.md       (moved: guide/getting-started.md)
Building mocks
  Endpoints                      building/endpoints.md           (moved)
  Profiles                       building/profiles.md            (moved)
  Scenarios                      building/scenarios.md           (moved)
  Dynamic scenarios              building/dynamic.md             (moved)
  Fixtures                       building/fixtures.md            (moved)
  Schemas                        building/schemas.md             (moved)
Driving mocks
  Runtime-control API            driving/api.md                  (NEW, from route code)
  Using it in dev & CI           driving/dev-and-ci.md           (NEW)
  Request logs                   driving/request-logs.md         (moved)
Reference
  Configuration                  reference/configuration.md      (moved)
  Request lifecycle              reference/request-lifecycle.md  (moved)
  Gotchas                        reference/gotchas.md            (moved)
```

Why this shape:

- **Get started** puts Install and the tutorial at the *same* altitude — fixes the
  altitude inconsistency. Install comes from README content, canonical here.
- **Building vs Driving** is the two-audience cut. Everything under Building is
  "how to write catalog files"; everything under Driving is "how to control and
  observe a live server." The API sits next to the CI page it powers and the logs
  you assert against — its real neighbors.
- **Reference** holds the three pages that belong to *neither* audience
  exclusively (Configuration spans env + validation; Request lifecycle is
  explanation; Gotchas is a grab-bag). No section has a single child.

## Page-by-page plan

Each page names its source grounding so the content stays true to code, not guessed.

### Overview — `index.md` (rewrite header + running-the-server section)

- Retitle away from "Creating a Mock Endpoint" (e.g. **"Mock Server"** /
  **"Overview"**) so it stops colliding with the tutorial. Keep the mental-model
  table, the catalog-tree diagram, and "where to go next" (repoint links to new
  paths).
- Trim the "Running the server" block to a one-paragraph teaser that links to
  **Get started → Install & run** instead of carrying `npx`/Docker detail inline.
- Grounding: existing `index.md`; new nav paths.

### Get started → Install & run — `get-started/install.md` (NEW)

Canonical install page, lifted and adapted from the README:

- Requirements (Node.js 22+; MongoDB optional — in-memory auto-starts when
  `MONGODB_CONNECTION_STRING` is unset, data ephemeral).
- **npx**: `npx @bilal-fazlani/mock-server ./catalog`; the `[catalogPath]` arg vs
  `CATALOG_PATH`.
- **Docker**: `docker run --rm -p 3000:3000 ghcr.io/bilal-fazlani/mock-server:latest`,
  plus the persistent-MongoDB variant with `-e MONGODB_CONNECTION_STRING=…`.
- **From source** (dev): clone, `npm install`, `.env.example`, dev server.
- Link to **Reference → Configuration** for the full env table.
- Grounding: [README.md](../../../README.md) "Getting started" / "Install via
  npm" / "Running via Docker" / "Configuration" sections; `.env.example`.

### Get started → Your first mock endpoint — `get-started/first-mock.md` (moved)

- Content = current `guide/getting-started.md` (the 5-step `POST /accounts/balance`
  walkthrough). Retitle to "Your first mock endpoint." Fix relative links to
  Building-section pages.
- Add a closing pointer to **Driving mocks** ("you picked a scenario in the UI —
  you can also do it over the API").

### Building mocks — six pages moved verbatim

`endpoints.md`, `profiles.md`, `scenarios.md`, `dynamic.md`, `fixtures.md`,
`schemas.md` move from `guide/reference/` to `building/`. **Content unchanged**
except:

- Fix internal cross-links to new paths.
- **Add a short cross-link** on the pages the API touches, pointing to
  `driving/api.md`:
  - `scenarios.md` — "…or switch a scenario over the [Runtime-control API]."
  - `profiles.md` — "…profiles can also be created/updated/deleted via the [API]."
  (These three cross-links are called out in the API's own design spec,
  [2026-07-14-ui-api-runtime-control-design.md](2026-07-14-ui-api-runtime-control-design.md).)

### Driving mocks → Runtime-control API — `driving/api.md` (NEW)

Full reference for `/ui/api/*`, grounded strictly in the route handlers under
`src/app/ui/api/` and the API design spec. Sections:

- **What it's for / non-goals.** Programmatic control for dev & automated tests;
  unauthenticated, local-dev only; no isolation guarantees; not for authoring
  mocks. (from design spec Problem / Non-goals.)
- **Why `/ui/api`.** Mock endpoints own the root path; `/ui` is the reserved admin
  namespace, so the control API must live under it.
- **Endpoint table** — every route, method, body, and status, verbatim from code:

  | Route | Body | Success | Errors |
  |---|---|---|---|
  | `GET /ui/api/catalog` | — | 200 projection | — |
  | `GET /ui/api/global-mocks` | — | 200 `{ scenarios }` | — |
  | `PUT /ui/api/global-mocks/{system}/{endpoint}` | `{ "scenario" }` | 200 `{ system, endpoint, scenario }` | 404 unknown; 400 not-global / undeclared / bad JSON |
  | `DELETE /ui/api/global-mocks/{system}/{endpoint}` | — | 204 (idempotent) | 404 unknown |
  | `GET /ui/api/profiles/{profileId}` | — | 200 profile | 404 absent |
  | `PUT /ui/api/profiles/{profileId}` | `{ displayName?, endpointScenarios }` | 200 stored profile | 400 undeclared/unknown/bad JSON |
  | `DELETE /ui/api/profiles/{profileId}` | — | 204 (cascades) | — |
  | `POST /ui/api/profiles/{profileId}/reset` | `{ endpoint? }` | 204 | — |
  | `GET /ui/api/logs?…` | — | 200 summaries | — |
  | `GET /ui/api/logs/{logId}` | — | 200 entry | — |

- **`GET /ui/api/catalog` response shape** — systems → endpoints →
  `{ name, displayName, method, path, mockType, hasResolver, scenarios }`;
  `scenarios` is the declared map only (`real` always implicit; `dynamic` implied
  by `hasResolver: true`). (from `catalog/route.ts`.)
- **`PUT /ui/api/profiles/{id}` body** — `endpointScenarios` maps endpoint `name`
  → scenario key (`string`) or ordered sequence (`string[]`); validated against
  the catalog (undeclared scenario / unknown endpoint → 400). (from
  `profiles/[profileId]/route.ts`, `lib/profiles/api-scenarios.ts`.)
- **Error body convention** — `{ "error": "<message>" }`.
- Grounding: `src/app/ui/api/**/route.ts`, `src/lib/scenarios.ts`
  (`isScenarioSelectable`), `src/lib/profiles/api-scenarios.ts`, and the existing
  logs routes.

### Driving mocks → Using it in dev & CI — `driving/dev-and-ci.md` (NEW)

The consumer workflow, built on the API. **Proposed default scope** (flag if you
want it narrower/wider):

- **Local dev.** Point your app's upstream base URL at the mock server; use the
  UI to pick scenarios; the `real` passthrough for gradual migration.
- **CI.** Start the server (npx in background or a Docker service; in-memory Mongo
  is enough — ephemeral is fine per run), wait for health, then a worked loop:
  `PUT` a profile to force a failure → run the code under test → `GET /ui/api/logs`
  to assert the call happened with the right payload → `DELETE`/`reset` to clean
  up. One concrete GitHub Actions snippet (repo is on GitHub).
- **Ephemeral vs persistent.** When in-memory Mongo suffices (CI, quick local) vs
  a real `MONGODB_CONNECTION_STRING` (shared dev/staging), and what resets on
  restart.
- Grounding: the API design spec's Problem statement (this is its motivating use
  case); `src/app/ui/api/**`; README Docker/env content; `src/lib/runtime.ts` for
  the in-memory Mongo behavior.

### Driving mocks → Request logs — `driving/request-logs.md` (moved)

Moved from `guide/reference/`. Add a cross-link to `driving/api.md` for the JSON
logs endpoints (which the API page also lists). Otherwise unchanged.

### Reference — three pages moved

`configuration.md`, `request-lifecycle.md` (from top-level `request-lifecycle.md`),
`gotchas.md` (from `guide/gotchas.md`). Content unchanged except cross-link path
fixes. `configuration.md` gains the canonical, full env-var table (already there);
Install links to it.

## README trimming (docs-site canonical)

Reduce README install/Docker/config prose to a **quickstart** (one `npx` line, one
`docker run` line, Node 22+ requirement) plus "Full install, Docker, CI, and
configuration docs → <docs site link>." Keep the features list, scripts, and the
docs-build instructions. Do **not** delete the env table wholesale until the
Configuration page is confirmed to carry it (it already does).

## Mechanical scope & risks

- **File moves** change URLs and break relative cross-links. Every moved page's
  inbound and outbound links must be repointed. The **strict Zensical build** is
  the safety net (fails on any unresolved internal link).
- **`AGENTS.md` references specific doc paths** (the "Keep the mock-endpoint guide
  in sync" section lists `docs/site/docs/...` filenames). Those path references
  must be updated to the new locations as part of this work.
- `zensical.toml` `nav` is rewritten to the target tree above.

## Verification

After edits: run
`docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
and confirm a clean build with all internal links resolved.

## Open decisions (defaults chosen; veto in review)

1. **Overview page title** — default **"Overview"** (nav label stays or becomes
   "Overview"). Alt: keep "Home."
2. **Gotchas placement** — default: under **Reference**. Alt: keep top-level.
3. **`dev-and-ci.md` scope** — default: local dev + CI (with a GitHub Actions
   snippet) + ephemeral-vs-persistent. Veto any of the three.
4. **Physical file moves vs nav-only regroup** — default: **move files** into
   `get-started/ building/ driving/ reference/` so folders mirror the IA (updating
   links + `AGENTS.md`). Alt: leave files in place, change only `nav` labels
   (less churn, but folders no longer match the tree).
5. **`.venv` / Zensical availability** — the build step assumes
   `docs/site/.venv/bin/zensical` exists (per AGENTS.md). Confirm it's set up, or
   we bootstrap it first.

## Out of scope

- No changes to app behavior or the API itself.
- No new authoring features.
- No visual/theme changes beyond nav.
