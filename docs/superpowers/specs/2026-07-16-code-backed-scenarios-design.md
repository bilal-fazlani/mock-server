# Code-backed scenarios — any scenario is `x.json` or `x.ts`

**Status:** design approved, pending implementation plan
**Date:** 2026-07-16
**Supersedes:** the earlier `_default.ts`-only design (see git history of this file).

## Problem

Some endpoints need to route to different outcomes based on **request content**
(e.g. a money-transfer endpoint routing by `amount` into `success` / `reject` /
`hold` / `failure`), while *also* letting specific callers be pinned to a fixed
outcome per profile.

Today these two needs don't compose:

- A **profiled `_dynamic.ts`** receives both `profileId` and the request body,
  so one resolver can branch on both axes — but it only runs when a profile's
  pick is explicitly `dynamic`. Request-driven routing is never the endpoint's
  *intrinsic* behavior: every profile must opt in, and per-caller special-casing
  degenerates into hardcoded `profileId` checks inside the `.ts`.
- Making the endpoint **global** loses profile-ID extraction entirely.

The desired model (**Model A**, agreed): request-driven routing is the
endpoint's **automatic baseline**, and specific profiles **override** it with a
flat pinned scenario — declarative per-profile config, no code.

An intermediate design (a special `_default.ts` file next to `_dynamic.ts`)
achieved Model A but created an asymmetry (`_dynamic.ts` may return `default`;
`_default.ts` may not) and a second special file to teach. Generalizing
dissolves both.

## The model

**Every scenario is backed by either a fixture (`x.json`) or a resolver
(`x.ts`).** The slug is the filename minus extension, same naming grammar as
today (`[a-z0-9][a-z0-9_-]*`). There are no special resolver files:
`_dynamic.ts` ceases to exist as a concept, and underscore-prefixed names
remain reserved for meta files only (`_endpoint.json`, `_schema.json`,
`_system.json`).

One uniform invariant replaces all previous special cases:

> **A resolver must return the slug of a fixture-backed scenario declared on
> the same endpoint, or `"real"`. It must never return a resolver-backed slug
> (including itself), an undeclared slug, or a non-string.**

Everything else follows:

- **Model A** is `default.ts`: since `default` is the zero-delta implicit
  scenario a no-pick profile lands on, backing it with code makes
  request-driven routing the automatic baseline, and profile pins on fixture
  scenarios are the overrides. No change to delta-save normalization —
  `default` stays the store-nothing zero point; only what serving it *does*
  changes.
- **Opt-in code routing** (old `_dynamic.ts`) is a resolver with any name —
  e.g. `by-amount.ts`, `poll-twice-then-succeed.ts` — pinned per profile or
  used as a sequence step. Slugs become self-describing in the UI and logs.
- **Multiple policies per endpoint** are now possible: different profiles can
  pin different resolver-backed scenarios, still with zero hardcoded
  `profileId` checks.
- The old asymmetry disappears: a resolver may return `default` exactly when
  `default` is fixture-backed — the general rule, not an exception.
- `dynamic` stops being a reserved slug. It becomes an ordinary legal scenario
  name. All its machinery dissolves: the conditional injection into pickers,
  `hasResolver`, the `Dynamic — unavailable (no _dynamic.ts)` dangling-pin
  special case (now ordinary undeclared-scenario drift), and the reserved-name
  validation.
- `real` remains the only reserved slug: neither `real.json` nor `real.ts` may
  exist.

## Validation rules

Startup / `npm run validate:catalog` fails if:

1. **Per slug, `x.json` XOR `x.ts`.** Both present for the same slug is an
   error.
2. **`default` is required** — as either `default.json` or `default.ts`.
3. **`real` is reserved** — no `real.json`, no `real.ts`.
4. **At least one fixture-backed scenario per endpoint.** An endpoint whose
   scenarios are all resolvers would leave resolvers nothing to return but
   `real`; rejected as a misconfiguration.
5. Existing checks unchanged: every `x.ts` must transpile and default-export a
   function (compile-at-boot, fail-fast); fixture shape, placeholders, schemas,
   selectors, path templates as today.

The resolver-return invariant is enforced at request time (`bad_return`), since
return values are runtime data. Note rules 2+4 interact: an endpoint with
`default.ts` needs at least one fixture scenario anyway, which is what the
resolver routes to.

## Resolver contract

Identical engine to today's `_dynamic.ts` — `node:vm` sandbox (no I/O), pure
synchronous default export, ~100 ms timeout, compiled at boot (recompiled per
request in dev), same `ResolverInput` (`request`, `history`, `profileId`;
`profileId` is `null` for global endpoints) — with these changes:

- **Return invariant** as above. Violations are a loud `500` with a
  `resolver_bad_return` trace code; nothing is appended to history. Throw →
  `resolver_threw`; timeout → `resolver_timeout`; dev-mode compile break →
  `resolver_compile_error`. (Trace codes renamed from `dynamic_*`; clean
  break, matching the no-migration stance. `dynamic_resolver_missing`
  disappears entirely — a pin whose `.ts` was removed is now ordinary
  `scenario_undeclared` drift.)
- **Optional `export const description = '…'`** alongside the default export,
  read at compile time — the resolver's UI label, mirroring the fixture
  `description` field. Fallback: the slug, same as fixtures.
- **Works for profiled and global endpoints**, and as a sequence step: a step
  naming a resolver-backed slug runs that resolver when the step is served.

## History

- **Keyed per slug:** `(ownerType, ownerKey, endpoint, slug)` — was
  `(ownerType, ownerKey, endpoint)`, unambiguous only while endpoints had at
  most one resolver. Each resolver-backed scenario now has its own window.
- Same semantics: capped to `DYNAMIC_HISTORY_LIMIT` (renamed
  `RESOLVER_HISTORY_LIMIT`, default 10), appends the *returned* slug after
  return-validation, `"real"` recorded like any slug, cleanup on profile
  deletion / global-selection clear.
- **Migration: none (decided).** Nobody is using this seriously yet. Old
  history rows lack the slug key component and are simply never matched again;
  a changelog note tells users to hand-rename `_dynamic.ts` → `dynamic.ts`
  (pins on the slug `dynamic` then keep working) and to expect resolver
  history to restart. Optionally drop the old rows in a one-line startup
  cleanup; either is acceptable.

## Decisions carried over from the superseded design

1. **`UNMOCKED_USERS=DEFAULT_MOCK` + `default.ts` — runs the resolver** (with
   the unmocked ID as `profileId`). There is no real alternative: no
   `default.json` exists to serve. Consequence: unmocked callers append
   history rows keyed to profile IDs with no profile document, so no cleanup
   ever fires and key cardinality is unbounded (caller-driven). Tracked in
   [#6](https://github.com/bilal-fazlani/mock-server/issues/6) (TTL or cleanup
   job); explicitly not solved here.
2. **`PASSTHROUGH_AS_DEFAULT=true` limitation accepted.** `default.ts`
   auto-fires only where `default` is the implicit scenario — i.e.
   `PASSTHROUGH_AS_DEFAULT=false`. Under `=true`, a no-pick profile proxies to
   the upstream; profiles must explicitly pin `default` to get the resolver.

## Request-log trace (resolves former open question 2)

`scenarioSource` keeps reporting the **selection mechanism** — `pin` /
`implicit` / `sequence` / `global` / `unmocked_policy` — and is no longer
overwritten when a resolver runs. The `'dynamic'` source value retires (clean
break). The rewrite is recorded as its own trace field, e.g.
`resolver: { slug: 'by-amount', returned: 'hold' }`, and log UIs render the
scenario as **`by-amount → hold`**. This is strictly more informative than
today, where the overwrite loses the original selection mechanism.

Example: transfer request with no profile pick → source `implicit`, scenario
`default → hold`.

## UI design (approved)

**A. Scenario cards** (profile picker, global-mocks form, sequence steps):
resolver-backed scenarios render as normal cards with the existing tone rules —
`default` green (a `default.ts` *is* still the baseline), other slugs amber,
`real` red — plus a **`</>` code badge** marking "resolved at request time by
code." Tone = role; badge = backing, orthogonally. (Rejected: a fourth tone
for code — it would hide that `default.ts` is still the store-nothing
baseline.)

**B. Labels:** resolver's `export const description`, else the slug — same
rule as fixtures.

**C. Reset history:** one **"Reset resolver history"** button per endpoint
(label renamed from "Reset dynamic history", consistent with the `resolver_*`
renames; per
profile / per global selection) clearing **all** slugs' windows for that
owner+endpoint, shown whenever the current selection — single pick or any
sequence step — involves a resolver-backed slug. (Rejected: per-slug reset
buttons; no test flow needs partial reset and they clutter the card row.)

**D. Catalog endpoint page:** a resolver-backed scenario card shows the
**TypeScript source, read-only**, where fixture cards show their JSON — far
more useful than the current "resolved at request time" one-liner, especially
with self-describing slugs. Both JSON and TS blocks gain **syntax
highlighting**, rendered server-side (e.g. shiki) at scenario-view build time
in `buildScenarioViews`, dual light/dark theme to match the app's
`ThemeToggle`. No client-side highlighter JS.

**E. Request-log pages:** show `picked → returned` per the trace design above;
source column keeps the selection mechanism.

**Runtime-control API (`/ui/api/*`):** mechanical mirror — catalog discovery
reports each scenario's backing (`fixture` | `resolver`) and label;
profile/global scenario writes keep validating against declared slugs
(unchanged logic — resolver-backed slugs are declared scenarios).

## Implementation sketch

Grounded in the current code.

- **`src/lib/catalog/load.ts`** — extend scenario discovery to `x.ts`
  (same slug grammar, `.ts` extension); drop the `DYNAMIC_FILE` special case
  and `hasResolver`. `EndpointDef.scenarios` stays `Record<slug, label>`; add
  a per-endpoint record of which slugs are resolver-backed (e.g.
  `resolverScenarios: string[]` or a per-slug backing map — implementation's
  choice). Resolver labels come from the compiled module's `description`
  export (falling back to slug), which couples label extraction to
  compilation — acceptable since both happen at boot.
- **`src/lib/catalog/types.ts`** — `EndpointDef`: remove `hasResolver`, add
  the backing record.
- **`src/lib/mock-engine/resolver.ts`** — `compileResolver` unchanged in
  substance; generalize error strings to name the actual file; expose the
  `description` export.
- **`src/lib/catalog/validate.ts`** — rules 1–4 above; delete the
  `dynamic.json`-reserved check; keep the `real`-reserved check extended to
  `.ts`.
- **`src/lib/runtime.ts`** — resolver map keyed `(system, endpoint, slug)`
  instead of `(system, endpoint)`; boot-time compile loop over all `.ts`
  scenarios; dev per-request recompile per slug.
- **`src/lib/router/route-request.ts`** — trigger the resolver when the
  *resolved* scenario slug is resolver-backed (replaces
  `scenario === DYNAMIC_SCENARIO`); bad-return guard = returned slug must be
  fixture-backed on this endpoint or `real`; history calls gain the slug;
  trace per the log design (source not overwritten; `resolver` field added).
- **`src/lib/scenarios.ts`** — remove `DYNAMIC_SCENARIO` /
  `DYNAMIC_LABEL` / injection logic in `scenariosWithPassthrough`;
  `isScenarioSelectable` collapses to `isScenarioDeclared` (a resolver-backed
  slug *is* declared); `danglingScenarioLabel` loses its dynamic special case.
- **Stores** — dynamic-history store keyed per slug; reset action clears all
  slugs for owner+endpoint (UI decision C).
- **UI** — `ScenarioPicker` (+ sequence `ScenarioSelect`): `</>` badge for
  resolver-backed slugs (pickers need the backing record passed down);
  `ScenarioConfig`: reset-button condition = selection involves any
  resolver-backed slug; catalog `scenario-view.ts`: replace `kind: 'dynamic'`
  with `kind: 'resolver'` carrying highlighted source HTML; `EndpointScenarios`
  renders it like fixture JSON; logs `LogRow` + detail: `picked → returned`.
- **`/ui/api/catalog`** — expose backing + labels.

## Out of scope

- Resolver-to-resolver chaining (forbidden by the return invariant).
- Solving orphaned history for unmocked callers —
  [#6](https://github.com/bilal-fazlani/mock-server/issues/6).
- Migration tooling / compat shims for `_dynamic.ts`, old history rows, the
  `'dynamic'` scenarioSource value, or the `DYNAMIC_HISTORY_LIMIT` env name
  (renamed) — clean break, changelog note only.
- Per-account *rules* as profile overrides beyond what pinning a named
  resolver-backed scenario already gives.

## Documentation impact (per AGENTS.md — ask before editing)

Guide-affecting across: `building/scenarios.md`, `building/dynamic.md`
(likely renamed/rewritten as code-backed scenarios), `building/fixtures.md`,
`building/endpoints.md`, `reference/configuration.md` (validation rules + env
var rename), `reference/request-lifecycle.md`, `driving/request-logs.md`
(trace change), `driving/api.md` (backing in catalog discovery), `index.md`.
Update only on consent; then run
`docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`.
