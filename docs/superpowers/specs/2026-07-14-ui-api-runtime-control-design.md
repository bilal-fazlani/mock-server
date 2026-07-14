# Programmatic runtime-control API (`/ui/api/*`)

**Date:** 2026-07-14
**Status:** Approved design, ready for implementation plan

## Problem

An agent (or any automated test) developing against this mock server wants to
drive it programmatically: flip an endpoint to a failure scenario, run the code
under test, then assert *did my code actually call that endpoint, with what
payload*, and restore state afterward.

Today the runtime-control operations (switch scenario, manage profiles, reset
progress) exist only as Next.js **server actions** — `FormData` in, `redirect`
out — which a non-browser client cannot call cleanly. Request logs are the
exception: they already have a clean JSON read API.

Authoring mocks (creating endpoints, fixtures) is explicitly **out of scope** —
agents author those by writing catalog files, which they already do well. This
spec covers only *runtime control and observability*.

## Non-goals

- **No authentication.** The API is unauthenticated, matching the existing UI.
  Intended for local dev use.
- **No isolation guarantees.** Global mocks are a single shared switch; parallel
  callers can clobber each other. Profiles (which provide isolation) are exposed
  but this spec does not add machinery to guarantee non-collision.
- **No mock authoring.** No create/edit of endpoints, fixtures, or catalog files.

## Namespace

All routes live under `/ui/api/*`. This is mandatory: mock endpoints are served
at the root (`/…`), so any other prefix would collide with a mocked API. `/ui`
is the reserved UI/admin namespace.

## Approach

Add Next.js **route handlers** (`route.ts` files) under `src/app/ui/api/`. Each
handler calls the same `src/lib/profiles/store.ts` functions the UI server
actions already call — directly, skipping `FormData`/`redirect`/`revalidatePath`,
which are UI-only concerns. The store layer is already the shared core and is
already unit-tested, so no refactor of the existing server actions is needed.

## Endpoint surface

All paths under `/ui/api`. The two logs routes already exist and need no work.

| Method + path | Wraps (`store.ts` unless noted) | Notes |
|---|---|---|
| `GET /ui/api/catalog` | `getRuntime().catalog` | Read-only projection: systems → endpoints → declared scenarios + `mockType` + `hasResolver`. **No fixture bodies.** |
| `GET /ui/api/global-mocks` | `listGlobalMockScenarios` | Current global overrides. |
| `PUT /ui/api/global-mocks/{system}/{endpoint}` | `upsertGlobalMockScenario` | Body `{ "scenario": "<key>" }`. 400 if endpoint is not `mockType:'global'`, or scenario not declared. |
| `DELETE /ui/api/global-mocks/{system}/{endpoint}` | `clearGlobalMockScenario` | Reverts to the implicit default. 204 on success (idempotent — clearing an unset override still 204s). |
| `GET /ui/api/profiles/{profileId}` | `getProfile` | 404 if absent. |
| `PUT /ui/api/profiles/{profileId}` | `upsertProfile` | Body `{ displayName?, endpointScenarios }`. Validated against catalog. |
| `DELETE /ui/api/profiles/{profileId}` | `deleteProfile` | Cascades (mappings / progress / logs / dynamic history) — handled by the store fn. 204. |
| `POST /ui/api/profiles/{profileId}/reset` | `resetScenarioProgress` + `resetDynamicHistory` | Body `{ endpoint? }` — scoped to one endpoint if given, else the whole profile. 204. |
| `GET /ui/api/logs?profile=&endpoint=&errorsOnly=1&since=&before=&limit=&logId=` | `listLogSummaries` | **Already exists** at `src/app/ui/api/logs/route.ts`. No change. |
| `GET /ui/api/logs/{logId}` | `getLogEntry` | **Already exists** at `src/app/ui/api/logs/[logId]/route.ts`. No change. |

### `GET /ui/api/catalog` response shape

```json
{
  "systems": [
    {
      "slug": "payments",
      "name": "Payments",
      "baseUrlEnv": "PAYMENTS_BASE_URL",
      "endpoints": [
        {
          "name": "charge",
          "displayName": "Charge card",
          "method": "POST",
          "path": "/charges",
          "mockType": "global",
          "hasResolver": false,
          "scenarios": { "default": "Success", "card_declined": "Declined" }
        }
      ]
    }
  ]
}
```

`scenarios` is the declared map only (the `real` passthrough and `dynamic` are
implicit and not listed here — a client learns `real` is always available and
`dynamic` is available when `hasResolver` is true).

### `PUT /ui/api/profiles/{profileId}` body

```json
{
  "displayName": "agent-run-42",
  "endpointScenarios": {
    "charge": "card_declined",
    "refund": ["pending", "settled"]
  }
}
```

`endpointScenarios` maps endpoint `name` → `ScenarioSelection`, i.e. a single
scenario key (`string`) **or** an ordered sequence (`string[]`) served
call-by-call. This mirrors `ScenarioSelection` in `store.ts`.

## New code

1. **`src/lib/profiles/api-scenarios.ts`** (or similar) — a JSON validator
   mirroring `parseEndpointScenarios` from `src/lib/profiles/form.ts`, but
   reading a plain object instead of `FormData`. It:
   - rejects unknown endpoint names (400),
   - rejects scenario keys that aren't declared via `isScenarioDeclared` (400,
     naming the offending endpoint + scenario),
   - accepts both `string` and `string[]` (validating every step of a sequence),
   - returns a validated `Record<string, ScenarioSelection>`.
   Extract a shared per-step "assert declared" helper so `form.ts` and this
   module stay consistent, or keep them parallel — implementation plan decides.

2. **Route handlers** under `src/app/ui/api/`:
   - `catalog/route.ts` — `GET`
   - `global-mocks/route.ts` — `GET` (list)
   - `global-mocks/[system]/[endpoint]/route.ts` — `PUT`, `DELETE`
   - `profiles/[profileId]/route.ts` — `GET`, `PUT`, `DELETE`
   - `profiles/[profileId]/reset/route.ts` — `POST`
   All use `export const dynamic = 'force-dynamic'` (matching the logs routes).

## Behavior details

- **Admin-log parity.** The UI writes an `admin` log entry (`kind: 'admin'`) on
  profile save and progress reset so the action shows in the logs view. The API
  writes the equivalent entries (`profile_saved`, `progress_reset`) via the same
  `insertLogEntry` path for `PUT /profiles/{id}` and `POST /profiles/{id}/reset`,
  keeping the logs view consistent regardless of whether the UI or the API drove
  the change. Log-write failures are swallowed (warn only), as they are today.
- **Global-mock validation.** `PUT /global-mocks/{system}/{endpoint}` resolves
  the endpoint from the runtime catalog; unknown system/endpoint → 404, endpoint
  not `mockType:'global'` → 400, scenario not declared → 400.

## Error handling

- JSON error bodies: `{ "error": "<message>" }`.
- `400` — validation failures (undeclared scenario, unknown endpoint in a
  profile body, non-global endpoint on the global-mocks route, malformed JSON).
- `404` — unknown profile (`GET`), unknown system/endpoint (global-mocks).
- `200` — successful reads; `PUT /global-mocks/{system}/{endpoint}` returns the
  stored override `{ system, endpoint, scenario }`; `PUT /profiles/{id}` returns
  the stored profile (as `getProfile` would return it).
- `204` — successful `DELETE` and `POST /reset` with no body.

## Testing (vitest)

- **Unit:** the new JSON scenario validator — valid single/sequence selections,
  unknown endpoint, undeclared scenario, mixed valid/invalid sequence steps.
- **Handler tests:** import each exported `GET`/`PUT`/`DELETE`/`POST` and invoke
  with a constructed `Request`; assert status code, response body, and the
  resulting DB state (via the store read functions). Cover the happy path plus
  each documented error status. Reuse whatever Mongo test harness the existing
  store/logs tests use.

## Documentation impact (per `AGENTS.md`)

This adds a programmatic surface for behavior the guide currently documents as
UI-only. Likely-affected pages:

- `docs/site/docs/guide/reference/scenarios.md` — scenario switching now has an API.
- `docs/site/docs/guide/reference/profiles.md` — profile CRUD via API.
- `docs/site/docs/guide/reference/configuration.md` / `request-logs.md` — the
  `/ui/api/*` surface, incl. the already-existing logs endpoints.

Per the project rule, docs are **not** edited unprompted. After the code lands,
flag exactly what looks stale and ask the user before touching the guide.
