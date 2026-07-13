# Project rules

## Keep the mock-endpoint guide in sync

There is a human-facing guide built with [Zensical](https://zensical.org) under
`docs/site/` (Markdown sources in `docs/site/docs/`, config in `docs/site/zensical.toml`).
It documents how to create a mock endpoint and every framework feature involved: the
catalog schema and endpoint fields, profile-ID selectors, path templates, scenarios and the
`real` passthrough, the fixture file shape, placeholders, strict vs. non-strict mode,
validation rules, and the request lifecycle. The guide pages are:

- `docs/site/docs/index.md` — mental model and the catalog tree overview
- `docs/site/docs/guide/getting-started.md` — the step-by-step walkthrough
- `docs/site/docs/guide/reference/endpoints.md` — endpoint/system fields and path templates
- `docs/site/docs/guide/reference/profiles.md` — profile-ID selectors and profile key mappings
- `docs/site/docs/guide/reference/scenarios.md` — scenarios, `real` passthrough, and sequences
- `docs/site/docs/guide/reference/fixtures.md` — fixture shape and placeholders
- `docs/site/docs/guide/reference/schemas.md` — `_schema.json` request/response validation
- `docs/site/docs/guide/reference/configuration.md` — env vars and catalog validation rules
- `docs/site/docs/guide/reference/request-logs.md` — request logging
- `docs/site/docs/request-lifecycle.md` — the full request routing flow

**Whenever you change app functionality that this guide describes, you MUST:**

1. **Check for drift.** After the change, compare it against the guide. Treat the change as
   guide-affecting if it touches any of (→ names the page that documents it):
   - the catalog tree or its file schemas (`_system.json`, `_endpoint.json`,
     scenario fixture files) — `catalog/`, `src/lib/catalog/load.ts`,
     `src/lib/catalog/types.ts` → `index.md`, `guide/reference/endpoints.md`
   - profile-ID extraction / selectors and profile key mappings — `src/lib/catalog/selector.ts`
     → `guide/reference/profiles.md`
   - path templates and matching — `src/lib/catalog/path-template.ts`
     → `guide/reference/endpoints.md`
   - scenarios or the `real` passthrough — `src/lib/router/passthrough.ts`,
     `src/lib/router/route-request.ts` → `guide/reference/scenarios.md`, `request-lifecycle.md`
   - fixture shape or resolution — `src/lib/mock-engine/fixtures.ts`
     → `guide/reference/fixtures.md`
   - placeholders / templating — `src/lib/mock-engine/template.ts`
     → `guide/reference/fixtures.md`
   - strict-mode / env behavior — `src/lib/runtime.ts`, `route-request.ts`
     → `guide/reference/configuration.md`, `request-lifecycle.md`
   - catalog validation rules — `src/lib/catalog/validate.ts`
     → `guide/reference/configuration.md`
   - schema validation — `_schema.json` handling → `guide/reference/schemas.md`
   - request logging — → `guide/reference/request-logs.md`
   - the request lifecycle, or the URL layout (mock at root `/…` vs. UI under `/ui/…`)
     → `request-lifecycle.md`, `index.md`

2. **Ask before editing.** If the change plausibly makes the guide stale, tell the user
   exactly what in the guide looks affected and **ask whether they want it updated**. Do not
   edit the guide unprompted.

3. **Update only on consent.** If the user says yes, update the relevant Markdown page(s)
   under `docs/site/docs/` to match the new behavior — keeping it accurate and grounded in
   the actual code (verify against the source files above, don't guess). After editing, run
   `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict` to
   confirm the site still builds and all internal links resolve. If the user declines, leave
   it untouched.

If a change clearly does not affect anything the guide covers (e.g. UI styling, unrelated
refactors, the health endpoint), you don't need to raise it.
