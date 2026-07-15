# Scenarios

## Scenarios & the `real` passthrough

Each `<scenario>.json` file in an endpoint directory is a fixture-backed outcome
the endpoint can produce; the filename (minus `.json`) is the scenario key. A
few names are reserved:

- `default` — **required on every endpoint** (`default.json` must exist). Served
  when a selection resolves to `default`, and under `UNMOCKED_USERS=DEFAULT_MOCK`.
  Because it's a fixed name (not a repointable field), "follow the default" and
  "pick `default`" are the same thing when `PASSTHROUGH_AS_DEFAULT=false`.
- `real` — **must never have a fixture file** (a `real.json` is a validation
  error). Every endpoint implicitly supports proxying the request to the live
  upstream whose base URL is read from the system's `baseUrlEnv`. The proxied
  status, headers, and body are returned as-is.
- `dynamic` — **must never have a fixture file** either (a `dynamic.json` is a
  validation error, same as `real.json`), and only appears **conditionally**:
  it's offered as a scenario only for endpoints that have a `_dynamic.ts` file
  in their directory. Selecting it hands the pick to that code instead of a
  fixed slug — see [Dynamic scenarios](dynamic.md) for the full contract.

!!! warning "Base URL checks depend on the default"

    When `PASSTHROUGH_AS_DEFAULT=true`, the app refuses to start unless every
    system's `baseUrlEnv` (e.g. `HELLO_SYSTEM_URL`) is set. When it is `false`,
    startup allows missing base URLs; the UI warns on explicit `real` picks and
    the mock API returns `500` if a request resolves to `real` without an upstream
    URL.

## The `dynamic` scenario

`dynamic` is modeled directly on `real`: a reserved slug that's never a
fixture file, and is available on every endpoint that qualifies for it. The
difference is that `real` is unconditional, while `dynamic` only shows up when
the endpoint directory has a `_dynamic.ts` resolver next to `_endpoint.json`.

Picking `dynamic` for a profile (or a global mock selection) doesn't itself
determine the response — it defers that decision to the resolver, which runs
on every request and returns the actual scenario slug (or `real`) to serve.
That returned slug then flows through the normal pipeline: fixture load or
`real` passthrough, placeholder templating, schema validation, and logging,
exactly as if it had been picked directly. The full contract — the input a
resolver receives, its history window, error handling, and how it shows up in
the UI — is in [Dynamic scenarios](dynamic.md).

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
expressible — and, for an endpoint with a resolver, `dynamic` too, so one step
of an otherwise fixed sequence can defer to the resolver. A one-step sequence
is saved as a plain single pick.

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
