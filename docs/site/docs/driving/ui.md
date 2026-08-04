# The dashboard

The management UI at `<origin>/ui` is the human control surface for a running
mock server — the same operations the [Runtime-control API](api.md) exposes to
scripts, plus live views the API doesn't render. It is served by the mock server
itself under the reserved `/ui` namespace, so it can never collide with a mocked
route, and like the API it is **unauthenticated** — built for local dev and CI,
not for exposure.

Five pages, all reachable from the header:

| Page | What it's for |
| --- | --- |
| [Profiles](#profiles-ui) (`/ui`) | Create profiles and pick scenarios per caller |
| [Global mocks](#global-mocks-uiglobal-mocks) (`/ui/global-mocks`) | The shared pick for each profile-less endpoint |
| [Catalog](#catalog-uicatalog) (`/ui/catalog`) | Browse every declared system, endpoint, and scenario |
| [Logs](#logs-uilogs) (`/ui/logs`) | The live request log with decision traces |
| [Environment](#environment-uienvironment) (`/ui/environment`) | The configuration the server is actually running with |

## Profiles (`/ui`)

The home page lists every stored [profile](../building/profiles.md) — ID,
display name, last modified — with a **Create new profile** button. A profile
whose saved picks reference scenarios the catalog no longer declares is flagged
with a "needs updating" badge, so catalog drift is visible from the list rather
than discovered on a `500`.

A profile's page shows one card per profiled endpoint:

- **Single** mode picks one scenario: any declared fixture-backed scenario, a
  resolver-backed scenario — its chip shows a `file-code` icon in place of the
  selection dot, see [Code-backed scenario
  resolvers](../building/dynamic.md#selecting-a-resolver-backed-scenario) — or
  `Passthrough` (`real`), shown with a `globe` icon in the same slot. The icon
  or dot takes the scenario's tone color once selected. `Passthrough`'s chip
  also carries a red warning triangle beside its label whenever the system's
  `baseUrlEnv` isn't set — regardless of whether it's the current selection.
- **Sequence** mode turns the pick into an ordered
  [scenario sequence](../building/scenarios.md#scenario-sequences) served
  call-by-call, with live progress ("N calls served", which step is next) and a
  **Reset progress** button. Each step is a dropdown offering the same
  scenarios, with the same dot-or-icon slot and tone color on its closed
  trigger; every open option repeats that slot and shows the scenario's
  `summary` as a second line beneath its label, and nothing inside the open
  dropdown is clickable beyond picking an option.
- Whenever the current selection involves a resolver-backed slug, a **Reset
  resolver history** button clears that endpoint's
  [history windows](../building/dynamic.md#history).

Hovering, or tabbing to focus, a chip or a closed step trigger opens a hover
card with its label, an HTTP status pill (fixture-backed scenarios only — a
resolver or `Passthrough` has no status of its own), and its `summary` when
one is set. A fixture or resolver card adds a "View full response →"
(resolver: "View resolver code →") link that opens a modal — closed with
Escape or its close button, without leaving the page — showing the same
rendered content the [catalog](#catalog-uicatalog) page shows (the response
body for a fixture, the resolver's source for a resolver), plus an `Open
<endpoint> in the catalog` link; `Passthrough`'s card shows its fixed summary
("Forwards the request to the live upstream service.") with no link, followed
by either the resolved upstream URL (`→ http://localhost:9999`) when the
system's `baseUrlEnv` is set, or a warning naming the unset env var
(`HELLO_SYSTEM_URL is not set — requests will fail.`) when it isn't — the same
check behind the chip's warning triangle and the [Environment
page](#environment-uienvironment)'s Upstream group. Opening a step's dropdown
closes that step's card.

The card's link is reachable with a pointer; it isn't in the keyboard tab
order, so on a keyboard or a touch device use the endpoint's **View in
catalog** link instead, which shows every scenario's summary and rendered
content in one place.

Profiles store **deltas**: leaving an endpoint on the implicit scenario stores
nothing. A pick that has gone stale (its scenario file was removed) is shown as
a disabled `<slug> — unavailable` entry with no hover card or modal to
disclose, and the editor blocks saving until a valid scenario is chosen. The
page also carries a copy-the-profile-ID button, a
**Recent activity** card (that profile's slice of the
[request log](request-logs.md)), and **Delete profile**, which cascades to the
profile's mappings, sequence progress, resolver history, and logs.

## Global mocks (`/ui/global-mocks`)

One form listing every `mockType: "global"` endpoint with its scenario picker —
the shared selection that applies to **every** caller of that endpoint (see
[Endpoints](../building/endpoints.md)). The same delta rule, hover cards, and
response modal from the [Profiles](#profiles-ui) page apply here too: setting
an endpoint back to the implicit scenario clears its stored override, and
resolver-backed picks get the same `file-code` icon and **Reset resolver
history** button as on a profile page. Saved selections that no longer match
the catalog are counted and flagged at the top of the form.

## Catalog (`/ui/catalog`)

A read-only view of everything the catalog declares: each system with its
endpoints, and per endpoint a card for every scenario. A fixture-backed
scenario's card shows its label, its `summary` when one is set, and the fixture
JSON itself; a resolver-backed scenario's card shows the resolver's JavaScript
source, syntax-highlighted. A **Copy as cURL** button builds a runnable sample
request for the endpoint — including a placeholder `authorization` header when
the endpoint is profiled by a [Bearer selector](../building/profiles.md).

Use it to answer "what can I even pick?" without reading catalog files — it is
the browsable form of `GET /ui/api/catalog`.

## Logs (`/ui/logs`)

The live request log: every request the server received, streaming in at the
top, filterable by profile, endpoint, errors-only, or a specific log ID, with
each entry expanding to its full decision trace and captured request/response.
What a log entry records — and how `x-mock-log-id` response headers let a
failing test jump straight to its own trace — is covered in
[Request logs](request-logs.md) — including how each row's
[timestamp](request-logs.md#timestamps) is rendered in your browser's timezone
and carries UTC on hover. An expanded entry shows its log ID in the
detail footer, and beside it the caller's [distributed-trace
ID](request-logs.md#distributed-trace-correlation) when the request carried one.

## Environment (`/ui/environment`)

Every [configuration setting](../reference/configuration.md) the server was
started with, grouped by category, each row showing the live value and a status
chip — **Set** (explicitly configured), **Default** (falling back to the
documented default, shown as `(default: …)`), or **Unset** (no value and no
default). Secret values such as `MONGODB_CONNECTION_STRING` are shown as
`Hidden`, never echoed.

The **Upstream** group has one row per distinct `baseUrlEnv` declared in the
catalog, naming the systems it feeds — the quickest way to confirm whether
`real` passthrough for a system is actually configured before a request fails
for the missing URL (see
[Scenarios](../building/scenarios.md#scenarios-the-real-passthrough)).
