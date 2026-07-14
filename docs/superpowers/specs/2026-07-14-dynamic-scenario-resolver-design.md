# Dynamic scenario resolver (`_dynamic.ts`)

**Date:** 2026-07-14
**Status:** Design approved, ready for planning

## Problem

Today an endpoint's scenario is picked statically: a profile stores either nothing
(implicit default), a pinned slug, or a sequence array, and `resolveScenarioSelection`
(`src/lib/router/route-request.ts:248`) turns that into a scenario slug. That slug names a
fixture file, which flows through the template pipeline, schema validation, and logging.

Developers want to decide *which* response to serve based on the incoming request, how many
times the endpoint has been called, and what it returned before — flip-flops, "pending twice
then success", request-content branching, and computed/random picks. None of this is
expressible with static pins and fixed sequences.

## Solution overview

Introduce a **dynamic scenario resolver**: a developer-authored, trusted, version-controlled
TypeScript file `_dynamic.ts` that lives next to `_endpoint.json` in the catalog. It is a
**pure, synchronous function** that receives the request plus a bounded history of previously
returned slugs, and returns the slug of the scenario to serve.

The resolver is exposed as a **new reserved scenario slug, `dynamic`**, modeled exactly on the
existing `real` slug: it is injected into an endpoint's scenario list (in routing and in the
UI) — but, unlike `real`, only when a `_dynamic.ts` file is present. Selecting `dynamic` (per
profile, or per global-mock selection) makes routing run the resolver and **rewrite the
resolved scenario slug in place**, after which the existing request pipeline runs verbatim:
fixture load, `real` passthrough, placeholder templating, schema validation, tracing, and
logging are all unchanged.

### Why `dynamic` mirrors `real`

`real` is already a reserved, never-declared slug that is:

- injected into the routing scenario list (`scenariosWithPassthrough`, `src/lib/scenarios.ts`),
- injected into the UI scenario list (`buildScenarioViews`, `src/app/ui/catalog/scenario-view.ts:34`),
- reserved by catalog validation (`src/lib/catalog/validate.ts:117` forbids `real.json`),
- special-cased in routing (`route-request.ts:154` short-circuits to passthrough).

`dynamic` reuses this pattern with two differences:

| | `real` (today) | `dynamic` (this feature) |
|---|---|---|
| Storage | reserved slug string, pinnable like any scenario | **same** — `"dynamic"` is just a string; no new `ScenarioSelection` type, no profile-store change, sequences and delta-save untouched |
| Presence | universal — every endpoint | **conditional** — only when `_dynamic.ts` exists |
| When selected | terminal → passthrough | **not terminal** → runs the resolver, rewrites the scenario slug, then re-enters the normal pipeline |

This keeps the change small and symmetric, and preserves an **escape hatch**: to force
determinism (debugging, a demo, a failing test), pin a static scenario and the resolver steps
aside.

Rejected alternative — an **endpoint-level override** where the presence of `_dynamic.ts` makes
the endpoint *always* code-driven — was declined: it removes the ability to force a specific
scenario from the UI and forks the routing logic instead of composing with it.

## The resolver contract

`_dynamic.ts` default-exports a pure, synchronous function:

```ts
export default function pick(input: {
  request: {
    method: string
    path: string
    pathParams: Record<string, string>
    query: Record<string, string>
    headers: Record<string, string>
    body: unknown                    // parsed JSON, or null
  }
  history: string[]                  // last N returned slugs, oldest → newest
  profileId: string | null           // null for global endpoints
}): string {
  return input.history.length < 2 ? 'pending' : 'success'
}
```

- **Pure and synchronous.** No `await`, no I/O, no network, no filesystem. State that a
  resolver needs comes entirely from `history` — `history.length` is the call count,
  `history.at(-1)` enables flip-flops, and any stateful policy is a pure function of the
  request and the history window. This was a deliberate choice over arbitrary mutable state:
  it keeps resolvers deterministic, replayable, and easy to trace.
- **Return value** must be either a scenario declared for that endpoint, or `"real"`. It must
  **not** be `"dynamic"` (recursion) or any undeclared slug. `isScenarioDeclared`
  (`src/lib/scenarios.ts:23`) already accepts `"real"` and declared fixtures and rejects
  everything else, so it is the validation function for the return value.
- **`"real"` is allowed** (dynamic passthrough) — e.g. "premium customers hit the real API,
  test customers get mocks". Because the resolver rewrites `scenario` in place *before* the
  existing `if (scenario === REAL_SCENARIO)` branch (`route-request.ts:154`), returning
  `"real"` needs no new routing code; it falls into the existing passthrough path. See
  *Allowing `"real"`* below for the consequences.

## Execution model

- **Trusted, committed code.** `_dynamic.ts` is version-controlled and deployed with the mock
  server; whoever writes it already controls the server. This is not a defense against
  malicious authors — the sandbox exists to make the "pure, no-I/O, terminates" contract
  *enforceable* rather than merely documented.
- **Transpiled at startup.** During catalog load/validation, each `_dynamic.ts` is transpiled
  to JS via **`esbuild`** (a new runtime dependency) and evaluated once in a **`node:vm`
  context** with no `require` / `fetch` / `process` / network exposed. The compiled function
  is cached. A syntax error or wrong export shape is a **startup failure** (fail-fast, matching
  the existing startup-validation philosophy) — the server won't boot.
- **Per-request call with a timeout.** Each request calls the cached function with a fresh
  `input`. The `vm` runs with a timeout so a runaway synchronous loop (`while (true)`) returns
  a clean 500 instead of hanging the server.
- **Dev mode.** Fixtures are re-read per request in development (`src/lib/runtime.ts`). For
  parity and DX, `_dynamic.ts` may be re-transpiled per request in dev so edits apply live;
  in production it is transpiled once at startup and cached. (Implementation nuance, not a
  behavioral contract.)

## History store

- **Dedicated append store** (MongoDB), separate from request logs so resolver behavior does
  not depend on log retention/rotation.
- **Capped window** to the last **N** returned slugs, where `N = DYNAMIC_HISTORY_LIMIT` (env
  var, **default 10**). Surfaced on the environment page alongside the other env vars.
- **Keying** mirrors existing scenario state: per `(profileId, endpoint)` for profiled
  endpoints, per `(system, endpoint)` for global endpoints.
- **What is recorded:** the slug the resolver *returned*, recorded right after it returns and
  before it is executed — so history means "what I chose last time", independent of whether a
  subsequent passthrough or fixture load then succeeded. `"real"` is recorded like any other
  returned slug (so `history.at(-1) === 'real'` is meaningful).
- **Resettable** per profile (and per global endpoint), mirroring how sequence progress resets,
  so QA can start fresh.

## Routing integration

The change is localized. After the scenario selection resolves (`route-request.ts:143`
region), if the resolved slug is `"dynamic"`:

1. If the endpoint has no compiled resolver (`hasResolver === false`) → **route-time 500**,
   trace code `dynamic_resolver_missing` (see *Drift* below).
2. Read the endpoint's history window from the store for this key.
3. Build `input` from `ctx` (method, path, pathParams, query, headers, body) + history +
   profileId.
4. Run the resolver in the `vm` with a timeout.
   - Throws → 500, trace `dynamic_threw` (with message).
   - Times out → 500, trace `dynamic_timeout`.
   - Returns a value that is not `isScenarioDeclared` (includes `"dynamic"`, undeclared slugs,
     non-strings) → 500, trace `dynamic_bad_return`. Nothing is appended to history.
5. Append the returned slug to the history store (capped to N).
6. **Rewrite `scenario`** to the returned slug and fall through to the existing pipeline —
   `real` passthrough, fixture load, templating, schema validation, logging — all unchanged.

Everything downstream of scenario resolution is untouched.

## Trace / logging

The request log must show both hops so a reader can see what `dynamic` decided:

- `scenarioSource: 'dynamic'` (new source value), plus
- the resolved slug, e.g. `trace.dynamic = { returned: 'frozen' }` (or `'real'`).

So a log reads "pinned `dynamic` → resolver returned `frozen` → outcome `fixture`", or
"… → returned `real` → outcome `passthrough`". Without this, a dynamic-then-real request would
look like a bare passthrough and the `dynamic` step would vanish.

## Catalog loading & validation

- **Loader** (`src/lib/catalog/load.ts`): `_dynamic.ts` must be recognized explicitly and
  skipped from the scenario scan, the same way `_endpoint.json` and `_schema.json` are
  (`load.ts:50`). Otherwise it fails the `<name>.json` scenario regex and is reported as an
  "unexpected entry". Its presence sets a per-endpoint flag (e.g. `hasResolver: true` on
  `EndpointDef`).
- **Reserved slug** (`src/lib/catalog/validate.ts`): forbid a declared scenario named
  `dynamic` and a `dynamic.json` fixture, mirroring the existing `real` reservation
  (`validate.ts:117`).
- **Startup transpile** of every `_dynamic.ts`; failures aggregate into the startup error
  list (or a hard boot failure), consistent with how catalog/fixture/config errors already
  gate the runtime.

## Drift: `dynamic` pinned but `_dynamic.ts` deleted

A profile (or global-mock selection) can be pinned to `"dynamic"` and then have its
`_dynamic.ts` deleted. This is the **same drift already handled** for a pinned fixture scenario
that is later removed from the catalog (`scenario_undeclared`, `route-request.ts:182`).

- The pin persists in the profile/global-mock store (delta-save keeps deviations); deleting
  the file only changes the catalog on next startup.
- On restart, `hasResolver` becomes `false` and `dynamic` is no longer offered.
- A request whose pin resolves to `"dynamic"` with no resolver → **route-time 500**, trace
  `dynamic_resolver_missing`: *"dynamic scenario selected but endpoint `X` has no
  `_dynamic.ts`"*.
- **No auto-heal.** The router fails loud everywhere else on drift; silently reverting the pin
  to `default` would hide the mistake. Fix = restore the file, or re-select a scenario in the
  UI.
- **Not a startup failure.** Startup validation checks the catalog against fixtures/config; it
  cannot see runtime profile pins (Mongo data created after boot). So this drift only surfaces
  at request time — exactly like today's dangling fixture pins.
- **Orphaned history rows** for that key sit harmlessly in Mongo; left as-is, and resume if the
  file returns. No cleanup job.
- **UI nicety (optional, generic):** render a dangling pin as `dynamic — unavailable (no
  _dynamic.ts)` so the selector explains the 500s instead of showing a blank radio. This is the
  same orphan-pin situation any removed scenario creates and can be handled generically.

## Allowing `"real"` — consequences

Supported (decided), because the mechanism is nearly free and dynamic passthrough is a
legitimate use case. Consequences to keep in mind:

1. **Passthrough config can't be statically guaranteed.** `"real"` needs `system.baseUrlEnv`
   set; startup validation can't know a resolver *might* return `"real"`, so an unconfigured
   base URL becomes a runtime 500 (already a defensive, self-explaining error,
   `route-request.ts:400`), newly reachable.
2. **Request-schema-validation asymmetry.** `real` skips request-body validation (the check at
   `route-request.ts:162` is after the real branch); fixtures are validated. A resolver that
   returns `"real"` for some requests and a fixture for others means the same endpoint
   validates some requests and not others. This asymmetry already exists between pinned-real
   and pinned-fixture; dynamic makes it per-request.
3. **Passthrough is a real side effect.** `"real"` sends the request to a live upstream and (for
   profiled endpoints) runs `captureProfileKeys`, writing profile-key mappings — a bigger blast
   radius per call than a local fixture.
4. **History records `"real"`** (see History store).
5. **Trace clarity** (see Trace / logging) is what keeps dynamic-then-real requests legible.

## Environment page / configuration

- New env var **`DYNAMIC_HISTORY_LIMIT`** (default `10`), parsed like the other env vars in
  `src/lib/config.ts` (positive integer; invalid → `ConfigError` at startup).
- Threaded into `Runtime` (`src/lib/runtime.ts`) and shown on the environment page.

## Documentation impact (per `AGENTS.md`)

This feature is **guide-affecting** — it touches the catalog tree/file schema, scenarios, the
request lifecycle, configuration/env vars, and request logs. The following `docs/site/` pages
will need updates (to be done only with explicit consent, after the code design is settled):

- `docs/site/docs/index.md` — catalog tree overview (new `_dynamic.ts` file)
- `docs/site/docs/guide/reference/scenarios.md` — the `dynamic` scenario, resolver contract
- `docs/site/docs/guide/reference/endpoints.md` — `_dynamic.ts` alongside endpoint files
- `docs/site/docs/guide/reference/configuration.md` — `DYNAMIC_HISTORY_LIMIT`
- `docs/site/docs/guide/reference/request-logs.md` — `scenarioSource: dynamic` + resolved slug
- `docs/site/docs/request-lifecycle.md` — the dynamic resolution step in the flow
- possibly a new `docs/site/docs/guide/reference/dynamic.md` for the full resolver reference

After any doc edits, run
`docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`.

## Out of scope (v1)

- Async resolvers / resolver I/O (`fetch`, DB). Addable later if a concrete need appears; for
  now it contradicts the pure/deterministic design.
- Arbitrary mutable per-resolver storage beyond the bounded history window.
- History-orphan cleanup jobs.
