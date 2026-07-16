# `_default.ts` — a code-driven default scenario

**Status:** design agreed, pending implementation plan
**Date:** 2026-07-16

## Problem

Some endpoints need to route to different outcomes based on **request content**
(e.g. a money-transfer endpoint routing by `amount` into `success` / `reject` /
`hold` / `failure`), while *also* letting specific callers be pinned to a fixed
outcome per profile.

Today these two needs don't compose:

- A **profiled `_dynamic.ts`** receives both `profileId` and the request body, so
  one resolver can branch on both axes — but it only runs when a profile's pick
  for that endpoint is explicitly `dynamic`. So request-driven routing is not the
  endpoint's *intrinsic* behavior: every profile must individually opt into
  `dynamic`, and any per-caller special-casing then has to live as hardcoded
  `profileId` checks inside the `.ts`, defeating the point of profiles being
  UI/API-configurable by tests.
- Making the endpoint **global** (`mockType: "global"`) gives one shared resolver
  for everyone, but throws away profile-ID extraction entirely — losing all
  per-caller control.

The desired model (call it **Model A**): request-driven routing is the endpoint's
**automatic baseline** for every caller, and specific profiles **override** it
with a flat pinned scenario — configured declaratively per profile, not in code.

## Chosen approach: `_default.ts`

`default` is *already* the baseline. It is the zero-delta implicit scenario a
no-pick profile lands on (`resolveScenarioSelection` →
`implicitScenario(passthroughAsDefault)` = `default` when
`PASSTHROUGH_AS_DEFAULT=false`), and every explicit profile pick is already stored
as a *delta over* `default`. So if the `default` slug can be backed by **code**
instead of a fixture, Model A falls out with **no new machinery**:

- No-pick profile → resolves to `default` → runs `_default.ts` → request-driven
  routing. **Automatic baseline.**
- Profile pinned to `reject` → serves `reject.json`, resolver skipped. **Pure
  config override, no code.**
- **Zero change to delta-normalization** — `default` stays the implicit
  zero-point; only *what serving `default` does* changes.

`_default.ts` is to `default.json` exactly what `_dynamic.ts` is to a (forbidden)
`dynamic.json`: a slug is either a fixture or a resolver, never both.

### The `_default.ts` / `_dynamic.ts` duality

The two resolver files are **duals**, not redundant. They answer one question:
*is request-driven routing the endpoint's normal behavior, or an opt-in
alternate?*

| | baseline is… | code is… | can return `default`? |
| --- | --- | --- | --- |
| `_dynamic.ts` | **data** (`default.json`) | opt-in exception (pick `dynamic`) | yes — points back to the static default |
| `_default.ts` | **code** (`_default.ts`) | the baseline | **no** — it *is* the default (recursion; no fixture) |

Neither subsumes the other:

- `_dynamic.ts` keeps a static `default.json` and lets you route **some** callers
  (or **some** sequence steps) through code while unconfigured callers get a
  deterministic static default — without hardcoding `profileId`. `_default.ts`
  can't do selective opt-in: code is the baseline for everyone unconfigured.
- `_default.ts` gives the automatic baseline. `_dynamic.ts` can't, short of
  pinning every profile to `dynamic`.

Both are kept. `_default.ts` reuses the entire `_dynamic.ts` engine, so the cost
of coexistence is near zero; the real cost is teaching users which to reach for,
mitigated by the duality framing above.

## Rules

1. **`default.json` XOR `_default.ts`.** An endpoint must have exactly one
   backing for the `default` slug. Having both is a catalog validation error —
   the same principle that forbids `dynamic.json` / `real.json`. Every endpoint
   must still have one or the other (the existing "missing required default"
   rule, generalized).
2. **`_default.ts` and `_dynamic.ts` are mutually exclusive.** Not strictly
   forced by mechanics, but a cheap guardrail that eliminates real footguns:
   - **Resolver chaining / recursion.** With both present, `_dynamic.ts` could
     return `"default"` (now itself a resolver) or `_default.ts` could route
     toward `dynamic`, producing resolver-invokes-resolver. Forbidding
     coexistence is a one-line guard vs. a runtime "a resolver may not return a
     resolver-backed slug" rule.
   - **History-key collision.** Both resolvers share the per-endpoint dynamic
     history keyed `(owner, endpoint)`; two resolvers on one key is meaningless.
   - **Conceptual clarity** — one endpoint, one routing brain. No known use case
     needs both.

## Return contract for `_default.ts`

Identical to `_dynamic.ts` except for the forbidden self-slug:

- Same input (`ResolverInput`: `request`, `history`, `profileId`), same
  `node:vm` sandbox, same ~100 ms timeout, same per-endpoint history window
  (`DYNAMIC_HISTORY_LIMIT`).
- **Must return** a declared fixture scenario **other than `default`**
  (`success` / `reject` / `hold` / `failure` / …) or `"real"`.
- **Must not return `"default"`** — it *is* the resolver (infinite recursion) and
  there is no `default.json` to serve. This is the mirror of `_dynamic.ts` not
  being allowed to return `"dynamic"`. Also rejected: `"dynamic"`, any undeclared
  slug, any non-string.
- An invalid return is a loud `500` (`dynamic_bad_return`); nothing is appended
  to history. A throw is `dynamic_threw`; a timeout is `dynamic_timeout`.

## The `PASSTHROUGH_AS_DEFAULT` edge case

`_default.ts` auto-fires only where `default` is what a no-pick profile lands on
— i.e. `PASSTHROUGH_AS_DEFAULT=false` (the normal config).

- `PASSTHROUGH_AS_DEFAULT=false`: no-pick → implicit `default` → `_default.ts`
  runs. Automatic baseline works.
- `PASSTHROUGH_AS_DEFAULT=true`: no-pick → implicit `real` → the router proxies
  the live upstream; `_default.ts` never fires. To get request-driven routing a
  profile must **explicitly pin `default`** (which now means "run `_default.ts`").

This is an accepted limitation — `=true` is an unusual setting for a mock-heavy
endpoint, and the discarded `fallbackScenario`-field alternative (which would
have been immune) isn't worth the extra machinery.

## Implementation sketch

Grounded in the current code; only the named touchpoints change.

### Resolver module (`src/lib/mock-engine/resolver.ts`)
- Add `export const DEFAULT_FILE = '_default.ts'` alongside `DYNAMIC_FILE`.
- `compileResolver` is source-agnostic and unchanged (its error strings mention
  `_dynamic.ts`; generalize the wording to name the actual file).

### Catalog load (`src/lib/catalog/load.ts`)
- Recognize `_default.ts` like `_dynamic.ts`: when present, set a new
  `hasDefaultResolver: true` on the `EndpointDef` and do **not** treat it as a
  `<name>.json` scenario.
- **Representation choice:** keep `default` in the `scenarios` map even when it is
  resolver-backed (so all existing "default is declared / selectable / the
  implicit zero-point" logic holds unchanged), with a synthetic label (e.g. the
  slug `default`, or "Default"). Fixture existence/loading of `default` is gated
  on `!hasDefaultResolver` (see validate + router below).

### Types (`src/lib/catalog/types.ts`)
- Add `hasDefaultResolver?: boolean` to `EndpointDef` (parallel to `hasResolver`).

### Validation (`src/lib/catalog/validate.ts`)
- Replace the "missing required `default`" check with: an endpoint must have
  `default.json` **or** `_default.ts`, and **not both** (Rule 1).
- Add: `_default.ts` and `_dynamic.ts` must not both be present (Rule 2).
- In the per-scenario fixture-existence loop, skip `default` when
  `hasDefaultResolver` (as `real` / `dynamic` are already skipped), since there
  is no `default.json`.

### Resolver compilation (`src/lib/runtime.ts`)
- `compileResolvers` / the dev per-request recompile must compile whichever
  resolver file the endpoint has (`_dynamic.ts` **or** `_default.ts`) into the
  same one-per-endpoint resolvers map (keyed by `schemaKey`). Rules 1–2 guarantee
  at most one resolver file per endpoint, so no key contention.

### Router (`src/lib/router/route-request.ts`)
- Introduce the endpoint's **resolver slug**: `dynamic` when `hasResolver`,
  `default` when `hasDefaultResolver` (at most one).
- Trigger `resolveDynamic` when the resolved scenario **equals the resolver
  slug** — i.e. today's `scenario === DYNAMIC_SCENARIO`, plus
  `scenario === DEFAULT_SCENARIO && endpoint.hasDefaultResolver`.
- In `resolveDynamic`'s bad-return guard, reject `returned === <resolver slug>`
  (generalize the existing `returned === DYNAMIC_SCENARIO`), so a `_default.ts`
  that returns `"default"` is `dynamic_bad_return`. `dynamic_resolver_missing`
  and the history keying (`ownerType`/`ownerKey`) are unchanged.
- `trace.scenarioSource` stays `'dynamic'` for a resolver-decided call (it means
  "a resolver ran"); `trace.dynamic.returned` already records the slug. *(Minor
  open choice: add a distinct `'default'` source for log clarity — recommend
  reuse `'dynamic'` to keep surface small.)*

### Scenarios helper (`src/lib/scenarios.ts`)
- `scenariosWithPassthrough` already injects `dynamic` when `hasResolver`. When
  `hasDefaultResolver`, `default` is already in the map (see representation
  choice), so pickers keep offering it as the baseline — its label/semantics just
  reflect "resolved by `_default.ts`". `isScenarioSelectable` needs no change if
  `default` stays in `scenarios`.

### UI
- **Profile scenario picker / global-mocks form:** the `default` entry, when
  `hasDefaultResolver`, is presented as code-driven (label indicating
  `_default.ts`), remains the store-nothing baseline, and shows a **Reset dynamic
  history** button (mirroring the `Dynamic` selection). Named fixtures appear as
  overrides. No separate `Dynamic` entry (Rule 2).
- **`/ui/catalog` endpoint page:** the `default` card describes itself as
  resolved at request time by `_default.ts` (like the `Dynamic` card), instead of
  showing fixture JSON.
- A `default` step inside a scenario **sequence** runs the resolver when
  `hasDefaultResolver`, consistent with `dynamic` as a sequence step.

### History / reset
- Reuse the existing dynamic-history collection and keying. **Reset dynamic
  history** applies to the `default` selection when `hasDefaultResolver`. Cleanup
  on profile deletion / global-selection clear is unchanged.

## Out of scope (YAGNI)

- The `fallbackScenario` per-endpoint field (superseded by `_default.ts`).
- A general "any `<slug>.ts` may back any scenario" mechanism.
- Per-account *rules* as overrides (overrides are flat pinned scenarios only).
- Changing `UNMOCKED_USERS=DEFAULT_MOCK` semantics — it continues to mean the
  literal `default` outcome. *(Open question below.)*

## Decisions on former open questions

1. **`UNMOCKED_USERS=DEFAULT_MOCK` + `_default.ts` — DECIDED: run the resolver.**
   When a profile ID resolves but the profile doesn't exist and policy is
   `DEFAULT_MOCK`, the router sets `scenario = DEFAULT_SCENARIO`; on a
   resolver-backed endpoint that runs `_default.ts` (with the unmocked ID as
   `profileId`). Note there is no real alternative: a `_default.ts` endpoint has
   no `default.json`, so "serve a literal static default" has nothing to serve.
   **Consequence:** unmocked callers append dynamic-history rows keyed to
   profile IDs that have no profile document, so no cleanup path ever fires and
   key cardinality is unbounded (driven by caller input). Tracked separately —
   TTL or cleanup job — in
   [#6](https://github.com/bilal-fazlani/mock-server/issues/6); not solved in
   this design.
2. **`scenarioSource` value** — still open: reuse `'dynamic'` vs. add
   `'default'` (see router note). Recommendation: reuse `'dynamic'`.

## Documentation impact (per AGENTS.md — ask before editing)

The guide under `docs/site/docs/` describes scenarios, the resolver, endpoint
directory shape, validation, and the request lifecycle, so this change is
guide-affecting. Pages to update **on consent**:

- `building/scenarios.md` — `default` may be resolver-backed; the duality.
- `building/dynamic.md` — the `_default.ts` variant and shared engine (or a new
  `building/default-resolver.md`).
- `building/endpoints.md` — endpoint directory shape (`default.json` XOR
  `_default.ts`).
- `reference/configuration.md` — the two new validation rules.
- `reference/request-lifecycle.md` — the routing-walk trigger on `default`.
- `index.md` — catalog-tree overview.

After editing, run
`docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`.
