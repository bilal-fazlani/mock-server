# Dynamic scenarios (`_dynamic.ts`)

## What it is

Drop an optional `_dynamic.ts` file next to `_endpoint.json`, in the endpoint
directory, and the endpoint gains a code-driven scenario picker:

```text
catalog/
  hello-system/
    account_balance/
      _endpoint.json
      _dynamic.ts        # optional — makes "Dynamic" selectable for this endpoint
      default.json
      pending.json
      failure.json
```

It is trusted, version-controlled TypeScript, deployed with the mock server —
not a sandbox against malicious authors, but a way to *enforce* the resolver
contract (pure, synchronous, no I/O) rather than merely document it.

`_dynamic.ts` default-exports a function that looks at the incoming request and
a bounded history of what it returned before, and picks which declared scenario
(or `real`) should answer this call:

```ts
export default function pick(input: {
  request: {
    method: string
    path: string
    pathParams: Record<string, string>
    query: Record<string, string[]>
    headers: Record<string, string>
    body: unknown
  }
  history: string[]
  profileId: string | null
}): string {
  const body = input.request.body as { forceFail?: boolean } | null
  if (body?.forceFail) return 'failure'
  return input.history.length < 2 ? 'pending' : 'default'
}
```

Called against `POST /accounts/balance`, this resolver answers `pending` for
the first two calls a caller makes, then `default` for every call after that —
and jumps straight to `failure` any time the request body carries
`"forceFail": true`, regardless of history. It models an async job that needs
polling before it settles, with an escape hatch for forcing the failure path in
a test.

## `dynamic` is a reserved scenario, like `real`

`dynamic` is a reserved scenario slug modeled on the existing `real` slug (see
[Scenarios](scenarios.md)):

- It is **never** a fixture. A declared scenario literally named `dynamic`, or
  a `dynamic.json` file, is a catalog validation error — the same rule that
  forbids `real.json`.
- It is injected as a selectable option — in the profile scenario picker, the
  global-mocks form, and the `/ui/catalog` endpoint page — **only when the
  endpoint has a `_dynamic.ts`**. Remove the file and `Dynamic` disappears from
  every picker (subject to the drift behavior below for pins that already
  point at it).
- It works for both **profiled** and **global** (`mockType: "global"`)
  endpoints — the resolver receives `profileId: null` for global endpoints.
- Selecting `Dynamic` doesn't terminate routing the way `real` does. It runs
  the resolver, takes the scenario slug it returns, and **substitutes** that
  slug in place of `dynamic` — then the normal pipeline runs exactly as if that
  slug had been picked directly: fixture load (or `real` passthrough),
  placeholder templating, request/response schema validation, and logging are
  all unchanged. See [Request lifecycle](../../request-lifecycle.md) for where
  this substitution happens in the ordered walk.

## The resolver contract

- **Default export, pure, synchronous.** No `await`, no `require`, no
  `fetch`, no `process`, no other I/O — the function runs inside a `node:vm`
  sandbox with none of that exposed. It receives one `input` object and must
  `return` a `string` — there is nothing else to interact with.
- **Input shape** (`ResolverInput`):

  | Field | Type | Notes |
  | --- | --- | --- |
  | `request.method` | `string` | The endpoint's configured HTTP method. |
  | `request.path` | `string` | The endpoint's path template (not the raw incoming URL). |
  | `request.pathParams` | `Record<string, string>` | Extracted `{param}` values, same as selectors see. |
  | `request.query` | `Record<string, string[]>` | **Every value is an array**, even for a single occurrence — lossless for repeated query params. Read a single value with `input.request.query.customerId?.[0]`. |
  | `request.headers` | `Record<string, string>` | Incoming request headers. |
  | `request.body` | `unknown` | The parsed JSON body, or `null` if there wasn't one. |
  | `history` | `string[]` | Previously *returned* slugs for this endpoint + owner, oldest → newest, capped to `DYNAMIC_HISTORY_LIMIT`. `history.length` is a call counter; `history.at(-1)` lets a resolver flip-flop. |
  | `profileId` | `string \| null` | The resolved profile ID for a profiled endpoint; always `null` for a global endpoint. |

- **Return value** must be either a scenario **declared for that endpoint**
  (one of its `<scenario>.json` files, or `default`) or the string `"real"`
  (dynamic passthrough). It must **not** be `"dynamic"` itself (no recursion)
  and must not be an undeclared slug or a non-string value.
- **`"real"` is a legitimate return** — e.g. "route premium customers to the
  live upstream, keep everyone else mocked." Because the router substitutes the
  returned slug before the existing `real` branch, this needs no special
  handling; it just falls into normal passthrough, with the usual consequences:
  request-schema validation is skipped for that call, and (for profiled
  endpoints) `captureProfileKeys` still runs.
- **State is the history window, nothing else.** There is no mutable
  per-resolver storage beyond `history` — a stateful policy must be a pure
  function of `request` and `history`.

## History

Returned slugs are recorded in a dedicated MongoDB collection, separate from
request logs, so resolver behavior never depends on log retention:

- **Keyed** the same way other per-endpoint state is: `(profile, profileId,
  endpoint)` for a profiled endpoint, `(global, systemSlug, endpoint)` for a
  global one.
- **Capped** to the last `DYNAMIC_HISTORY_LIMIT` entries (default `10` — see
  [Configuration](configuration.md#app-configuration)).
- **What's recorded:** the slug the resolver *returned*, appended right after
  it passes return-value validation — *before* that slug's own fixture load or
  `real` proxying happens. An invalid return, a thrown error, or a timeout
  appends **nothing**. `"real"` is recorded like any other slug, so
  `history.at(-1) === 'real'` is meaningful on the next call.
- **Resettable.** Both the profile page and the global-mocks form show a
  **Reset dynamic history** button next to an endpoint pinned to `Dynamic`,
  mirroring the sequence **Reset progress** button — useful for restarting a
  "pending twice then success" resolver mid-test.
- **Cleaned up with its owner.** Deleting a profile deletes its dynamic history
  rows along with its scenario progress. Clearing a global-mock selection
  (resetting the endpoint back to its default) likewise drops that endpoint's
  `(global, systemSlug, endpoint)` history — re-pinning it to `Dynamic` later
  starts fresh. Switching a selection from `Dynamic` to another scenario keeps
  the history, as does removing an endpoint's `_dynamic.ts`: that history is
  simply orphaned in Mongo (no cleanup job) and resumes being read if the file
  comes back.

## Errors and drift

An invalid resolver outcome always fails loud with `500`, never a silent
fallback:

| Situation | Trace error code | When |
| --- | --- | --- |
| `_dynamic.ts` fails to transpile or doesn't default-export a function | `dynamic_compile_error` | Dev mode, at request time (production catches this at startup instead — see below). |
| Scenario pinned to `dynamic`, but the endpoint has no `_dynamic.ts` | `dynamic_resolver_missing` | Any time — see *Drift* below. |
| The resolver throws | `dynamic_threw` | Request time. |
| The resolver exceeds its timeout (~100&nbsp;ms) | `dynamic_timeout` | Request time — guards against a runaway synchronous loop. |
| The resolver returns something other than a declared scenario or `"real"` (including `"dynamic"` itself, an undeclared slug, or a non-string) | `dynamic_bad_return` | Request time. |

!!! warning "Drift: pinned to `dynamic`, but `_dynamic.ts` is removed"

    A profile (or global-mock selection) can be pinned to `dynamic` and then
    have its `_dynamic.ts` deleted from the catalog. This is the same kind of
    drift as a fixture-scenario pin whose file disappears
    (`scenario_undeclared`) — the pin persists in MongoDB across the file
    change, and only the next catalog load knows the resolver is gone.

    - A request that resolves to `dynamic` with no compiled resolver returns a
      loud `500` with trace code `dynamic_resolver_missing`. There is no
      auto-heal to `default`.
    - The scenario picker (profile page, global-mocks form, catalog page)
      renders the dangling pin as a disabled entry labeled
      `Dynamic — unavailable (no _dynamic.ts)` instead of silently dropping it,
      and the profile editor blocks saving the profile until a valid scenario is
      chosen.
    - Fix by restoring `_dynamic.ts` or picking a different scenario in the UI.

## Compilation, sandboxing, and timeouts

- **Compiled at boot — fail-fast in both dev and production.** When the runtime
  first initializes, *every* endpoint's `_dynamic.ts` is transpiled (via esbuild)
  and compiled up front, and any resolver that fails to transpile or doesn't
  default-export a function aborts that initialization — the same fail-fast error
  list as catalog and fixture problems. This is not production-only: a resolver
  that is already broken at boot fails hard in development too (the first request
  to *any* endpoint throws the aggregated startup error, not a scoped
  `dynamic_compile_error`). `npm run validate:catalog` runs the same compilation
  step, so a broken resolver is caught before deploy.
- **Live edits in development recompile per request.** After a good boot, dev
  mode re-reads and recompiles each endpoint's `_dynamic.ts` on every request
  (matching how fixtures are re-read live in dev). So if you edit a resolver
  mid-session and *introduce* a compile error, only that endpoint returns a
  request-time `500` (`dynamic_compile_error`) while the rest of the server keeps
  running — the dev server does not crash. In production, resolvers are compiled
  once at boot and never recompiled per request.
- **Sandboxed execution.** The compiled function runs in a `node:vm` context
  with no `require`, `fetch`, `process`, or network access — by design, not
  merely by convention, since `_dynamic.ts` is meant to be pure. Each
  invocation runs under a short timeout (about 100&nbsp;ms) so a `while (true)`
  bug returns a clean `500` instead of hanging the request.

## Selecting Dynamic

On a profile page, an endpoint that has `_dynamic.ts` gets `Dynamic` as one
more entry in its **Single**-mode scenario picker, alongside `default`, any
other declared scenarios, and `Passthrough`. Selecting it and saving means
every future call to that endpoint, for that profile, runs the resolver; once
selected, a **Reset dynamic history** button appears for clearing that
profile's history window. The same `Dynamic` entry — and its **Reset dynamic
history** button — is available on the **global mocks** form for global
endpoints, clearing that endpoint's global history window. On the
`/ui/catalog` endpoint page
it shows up as an expandable card alongside the fixture scenarios and
`Passthrough`, describing itself as resolved at request time by
`_dynamic.ts` rather than showing fixture JSON.

`Dynamic` is one of the same scenario options offered per step in a
[scenario sequence](scenarios.md#scenario-sequences), just like `default` or
`real` — so a sequence can mix fixed steps with a step that defers to the
resolver (e.g. `pending → dynamic → default`).
