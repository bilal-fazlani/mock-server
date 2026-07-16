# Project rules

## Use Conventional Commits

This repo releases with [release-please](https://github.com/googleapis/release-please):
it derives the next version number and the changelog **entirely from commit messages**, so
every commit message — and every PR title, since PRs may be squash-merged — MUST follow the
[Conventional Commits](https://www.conventionalcommits.org) format:

```
type(optional-scope): imperative, lowercase summary
```

Types and their release effect:

| Type | Release effect | Use for |
| --- | --- | --- |
| `feat` | **minor** bump, shown under Features | a new capability |
| `fix` | **patch** bump, shown under Bug Fixes | a bug fix |
| `perf` | patch bump | a performance improvement |
| `docs`, `refactor`, `test`, `build`, `ci`, `chore` | **no** release | everything else |
| `revert` | patch bump | reverting a prior commit |

**Breaking changes** get a `!` after the type (`feat!: …`) or a `BREAKING CHANGE:` footer —
this drives a major bump (pre-1.0.0, it bumps the minor; see `release-please-config.json`).

Rules:
- Keep the summary in the **imperative mood** ("add", not "added"), lowercase, no trailing period.
- One logical change per commit; pick the type that reflects the user-facing effect.
- Don't invent types — use only the ones above. A non-conforming message breaks release-please's
  version/changelog computation.
- To force a specific next version (e.g. the first stable `1.0.0`), add a `Release-As: 1.0.0`
  footer to a commit rather than editing `package.json` by hand.

See [RELEASE.md](RELEASE.md) for the full release flow.

## Keep the mock-endpoint guide in sync

There is a human-facing guide built with [Zensical](https://zensical.org) under
`docs/site/` (Markdown sources in `docs/site/docs/`, config in `docs/site/zensical.toml`).
It documents how to create a mock endpoint and every framework feature involved: the
catalog schema and endpoint fields, profile-ID selectors, path templates, scenarios and the
`real` passthrough, the fixture file shape, placeholders, strict vs. non-strict mode,
validation rules, and the request lifecycle. It also covers installing and running the
server and the programmatic runtime-control API (`/ui/api/*`). The guide pages are:

- `docs/site/docs/index.md` — mental model and the catalog tree overview
- `docs/site/docs/get-started/install.md` — installing and running (npx, Docker, from source)
- `docs/site/docs/get-started/first-mock.md` — the step-by-step walkthrough
- `docs/site/docs/building/endpoints.md` — endpoint/system fields and path templates
- `docs/site/docs/building/profiles.md` — profile-ID selectors and profile key mappings
- `docs/site/docs/building/scenarios.md` — scenarios, `real` passthrough, and sequences
- `docs/site/docs/building/fixtures.md` — fixture shape and placeholders
- `docs/site/docs/building/schemas.md` — `_schema.json` request/response validation
- `docs/site/docs/driving/api.md` — the `/ui/api/*` runtime-control API reference
- `docs/site/docs/driving/dev-and-ci.md` — using the server in local dev and CI
- `docs/site/docs/driving/request-logs.md` — request logging
- `docs/site/docs/reference/configuration.md` — env vars and catalog validation rules
- `docs/site/docs/reference/request-lifecycle.md` — the full request routing flow

**Whenever you change app functionality that this guide describes, you MUST:**

1. **Check for drift.** After the change, compare it against the guide. Treat the change as
   guide-affecting if it touches any of (→ names the page that documents it):
   - the catalog tree or its file schemas (`_system.json`, `_endpoint.json`,
     scenario fixture files) — `catalog/`, `src/lib/catalog/load.ts`,
     `src/lib/catalog/types.ts` → `index.md`, `building/endpoints.md`
   - profile-ID extraction / selectors and profile key mappings — `src/lib/catalog/selector.ts`
     → `building/profiles.md`
   - path templates and matching — `src/lib/catalog/path-template.ts`
     → `building/endpoints.md`
   - scenarios or the `real` passthrough — `src/lib/router/passthrough.ts`,
     `src/lib/router/route-request.ts` → `building/scenarios.md`, `reference/request-lifecycle.md`
   - fixture shape or resolution — `src/lib/mock-engine/fixtures.ts`
     → `building/fixtures.md`
   - placeholders / templating — `src/lib/mock-engine/template.ts`
     → `building/fixtures.md`
   - strict-mode / env behavior — `src/lib/runtime.ts`, `route-request.ts`
     → `reference/configuration.md`, `reference/request-lifecycle.md`
   - catalog validation rules — `src/lib/catalog/validate.ts`
     → `reference/configuration.md`
   - schema validation — `_schema.json` handling → `building/schemas.md`
   - request logging — → `driving/request-logs.md`
   - the programmatic runtime-control API (scenario/profile/global-mock control,
     catalog discovery, progress reset, health) — `src/app/ui/api/**/route.ts`,
     `src/lib/profiles/api-scenarios.ts`, `src/lib/scenarios.ts`
     → `driving/api.md`, `driving/dev-and-ci.md`
   - the CLI, Docker image, or npm packaging (how the server is installed and run) —
     `bin/mock-server.js`, `Dockerfile`, `package.json` (`bin`/`scripts`)
     → `get-started/install.md`
   - the request lifecycle, or the URL layout (mock at root `/…` vs. UI under `/ui/…`)
     → `reference/request-lifecycle.md`, `index.md`

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
