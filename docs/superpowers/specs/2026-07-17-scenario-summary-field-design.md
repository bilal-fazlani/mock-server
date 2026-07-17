# Scenario `summary` field — design

## Problem

Scenarios can already carry a friendly name via `description` — a TS resolver
exports `export const description = '…'`, a JSON fixture sets a top-level
`"description"`. There's no way to attach a longer, secondary line of context.

Add an optional `summary` that renders as a muted second line beneath the
friendly name in the catalog detail view. Supported in both scenario formats,
optional in each, mirroring `description` exactly.

## Scope

- **In:** parsing `summary` from TS resolvers and JSON fixtures; carrying it to
  the catalog detail view; rendering it under the friendly name.
- **Out:** JSON-fixture-only or resolver-only restrictions (both supported);
  showing summary in the scenario picker dropdown, catalog list view, or logs;
  any validation beyond "optional string".

## Data model

One new field: `EndpointDef.scenarioSummaries?: Record<string, string>` — a
parallel map (scenario slug → summary), populated from both formats and read in
a single place. Chosen over widening `scenarios` from `Record<string, string>`
to objects, because that map is consumed in ~10 places (logs, picker dropdown,
validation, routing); a parallel additive field leaves every consumer untouched.

A slug appears in `scenarioSummaries` only when its scenario declares a
non-empty summary.

## Data flow (mirrors `description` at each hop)

1. **JSON fixtures — `src/lib/catalog/load.ts`**
   The fixture branch currently calls `scenarioDescription(file)` to parse the
   fixture for its label. Refactor that into a single parse returning both
   `description` and `summary` (one file read, not two): set `scenarios[slug]`
   from description (unchanged behavior) and `scenarioSummaries[slug]` from a
   non-empty summary. Add `summary?: string` to the `Fixture` interface in
   `src/lib/mock-engine/fixtures.ts`.

2. **TS resolvers — `src/lib/mock-engine/resolver.ts`**
   `CompiledResolver` gains `summary?: string`. `compileResolver` extracts
   `export const summary` with the same `typeof === 'string'` guard used for
   `description`. Empty strings are filtered later, at the patch site.

3. **TS resolvers — `src/lib/runtime.ts`**
   In `compileResolvers`, a truthy `if (compiled.summary)` check writes
   `endpoint.scenarioSummaries[slug]` right next to the existing `description`
   patch — the same truthy pattern line 67 uses, which naturally drops empty
   strings. Same startup-compile timing as `description`, so identical behavior
   and the same dev-mode limitations.

4. **View — `src/app/ui/catalog/scenario-view.ts`**
   `ScenarioView` gains `summary?: string`. `buildScenarioViews` reads
   `endpoint.scenarioSummaries?.[key]` **uniformly** for both fixture- and
   resolver-backed scenarios — one lookup, no per-kind branching. The implicit
   `real` passthrough has no summary.

5. **Render — `src/app/ui/catalog/EndpointScenarios.tsx`**
   Restructure the accordion header's label span into a column: friendly name
   (+ status chip) on the first line, `summary` as a smaller muted line below,
   rendered only when present.

## Semantics

- `summary` is optional in both formats; absence renders nothing.
- Empty-string summary is treated as absent (guarded for non-empty), so a
  scenario declaring `summary = ''` shows no second line.
- Non-string values are ignored, matching `description`.

## Testing (TDD)

- `resolver.ts`: `summary` extracted when present; absent when not exported;
  non-string ignored; empty string treated as absent.
- `load.ts`: JSON fixture `summary` parsed into `scenarioSummaries`; single
  parse still yields the correct `description`.
- `runtime.ts` / `compileResolvers`: `scenarioSummaries` populated from a
  resolver's `summary` export.
- `scenario-view.ts`: `buildScenarioViews` carries summary into `ScenarioView`
  for both fixture- and resolver-backed scenarios.
