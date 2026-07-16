# Scenarios

## Scenarios & the `real` passthrough

Every scenario an endpoint can produce is backed by exactly one file in its
directory: either a fixture (`<scenario>.json`) or a code-backed resolver
(`<scenario>.ts`) — never both for the same slug. Either way the filename
(minus its extension) is the scenario key, matching the same grammar
`[a-z0-9][a-z0-9_-]*`. One name is reserved:

- `real` — **must never have a fixture or resolver file** (neither `real.json`
  nor `real.ts` may exist — a validation error either way). Every endpoint
  implicitly supports proxying the request to the live upstream whose base URL
  is read from the system's `baseUrlEnv`. The proxied status, headers, and body
  are returned as-is.

`default` is not reserved in the sense of being off-limits — it's **required**
on every endpoint, backed by either `default.json` or `default.ts`. Served
when a selection resolves to `default`, and under `UNMOCKED_USERS=DEFAULT_MOCK`.
Because it's a fixed name (not a repointable field), "follow the default" and
"pick `default`" are the same thing when `PASSTHROUGH_AS_DEFAULT=false`. When
`default` is backed by a resolver (`default.ts`), that resolver becomes the
endpoint's automatic, request-driven baseline — see [Code-backed scenario
resolvers](dynamic.md#defaultts-making-request-driven-routing-the-baseline).

An endpoint's scenarios can freely mix fixtures and resolvers — some slugs
`.json`, others `.ts` — with one constraint enforced at startup: every
endpoint needs **at least one fixture-backed scenario**, since a resolver must
ultimately return a fixture-backed slug (or `"real"`) and would otherwise have
nothing to return.

!!! warning "Base URL checks depend on the default"

    When `PASSTHROUGH_AS_DEFAULT=true`, the app refuses to start unless every
    system's `baseUrlEnv` (e.g. `HELLO_SYSTEM_URL`) is set. When it is `false`,
    startup allows missing base URLs; the UI warns on explicit `real` picks and
    the mock API returns `500` if a request resolves to `real` without an upstream
    URL.

## Code-backed scenarios

A scenario backed by `<slug>.ts` instead of `<slug>.json` defers the response
decision to a small TypeScript function instead of a static fixture: it looks
at the request (and a bounded history of what it returned before) and returns
the slug of a fixture-backed scenario on the same endpoint (or `"real"`) to
serve. That returned slug then flows through the normal pipeline — fixture
load or `real` passthrough, placeholder templating, schema validation, and
logging — exactly as if it had been picked directly. The full contract — the
input a resolver receives, the return invariant, error handling, and how it
shows up in the UI — is in [Code-backed scenario resolvers](dynamic.md).

## Scenario sequences

A profile's pick for an endpoint doesn't have to be a single scenario — it can be
an **ordered sequence** of scenarios served call-by-call. The first request that
endpoint receives for that profile gets step 1, the second gets step 2, and once
the sequence is exhausted every further call keeps getting the **last step** (it
"sticks"; there is no looping). This models flows where the same request should
answer differently over time:

- **Retry behaviour** — `timeout → timeout → default`: the caller's retry logic
  gets two failures, then success, within a single operation.
- **Polling / async flows** — `pending → pending → completed`: a status endpoint
  that eventually resolves.
- **State transitions** — `review_hold → default`: an assessment that is referred
  once, then accepted forever after.

Sequences are configured in the profile editor at `/ui`: switch an endpoint's card
from **Single** to **Sequence**, pick a scenario per step, reorder or remove
steps, and save. Any declared scenario is a valid step, including `real` — so
"first call hits the live upstream, later calls are mocked" (or the reverse) is
expressible — and any resolver-backed slug too, so one step of an otherwise
fixed sequence can defer to a resolver (e.g. `pending → by-amount → default`).
A one-step sequence is saved as a plain single pick.

Scenario picks — single or sequence — can also be set without the UI over the
[Runtime-control API](../driving/api.md), which is how automated tests drive the
server.

Mechanics worth knowing:

- **Progress is per profile + endpoint.** A counter in MongoDB
  (`scenarioProgress`) records how many calls have been served against the saved
  steps. Different profiles, and different endpoints of the same profile, advance
  independently.
- **Only sequences count calls.** A single-scenario pick never touches the
  counter.
- **Editing the sequence restarts it.** The counter is keyed to the exact saved
  steps; saving a different sequence makes the next call start again at step 1.
  The profile page also shows live progress ("N calls served", which step is
  next) with a **Reset progress** button for restarting manually mid-test.
- **Fresh profile, fresh sequence.** Progress is deleted with its profile, so
  test suites that create a new profile per test case never see stale progress.
  Reset also happens via the UI button, by saving a changed sequence, by
  recreating the profile, or over the
  [Runtime-control API](../driving/api.md) (`POST /ui/api/profiles/{id}/reset`).
- **The step is consumed at scenario-resolution time.** A call that later fails
  (e.g. schema validation of the request body) still advances the sequence.
- **Profiled endpoints only.** Global endpoints (`mockType: "global"`) have a
  single shared pick and don't support sequences.
