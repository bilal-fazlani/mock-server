# Code-backed scenario resolvers (`<slug>.mjs`)

## What it is

Every scenario is backed by either a fixture (`<slug>.json`) or a **resolver**
(`<slug>.mjs`) — same slug grammar (`[a-z0-9][a-z0-9_-]*`), same directory, just
a different file extension. A slug can never have both:

```text
catalog/
  hello-system/
    account_balance/
      _endpoint.json
      default.json      # fixture-backed scenario
      pending.json       # fixture-backed scenario
      failure.json       # fixture-backed scenario
      dynamic.mjs          # resolver-backed scenario — an ordinary slug, not special
```

There is no special filename for a resolver — `dynamic.mjs` above is a plain
example slug, not a reserved concept. Name resolver files for what they do
(`by-amount.mjs`, `poll-twice-then-succeed.mjs`, `default.mjs`); the slug becomes
the label shown in pickers, logs, and the catalog page (unless overridden by
`description` — see below).

Resolvers are trusted, version-controlled JavaScript, deployed with the mock
server — not a sandbox against malicious authors, but a way to *enforce* the
resolver contract (pure, synchronous, no I/O) rather than merely document it.

A resolver default-exports a function that looks at the incoming request and a
bounded history of what it returned before, and picks which scenario should
answer this call:

```js
export default function pick(input) {
  const body = input.request.body
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

## The return invariant

> A resolver must return the slug of a **fixture-backed** scenario declared on
> the same endpoint, or `"real"`. It must never return a resolver-backed slug
> (including itself), an undeclared slug, or a non-string value.

This is the one rule everything else follows from:

- **No resolver chaining.** A resolver cannot hand off to another resolver, or
  to itself — every resolver call terminates in a fixture or `real`.
- **`"real"` is a legitimate return** — e.g. "route premium customers to the
  live upstream, keep everyone else mocked." Because the router substitutes the
  returned slug before the existing `real` branch, this needs no special
  handling; it just falls into normal passthrough, with the usual consequences:
  request-schema validation is skipped for that call, and (for profiled
  endpoints) `captureProfileKeys` still runs.
- **An invalid return always fails loud with `500`**, never a silent fallback
  — see the error table below.

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
  | `history` | `string[]` | Previously *returned* slugs for this endpoint + owner + **this resolver's own slug**, oldest → newest, capped to `RESOLVER_HISTORY_LIMIT`. `history.length` is a call counter; `history.at(-1)` lets a resolver flip-flop. |
  | `profileId` | `string \| null` | The resolved profile ID for a profiled endpoint; always `null` for a global endpoint. |

- **State is the history window, nothing else.** There is no mutable
  per-resolver storage beyond `history` — a stateful policy must be a pure
  function of `request` and `history`.
- **Optional `export const description = '…'`** alongside the default export
  becomes the resolver's UI label — read at compile time, exactly mirroring
  the fixture `description` field. Without it, the picker, catalog page, and
  logs fall back to showing the slug itself:

  ```js
  export const description = 'Routes by transfer amount'

  export default function pick(input) {
    // …
  }
  ```

- **Optional `export const summary = '…'`** is shown as a secondary line
  beneath the label on the catalog viewer's endpoint page — the resolver
  counterpart of the fixture `summary` field, also read at compile time. It
  appears only there (not in the picker or logs), and an empty string is
  treated as absent:

  ```js
  export const description = 'Routes by transfer amount'
  export const summary = 'Large transfers hold; small ones settle'

  export default function pick(input) {
    // …
  }
  ```

### Editor support (optional)

For autocomplete on `input` in any editor, paste this self-contained JSDoc
block at the top of the resolver — it needs nothing installed and no
`tsconfig.json`, and is safe to delete:

```js
// @ts-check
/** @typedef {{request: {method: string, path: string,
 *   pathParams: Record<string,string>, query: Record<string,string[]>,
 *   headers: Record<string,string>, body: unknown},
 *   history: string[], profileId: string | null}} ResolverInput */

/** @param {ResolverInput} input */
export default function pick(input) {
  return input.history.length < 2 ? 'pending' : 'default'
}
```

## `default.mjs`: making request-driven routing the baseline

Because `default` is the zero-delta scenario a no-pick profile lands on
(when `PASSTHROUGH_AS_DEFAULT=false`), backing it with a resolver — `default.mjs`
instead of `default.json` — makes **request-driven routing the endpoint's
automatic baseline**. Profiles that need a fixed outcome regardless of the
request body still pin a fixture-backed scenario as an override; profiles with
no pick get the resolver's decision.

For a money-transfer endpoint that should route by amount:

```text
catalog/
  payments/
    transfer/
      _endpoint.json
      default.mjs        # routes by amount — the automatic baseline
      success.json
      reject.json
      hold.json
      failure.json
```

```js
export const description = 'Routes by transfer amount'

export default function routeByAmount(input) {
  const amount = input.request.body?.amount ?? 0
  if (amount > 100_000) return 'hold'
  if (amount > 10_000) return 'reject'
  return 'success'
}
```

Every caller with no explicit pin gets amount-based routing automatically. A
QA profile that always needs `reject` for a specific caller still pins
`reject` directly — a plain fixture pin, no code, and it takes priority over
the resolver because the resolver never runs for that profile in the first
place (its saved pick is `reject`, not `default`). A resolver **may** return
`default` in this setup — it's just an ordinary fixture-backed slug on this
endpoint like any other; the old asymmetry where a `_dynamic.ts`-style
resolver couldn't return `default` no longer exists.

This pattern only auto-fires where `default` is the implicit scenario, i.e.
`PASSTHROUGH_AS_DEFAULT=false` (the default). Under `PASSTHROUGH_AS_DEFAULT=true`,
a no-pick profile proxies to the upstream instead; a profile must explicitly
pin `default` to invoke the resolver.

Opt-in code routing (what used to be `_dynamic.ts`) is simply a resolver with
any other name — pinned per profile, per global-mock selection, or used as one
step of a [scenario sequence](scenarios.md#scenario-sequences) — and multiple
policies per endpoint are possible: different profiles can pin different
resolver-backed scenarios, with zero hardcoded `profileId` checks in any of
them.

## History

Returned slugs are recorded in a dedicated MongoDB collection, separate from
request logs, so resolver behavior never depends on log retention:

- **Keyed per slug:** `(ownerType, ownerKey, endpoint, slug)` — `(profile,
  profileId, endpoint, slug)` for a profiled endpoint, `(global, systemSlug,
  endpoint, slug)` for a global one. Each resolver-backed scenario on an
  endpoint has its own history window, independent of any other resolver on
  the same endpoint.
- **Capped** to the last `RESOLVER_HISTORY_LIMIT` entries (default `10` — see
  [Configuration](../reference/configuration.md#app-configuration)).
- **What's recorded:** the slug the resolver *returned*, appended right after
  it passes return-value validation — *before* that slug's own fixture load or
  `real` proxying happens. An invalid return, a thrown error, or a timeout
  appends **nothing**. `"real"` is recorded like any other slug, so
  `history.at(-1) === 'real'` is meaningful on the next call.
- **Resettable.** Both the profile page and the global-mocks form show a
  single **Reset resolver history** button per endpoint, whenever the current
  selection — single pick or any sequence step — involves a resolver-backed
  slug. It clears **all** resolver slugs' history windows for that
  owner+endpoint in one action, mirroring the sequence **Reset progress**
  button — useful for restarting a "pending twice then success" resolver
  mid-test.
- **Cleaned up with its owner.** Deleting a profile deletes its resolver
  history rows along with its scenario progress. Clearing a global-mock
  selection (resetting the endpoint back to its default) likewise drops that
  endpoint's global history for the slugs involved.

## Errors

| Situation | Trace error code | When |
| --- | --- | --- |
| The `.mjs` file fails to transpile or doesn't default-export a function | `resolver_compile_error` | Dev mode, at request time (production catches this at startup instead — see below). |
| A slug is resolver-backed (declared in the endpoint's resolver scenarios) but no compiled resolver is found for it | `resolver_missing` | Request time. Nothing is appended to history. |
| The resolver throws | `resolver_threw` | Request time. |
| The resolver exceeds its timeout (~100&nbsp;ms) | `resolver_timeout` | Request time — guards against a runaway synchronous loop. |
| The resolver returns something other than a fixture-backed declared scenario or `"real"` (including a resolver-backed slug, an undeclared slug, or a non-string) | `resolver_bad_return` | Request time. Nothing is appended to history. |

`resolver_missing` and the old `dynamic_resolver_missing` are not the same
thing. The old code fired when a profile pinned the reserved `dynamic` slug and
the endpoint's `_dynamic.ts` had since been removed. That case no longer exists:
`dynamic` isn't a reserved name, so a pin at a slug whose `.mjs` file was later
deleted means the slug is **no longer resolver-backed at all** — it's ordinary
undeclared-scenario drift, exactly like a fixture-scenario pin whose file
disappears. The picker renders it as a disabled `<slug> — unavailable` entry,
the profile editor blocks saving until a valid scenario is chosen, and a live
request that still resolves to it fails with `scenario_undeclared` (see
[Request lifecycle](../reference/request-lifecycle.md)). `resolver_missing`
covers a different situation: the slug **is** declared resolver-backed on the
endpoint, but no compiled resolver could be produced for it at request time.

## Compilation, sandboxing, and timeouts

- **Compiled at boot — fail-fast in both dev and production.** When the runtime
  first initializes, *every* endpoint's `<slug>.mjs` resolvers are transpiled
  (via esbuild) and compiled up front, and any resolver that fails to
  transpile or doesn't default-export a function aborts that initialization —
  the same fail-fast error list as catalog and fixture problems. A leftover
  `<slug>.ts` resolver (from before authoring moved to `.mjs`-only) is caught
  on the same list, with an error telling you to rename it — never silently
  skipped. This is not
  production-only: a resolver that is already broken at boot fails hard in
  development too (the first request to *any* endpoint throws the aggregated
  startup error, not a scoped `resolver_compile_error`). `npm run
  validate:catalog` runs the same compilation step, so a broken resolver is
  caught before deploy.
- **Live edits in development recompile per request.** After a good boot, dev
  mode re-reads and recompiles each resolver on every request that reaches it
  (matching how fixtures are re-read live in dev). So if you edit a resolver
  mid-session and *introduce* a compile error, only that endpoint returns a
  request-time `500` (`resolver_compile_error`) while the rest of the server
  keeps running — the dev server does not crash. In production, resolvers are
  compiled once at boot and never recompiled per request.
- **Sandboxed execution.** The compiled function runs in a `node:vm` context
  with no `require`, `fetch`, `process`, or network access — by design, not
  merely by convention, since a resolver is meant to be pure. Each invocation
  runs under a short timeout (about 100&nbsp;ms) so a `while (true)` bug
  returns a clean `500` instead of hanging the request.

## Selecting a resolver-backed scenario

On a profile page, a resolver-backed scenario appears as one more entry in an
endpoint's **Single**-mode scenario picker, alongside fixture-backed scenarios
and `Passthrough` — tagged with a small `</>` code badge ("Resolved by code at
request time") so it's visually distinct from a fixture pick, while keeping
the same tone rules (`default` green, other slugs amber, `real` red — a
`default.mjs` *is* still the store-nothing baseline). Selecting it and saving
means every future call to that endpoint, for that profile, runs the resolver;
once selected, a **Reset resolver history** button appears. The same badge and
reset button are available on the **global mocks** form for global endpoints.

On the `/ui/catalog` endpoint page, a resolver-backed scenario card shows its
**JavaScript source**, syntax-highlighted, in place of the JSON body a fixture
card shows — far more useful than a one-line "resolved at request time"
placeholder, especially with self-describing slugs.

A resolver-backed slug is one of the same scenario options offered per step in
a [scenario sequence](scenarios.md#scenario-sequences), just like any
fixture-backed slug or `real` — so a sequence can mix fixed steps with a step
that defers to a resolver (e.g. `pending → by-amount → default`).
