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
namespace; every control route lives under `/ui/api/*`. Error responses are
`{ "error": "<message>" }`.

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
| `GET /ui/api/health` | — | `200 { status, mongo, version, sha }` | `503` Mongo down (same body shape) |

## `GET /ui/api/catalog`

Read-only discovery: systems → endpoints → declared scenarios. **No fixture
bodies.**

```json
{
  "systems": [
    {
      "slug": "hello-system",
      "name": "Hello System",
      "baseUrlEnv": "HELLO_SYSTEM_URL",
      "endpoints": [
        {
          "name": "account_balance",
          "displayName": "Account Balance",
          "method": "POST",
          "path": "/accounts/balance",
          "mockType": "global",
          "resolverScenarios": ["dynamic"],
          "scenarios": { "default": "Balance available", "failure": "…", "pending": "…", "dynamic": "dynamic" }
        }
      ]
    }
  ]
}
```

`scenarios` lists every **declared** scenario (fixture- and resolver-backed) as
`{ slug: label }`. `resolverScenarios` is the subset of those slugs backed by a
`<slug>.ts` resolver instead of a `<slug>.json` fixture — see [Code-backed
scenario resolvers](../building/dynamic.md). The `real` passthrough is always
implicit and never appears in either list. `mockType` is `"profiled"` or
`"global"`.

## `GET /ui/api/global-mocks` · `PUT` · `DELETE`

`GET /ui/api/global-mocks` returns the current overrides as
`{ "scenarios": { … } }`.

`PUT /ui/api/global-mocks/{system}/{endpoint}` sets a global scenario. Body:

```json
{ "scenario": "failure" }
```

The endpoint must be `mockType: "global"` (otherwise `400`), and the scenario must
be selectable on it — any declared scenario (fixture- or resolver-backed) or
`real` (otherwise `400`). An unknown `system`/`endpoint` is `404`. On success it
returns `{ system, endpoint, scenario }`.

`DELETE /ui/api/global-mocks/{system}/{endpoint}` reverts to the implicit default
and is idempotent — clearing an unset override still returns `204`.

## `GET /ui/api/profiles/{profileId}` · `PUT` · `DELETE`

`GET` returns the stored profile, or `404 { "error": "not_found" }`.

`PUT` upserts a profile:

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
unknown endpoint name or a scenario that isn't declared (the same rule the UI
uses) returns `400`. `displayName` is optional. The response is the stored profile,
as `GET` would return it.

`DELETE` removes the profile and cascades to its mappings, sequence progress,
resolver history, and logs (`204`).

## `POST /ui/api/profiles/{profileId}/reset`

Resets [scenario sequence](../building/scenarios.md#scenario-sequences) progress
(and resolver history) so the next call starts from the first step. Body is
optional:

```json
{ "endpoint": "charge" }
```

With an `endpoint`, only that endpoint's progress resets; with no body (or
malformed JSON), the whole profile resets. Always `204`.

## Request logs

`GET /ui/api/logs` returns log summaries as `{ "entries": [ … ] }`. Query
parameters:

| Param | Meaning |
|---|---|
| `profile` | Filter by profile ID |
| `endpoint` | Filter by endpoint name |
| `errorsOnly=1` | Only error responses |
| `logId` | Match a specific log ID |
| `since` / `before` | Cursor bounds (log IDs) for paging |
| `limit` | Page size, clamped to 1–200 |

Fetch one full entry (with the decision trace and captured request/response) via
`GET /ui/api/logs/{logId}`. See [Request logs](request-logs.md) for what a log
records.
