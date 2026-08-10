# Runtime-control API

A JSON HTTP API for **driving a running mock server** — flip scenarios, manage
profiles, reset sequence progress, and read request logs — without the UI. It
exists for local development and automated tests (see
[Using it in dev & CI](dev-and-ci.md)); the human counterpart is
[the dashboard](ui.md). On the JVM you rarely call it by hand — the
[Java SDK](../sdk/index.md) is a packaged consumer of everything below.

!!! warning "Local-dev only"

    The API is **unauthenticated** (matching the UI) and gives **no isolation
    guarantees** — global mocks are a single shared switch that parallel callers
    can clobber. Use profiles for per-caller isolation. It does **not** author
    mocks; you create endpoints and fixtures by writing catalog files.

## Why `/ui/api`

Mock endpoints are served at the root (`/…`), so the control API cannot live
there without colliding with a mocked route. `/ui` is the reserved admin
namespace; every control route lives under `/ui/api/*`. Error responses are
`{ "error": "<message>", "code": "<code>" }` — `error` is wording for humans,
`code` is a stable identifier for scripts (see [Error codes](#error-codes)) —
except `GET /ui/api/health`, whose `503` keeps the health body shape and adds a
bare `error` field to it, with no `code`.

## Stability & machine-readable spec

The whole contract is published as an OpenAPI 3.1 document, served by the running
server:

```bash
curl -s http://localhost:3000/ui/api/openapi.json
```

Point a client generator or a request-validating proxy at it instead of
hand-writing calls — or, on the JVM, use the hand-written one in the
[Java SDK](../sdk/testcontainers-client.md#the-runtime-control-client), which
tracks this contract and ignores what it does not recognise. It covers every
route below, plus the ones the dashboard uses internally, and it carries its own
`info.version` — the version of the *contract*, not of the build. The build is
what `GET /ui/api/health` reports as `version` and `sha`.

The API **evolves additively**. New routes, new optional request fields, new
response fields, and new members of an existing enum arrive in ordinary
releases, so **ignore fields you don't recognise** — a client that rejects
unknown properties breaks on an upgrade that broke nothing. Existing fields are
not removed or retyped, and the status code for an existing outcome does not
change, without a major bump of `info.version`.

Two things sit outside that promise:

- **Error message text.** The `{ "error": "<message>", "code": "<code>" }`
  envelope is stable, and so is `code` — match on it. `error` is wording for
  humans and changes freely between releases.
- **Presentation fields** — the log detail's `bodyHtml`, and the `html` carried
  by a scenario view (the spec's dashboard-internal
  `GET /ui/api/catalog/{system}/{endpoint}/scenarios/{slug}`). They exist for
  the dashboard, and everything they show is also available structurally in the
  same response.

### Error codes

Every non-2xx `/ui/api/*` response carries one of these codes, except
`GET /ui/api/health`'s `503`, which has no `code` (see
[Why `/ui/api`](#why-uiapi)). A code not in this table may still appear in an
additive release — ignore ones you don't recognise rather than rejecting the
response.

| Code | Status | Route(s) | When |
|---|---|---|---|
| `invalid_json` | `400` | `PUT /ui/api/global-mocks/{system}/{endpoint}`<br>`PUT /ui/api/profiles/{profileId}` | The request body doesn't parse as JSON. |
| `unknown_endpoint` | `404` | `GET /ui/api/catalog/{system}/{endpoint}/scenarios/{slug}`<br>`PUT`/`DELETE /ui/api/global-mocks/{system}/{endpoint}` | No such `system`/`endpoint`. |
| `unknown_scenario` | `404` | `GET /ui/api/catalog/{system}/{endpoint}/scenarios/{slug}` | `slug` isn't a scenario declared on the endpoint. |
| `endpoint_not_global` | `400` | `PUT /ui/api/global-mocks/{system}/{endpoint}` | The endpoint's `mockType` isn't `"global"`. |
| `scenario_required` | `400` | `PUT /ui/api/global-mocks/{system}/{endpoint}` | `scenario` is missing, empty, or not a string. |
| `scenario_not_declared` | `400` | `PUT /ui/api/global-mocks/{system}/{endpoint}` | `scenario` isn't declared on the endpoint, and isn't `real`. |
| `invalid_scenario_selection` | `400` | `PUT /ui/api/profiles/{profileId}` | `endpointScenarios` is malformed: not an object, an unknown endpoint name, a selection that's neither a string nor a string array, or a scenario not declared on its endpoint. `error` says which. |
| `profile_not_found` | `404` | `GET /ui/api/profiles/{profileId}` | No profile with that ID. |
| `log_not_found` | `404` | `GET /ui/api/logs/{logId}` | No log entry with that ID. |

## Endpoints

| Method & path | Request body | Success | Errors |
|---|---|---|---|
| `GET /ui/api/catalog` | — | `200` catalog projection | — |
| `GET /ui/api/global-mocks` | — | `200 { "scenarios": [ … ] }` | — |
| `PUT /ui/api/global-mocks/{system}/{endpoint}` | `{ "scenario": "<key>" }` | `200 { system, endpoint, scenario }` | `404 unknown_endpoint` · `400 endpoint_not_global` / `scenario_required` / `scenario_not_declared` / `invalid_json` |
| `DELETE /ui/api/global-mocks/{system}/{endpoint}` | — | `204` (idempotent) | `404 unknown_endpoint` |
| `GET /ui/api/profiles/{profileId}` | — | `200` profile | `404 profile_not_found` |
| `PUT /ui/api/profiles/{profileId}` | `{ displayName?, endpointScenarios }` | `200` stored profile | `400 invalid_scenario_selection` / `invalid_json` |
| `DELETE /ui/api/profiles/{profileId}` | — | `204` (cascades) | — |
| `POST /ui/api/profiles/{profileId}/reset` | `{ endpoint? }` | `204` | — |
| `GET /ui/api/logs` | — (query params below) | `200 { "entries": … }` | — |
| `GET /ui/api/logs/{logId}` | — | `200 { "entry": …, "bodyHtml": … }` | `404 log_not_found` |
| `GET /ui/api/health` | — | `200 { status, mongo, version, sha }` | `503` Mongo down (same fields, plus `error`, no `code`) |

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
        },
        {
          "name": "create_order",
          "displayName": "Create Order",
          "method": "POST",
          "path": "/orders",
          "mockType": "profiled",
          "profileIdSelector": "$.customerId",
          "captureProfileKeys": [{ "namespace": "order-id", "keySelector": "$.orderId" }],
          "resolverScenarios": [],
          "scenarios": { "default": "Accepted" }
        }
      ]
    }
  ]
}
```

`scenarios` lists every **declared** scenario (fixture- and resolver-backed) as
`{ slug: label }`. `resolverScenarios` is the subset of those slugs backed by a
`<slug>.mjs` resolver instead of a `<slug>.json` fixture — see [Code-backed
scenario resolvers](../building/dynamic.md). The `real` passthrough is always
implicit and never appears in either list. `mockType` is `"profiled"` or
`"global"`.

`profileIdSelector` and `captureProfileKeys` mirror the endpoint's catalog
definition verbatim — see [Profile-ID extraction](../building/profiles.md#profile-id-extraction-selectors)
and [Profile key mappings](../building/profiles.md#profile-key-mappings) for
the selector grammar and capture semantics. Both are additive and optional:

- `profileIdSelector` is present on every `profiled` endpoint (the catalog
  fails to load without one) and absent on every `global` endpoint (the
  catalog fails to load if one is declared there) — it always agrees with
  `mockType`.
- `captureProfileKeys` presence tracks whether the catalog definition includes
  the key at all, not whether it lists any captures — an endpoint that
  declares an explicit empty array projects as `captureProfileKeys: []`;
  omitted, not an empty array, when the field itself is absent. It can appear
  only alongside a `profileIdSelector` that resolves the ID directly rather
  than through `profileKey:<namespace>:…`.

Above, `account_balance` has neither field (`global`); `create_order` declares
both, matching `catalog/hello-system/create_order/_endpoint.json` in this
repo's demo catalog.

## `GET /ui/api/global-mocks` · `PUT` · `DELETE`

`GET /ui/api/global-mocks` returns the overrides in force as
`{ "scenarios": [ … ] }` — one `{ system, endpoint, scenario, createdAt,
modifiedAt }` record per endpoint that has one, most recently changed first.
Endpoints sitting on their implicit default are absent.

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

`GET` returns the stored profile, or
`404 { "error": "not_found", "code": "profile_not_found" }`.

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

`GET /ui/api/logs` returns log entries as `{ "entries": [ … ] }` — each a
`LogSummary` by default, or a full `LogEntry` (captured request and response
bodies included) when the request sets `include=full`. It can also
[wait for entries to arrive](#awaiting-calls), in which case the body carries a
`matched` flag alongside them. Query parameters:

| Param | Meaning |
|---|---|
| `profile` | Filter by profile ID |
| `endpoint` | Filter by endpoint name |
| `errorsOnly=1` | Only error responses |
| `validation` | Only entries with a given [schema-validation outcome](request-logs.md#schema-validation-outcomes): `issues` (failed or drifted), `failed`, `drift`, `ok`, or `unchecked`. An unrecognised value is ignored rather than rejected. |
| `logId` | Match a specific log ID (case-insensitive prefix) |
| `traceId` | Match a specific [trace ID](request-logs.md#distributed-trace-correlation) (exact match) |
| `since` / `before` | Cursor bounds (log IDs) for paging |
| `limit` | Page size, clamped to 1–200 |
| `include=full` | Return the full entry — captured request and response bodies included — instead of the summary projection. Any other value is ignored. |
| `minCount` | Wait until this many entries match before answering — see [Awaiting calls](#awaiting-calls). Defaults to `1` |
| `waitMs` | How long to wait for `minCount`, in milliseconds, clamped to 0–60000. Defaults to `10000` |

### Awaiting calls

A test that fires an async flow — a background poller, a queue consumer — has to
wait for the call to land before it can assert on it. Sending `minCount` or
`waitMs` holds the request open until enough entries match, so one call replaces
a client-side polling loop:

```bash
# Answer as soon as "charge" has been called 3 times, giving up after 5s
curl -sf 'http://localhost:3000/ui/api/logs?profile=customer-123&endpoint=charge&minCount=3&waitMs=5000'
```

```json
{ "entries": [ … ], "matched": true }
```

`matched` says whether the threshold was reached before the deadline. It is
present only when you asked to wait, and a timeout is a normal `200` carrying
whatever did match — check `matched`, not the HTTP status. Read it rather than
counting `entries`: the threshold counts every matching entry, while the page
you get back is still capped by `limit`.

The rules:

- **Every filter applies as it normally does.** Combine the wait with `profile`,
  `endpoint`, `validation`, and the rest to await something specific.
- **Pair it with `since`** — a cursor from the previous read — to count only
  entries newer than that point, which is how you await "*N more* calls" rather
  than "*N* calls in total".
- **Either parameter turns the wait on**, and each defaults the other:
  `waitMs=5000` alone waits for a single new entry, `minCount=3` alone waits the
  default 10s. Values that don't parse fall back to those defaults rather than
  failing the request.
- **The answer comes as soon as the threshold holds**, so a condition that is
  already true costs nothing extra. `waitMs=0` checks once and returns.
- **`before` never waits.** It pages backwards from a cursor, and no new entry
  can appear behind one.

The `since` cursor remains the alternative when you'd rather not hold a
connection open: read, remember the newest log ID, and poll it yourself.

Fetch one full entry by ID (with the decision trace and captured
request/response) via `GET /ui/api/logs/{logId}`, which answers
`{ "entry": { … }, "bodyHtml": { … } }`, or
`404 { "error": "not_found", "code": "log_not_found" }` if no entry has that ID
— it may have aged out of the log's TTL window. See
[Request logs](request-logs.md) for what a log records.

`bodyHtml` is presentation data for the dashboard — syntax-highlighted markup
for the entry's request and response bodies, keyed `request` and `response`.
**Scripts should read `entry` and ignore it.** A side is omitted when that body
is absent or was stored as a raw string rather than structured JSON, and the
whole field is omitted when neither side qualifies, so treat every level as
optional. The bodies themselves are unchanged inside `entry` — nothing is only
available as markup.
