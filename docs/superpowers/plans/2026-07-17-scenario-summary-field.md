# Scenario `summary` Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `summary` to scenarios (TS resolvers via `export const summary`, JSON fixtures via a top-level `"summary"`), rendered as a muted second line beneath the friendly name in the catalog detail view.

**Architecture:** A new parallel map `EndpointDef.scenarioSummaries` (slug → summary) is fed from both formats — JSON at catalog-load, TS at resolver-compile — and read uniformly by `buildScenarioViews`. This leaves the widely-consumed `scenarios: Record<string, string>` map untouched.

**Tech Stack:** TypeScript, Next.js (app router), Vitest, esbuild (resolver transpile), Tailwind.

## Global Constraints

- Both `summary` sources are optional; absence renders nothing.
- Empty-string summary is treated as absent (truthy check at the patch site, matching the existing `if (compiled.description)` pattern in `runtime.ts`).
- Non-string values are ignored, matching `description` handling.
- Test runner: `npx vitest run <path>` for a file, `npx vitest run` for all.

---

### Task 1: Extract `summary` from TS resolvers

**Files:**
- Modify: `src/lib/mock-engine/resolver.ts` (`CompiledResolver` interface ~line 20-24; `compileResolver` extraction ~line 62-68)
- Test: `tests/mock-engine/resolver.test.ts`

**Interfaces:**
- Produces: `CompiledResolver.summary?: string` — set to the resolver's `export const summary` when it is a string; omitted otherwise.

- [ ] **Step 1: Write the failing tests**

Add to `tests/mock-engine/resolver.test.ts`, after the existing `describe('compileResolver description export', ...)` block:

```ts
describe('compileResolver summary export', () => {
  it('exposes export const summary', () => {
    const compiled = compileResolver(
      `export const summary = 'Flags amounts over 10'\nexport default () => 'success'`,
      'l',
    )
    expect(compiled.summary).toBe('Flags amounts over 10')
  })

  it('leaves summary undefined when absent or not a string', () => {
    expect(compileResolver(`export default () => 'x'`, 'l').summary).toBeUndefined()
    expect(
      compileResolver(`export const summary = 42\nexport default () => 'x'`, 'l').summary,
    ).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mock-engine/resolver.test.ts -t "summary export"`
Expected: FAIL — `compiled.summary` is `undefined` for the first case (property does not exist yet).

- [ ] **Step 3: Implement extraction**

In `src/lib/mock-engine/resolver.ts`, add `summary` to the `CompiledResolver` interface:

```ts
export interface CompiledResolver {
  /** Optional `export const description = '…'` from the resolver source — its UI label. */
  description?: string
  /** Optional `export const summary = '…'` — secondary line shown under the label. */
  summary?: string
  invoke(input: ResolverInput, timeoutMs: number): unknown
}
```

In `compileResolver`, right after the `description` extraction (the `const description = …` line), add:

```ts
  const rawSummary = (mod as Record<string, unknown> | undefined)?.summary
  const summary = typeof rawSummary === 'string' ? rawSummary : undefined
```

Then in the returned object, add the spread next to the existing description spread:

```ts
  return {
    ...(description !== undefined ? { description } : {}),
    ...(summary !== undefined ? { summary } : {}),
    invoke(input: ResolverInput, timeoutMs: number): unknown {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mock-engine/resolver.test.ts`
Expected: PASS (all resolver tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/resolver.ts tests/mock-engine/resolver.test.ts
git commit -m "feat: extract optional summary export from TS resolvers"
```

---

### Task 2: Parse `summary` from JSON fixtures into `scenarioSummaries`

**Files:**
- Modify: `src/lib/mock-engine/fixtures.ts` (`Fixture` interface, line 4-9)
- Modify: `src/lib/catalog/types.ts` (`EndpointDef` interface)
- Modify: `src/lib/catalog/load.ts` (fixture branch ~line 67-71; `scenarioDescription` ~line 199-215; endpoint push ~line 83-94)
- Test: `tests/catalog/load.test.ts`

**Interfaces:**
- Produces: `EndpointDef.scenarioSummaries?: Record<string, string>` — slug → summary, populated for scenarios (any format) declaring a non-empty summary; omitted key when none.
- Produces: `Fixture.summary?: string`.

- [ ] **Step 1: Write the failing test**

Add to `tests/catalog/load.test.ts`, inside `describe('loadCatalog', ...)`:

```ts
it('derives scenario summaries from JSON fixtures when present', () => {
  const dir = tmpCatalogDir({
    'sys/_system.json': SYSTEM_META,
    'sys/ep/_endpoint.json': ENDPOINT_META,
    'sys/ep/default.json': { status: 200, body: {} }, // no summary
    'sys/ep/failure.json': { description: 'It failed', summary: 'Upstream 500', status: 500, body: {} },
  })
  const ep = loadCatalog(dir).systems[0].endpoints[0]
  expect(ep.scenarioSummaries).toEqual({ failure: 'Upstream 500' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/catalog/load.test.ts -t "summaries from JSON"`
Expected: FAIL — `ep.scenarioSummaries` is `undefined`.

- [ ] **Step 3: Add the type fields**

In `src/lib/mock-engine/fixtures.ts`, add `summary` to `Fixture`:

```ts
export interface Fixture {
  description?: string
  summary?: string
  status: number
  headers?: Record<string, string>
  body: unknown
}
```

In `src/lib/catalog/types.ts`, add to `EndpointDef` right after the `scenarios` field:

```ts
  scenarios: Record<string, string>
  /**
   * Optional secondary line per scenario slug, shown under the friendly name.
   * Populated from a resolver's `summary` export or a fixture's `summary`
   * field; a slug is present only when it declares a non-empty summary.
   */
  scenarioSummaries?: Record<string, string>
```

- [ ] **Step 4: Parse both label and summary in one file read**

In `src/lib/catalog/load.ts`, replace the `scenarioDescription` function (currently ~line 199-215) with a single-parse helper returning both fields:

```ts
// Lenient by design: an unreadable fixture falls back to the filename for the
// label here and gets reported properly by validateCatalog.
function scenarioMeta(file: string): { description: string | null; summary: string | null } {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { description?: unknown; summary?: unknown }
      return {
        description: typeof obj.description === 'string' ? obj.description : null,
        summary: typeof obj.summary === 'string' && obj.summary.length > 0 ? obj.summary : null,
      }
    }
  } catch {
    // reported by validateCatalog
  }
  return { description: null, summary: null }
}
```

Add a `scenarioSummaries` accumulator alongside the existing `scenarios` object (near line 48, `const scenarios: Record<string, string> = {}`):

```ts
      const scenarios: Record<string, string> = {}
      const scenarioSummaries: Record<string, string> = {}
```

Replace the fixture branch (currently ~line 67-71):

```ts
        } else {
          fixtureSlugs.add(scenario)
          const meta = scenarioMeta(path.join(endpointDir, fixEntry.name))
          scenarios[scenario] = meta.description ?? scenario
          if (meta.summary) scenarioSummaries[scenario] = meta.summary
        }
```

In the `endpoints.push({ … })` call (~line 83-94), add the field after `resolverScenarios`, including it only when non-empty:

```ts
        resolverScenarios: [...resolverSlugs].sort(),
        ...(Object.keys(scenarioSummaries).length > 0 ? { scenarioSummaries } : {}),
        ...(schemaMeta ? { schema: schemaMeta } : {}),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/load.test.ts`
Expected: PASS (all load tests, including the new summary test and the unchanged description test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mock-engine/fixtures.ts src/lib/catalog/types.ts src/lib/catalog/load.ts tests/catalog/load.test.ts
git commit -m "feat: parse optional summary from JSON fixtures into scenarioSummaries"
```

---

### Task 3: Patch `scenarioSummaries` from resolvers at runtime

**Files:**
- Modify: `src/lib/runtime.ts` (`compileResolvers`, ~line 66-67)
- Test: `tests/lib/runtime.test.ts`

**Interfaces:**
- Consumes: `CompiledResolver.summary` (Task 1), `EndpointDef.scenarioSummaries` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/runtime.test.ts`, inside `describe('getRuntime', …)`, mirroring the existing "patches the label" test (~line 58-79). It uses the shared `SYSTEM_META`/`ENDPOINT_META`/`FIXTURE` constants and `process.chdir`:

```ts
it('patches scenarioSummaries from a resolver summary export', async () => {
  const dir = tmpProjectDir({
    'catalog/sys/_system.json': SYSTEM_META,
    'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
    'catalog/sys/ep/success.json': FIXTURE,
    'catalog/sys/ep/default.ts': `export const summary = 'Routes by amount'\nexport default () => 'success'`,
  })
  process.chdir(dir)
  process.env = { ...originalEnv }
  vi.resetModules()
  const { getRuntime } = await import('../../src/lib/runtime')

  const ep = getRuntime().catalog.systems[0].endpoints[0]
  expect(ep.scenarioSummaries).toEqual({ default: 'Routes by amount' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/runtime.test.ts -t "scenarioSummaries from a resolver"`
Expected: FAIL — `ep.scenarioSummaries` is `undefined`.

- [ ] **Step 3: Implement the patch**

In `src/lib/runtime.ts`, inside `compileResolvers`, right after the existing description patch:

```ts
          resolvers.set(resolverKey(system.slug, endpoint.name, slug), compiled)
          if (compiled.description) endpoint.scenarios[slug] = compiled.description
          if (compiled.summary) {
            ;(endpoint.scenarioSummaries ??= {})[slug] = compiled.summary
          }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runtime.ts tests/lib/runtime.test.ts
git commit -m "feat: patch scenarioSummaries from resolver summary export"
```

---

### Task 4: Carry `summary` into `ScenarioView`

**Files:**
- Modify: `src/app/ui/catalog/scenario-view.ts` (`ScenarioView` type ~line 8-17; both `return { … }` sites in `buildScenarioViews`)
- Test: `tests/ui/scenario-view.test.ts`

**Interfaces:**
- Consumes: `EndpointDef.scenarioSummaries` (Task 2).
- Produces: `ScenarioView.summary?: string`.

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/scenario-view.test.ts`, inside `describe('buildScenarioViews', ...)`:

```ts
it('carries scenarioSummaries onto the matching view', async () => {
  const withSummary: EndpointDef = {
    ...endpoint,
    scenarios: { default: 'Success' },
    scenarioSummaries: { default: 'Returns a 200 body' },
  }
  const views = await buildScenarioViews(system, withSummary, fixturesDir, {}, false)
  expect(views.find((v) => v.key === 'default')?.summary).toBe('Returns a 200 body')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/scenario-view.test.ts -t "carries scenarioSummaries"`
Expected: FAIL — `summary` is `undefined` (not yet on the view).

- [ ] **Step 3: Add `summary` to the type and populate it**

In `src/app/ui/catalog/scenario-view.ts`, add `summary?: string` to the shared prefix of the `ScenarioView` union:

```ts
export type ScenarioView = {
  key: string
  label: string
  summary?: string
  isDefault: boolean
} & (
```

In `buildScenarioViews`, compute the summary once inside the `.map` callback and spread it into every returned object. Change the `.map` header and each `return`:

```ts
    Object.entries(endpoint.scenarios).map(async ([key, label]) => {
      const isDefault = key === 'default'
      const summary = endpoint.scenarioSummaries?.[key]
```

Then add `...(summary ? { summary } : {}),` to each of the resolver, fixture, and error `return { … }` objects in this callback. For example the fixture return becomes:

```ts
        return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'fixture' as const, json, html: await highlight(bodyJson, 'json') }
```

Apply the same `...(summary ? { summary } : {}),` insertion to the `kind: 'resolver'` return and both `kind: 'error'` returns inside this callback. The `passthrough` view is left unchanged (no summary).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ui/scenario-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/catalog/scenario-view.ts tests/ui/scenario-view.test.ts
git commit -m "feat: carry scenario summary onto ScenarioView"
```

---

### Task 5: Render `summary` under the friendly name in the catalog detail view

**Files:**
- Modify: `src/app/ui/catalog/EndpointScenarios.tsx` (accordion header label span, ~line 82-91)

**Interfaces:**
- Consumes: `ScenarioView.summary` (Task 4).

This task is presentational; there is no unit test for markup. Verify by typecheck/lint and a browser preview.

- [ ] **Step 1: Restructure the header label into a column with the summary line**

In `src/app/ui/catalog/EndpointScenarios.tsx`, the label span currently is:

```tsx
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <span className="text-[0.95rem] font-semibold text-foreground">{scenario.label}</span>
                      {status && (
                        <span
                          className={`inline-flex min-h-6 items-center rounded-full border px-2 py-[3px] font-mono text-[0.72rem] font-bold leading-[1.2] ${statusToneClassName(status.tone)}`}
                        >
                          {status.label}
                        </span>
                      )}
                    </span>
```

Wrap the existing label+status row in a vertical column and add the summary line beneath it:

```tsx
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <span className="text-[0.95rem] font-semibold text-foreground">{scenario.label}</span>
                        {status && (
                          <span
                            className={`inline-flex min-h-6 items-center rounded-full border px-2 py-[3px] font-mono text-[0.72rem] font-bold leading-[1.2] ${statusToneClassName(status.tone)}`}
                          >
                            {status.label}
                          </span>
                        )}
                      </span>
                      {scenario.summary && (
                        <span className="text-[0.82rem] font-normal leading-[1.35] text-muted-foreground [overflow-wrap:anywhere]">
                          {scenario.summary}
                        </span>
                      )}
                    </span>
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/app/ui/catalog/EndpointScenarios.tsx`
Expected: no errors.

- [ ] **Step 3: Verify in the browser preview**

Add a `summary` to an example catalog scenario (a resolver's `export const summary = '…'` or a fixture's `"summary"`), start the dev server, open the endpoint's catalog detail page, and confirm the summary renders as a muted line beneath the friendly name. Revert the throwaway catalog edit afterward if it was only for verification.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (whole suite).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/catalog/EndpointScenarios.tsx
git commit -m "feat: render scenario summary under the friendly name"
```

---

## Self-Review

- **Spec coverage:** JSON parse → Task 2; resolver extraction → Task 1; runtime patch → Task 3; view carry → Task 4; render → Task 5. `scenarioSummaries` data model → Task 2. Empty/absent/non-string semantics → Tasks 1–2 guards + truthy patch checks. All spec sections covered.
- **Placeholder scan:** No TBD/TODO; every code step shows concrete code. The Task 3 note flags copying the neighboring test's exact config keys rather than inventing them — the code change itself is fully specified.
- **Type consistency:** `scenarioSummaries` (`Record<string, string>`, optional) used identically across `types.ts`, `load.ts`, `runtime.ts`, `scenario-view.ts`. `CompiledResolver.summary` and `Fixture.summary` and `ScenarioView.summary` all `?: string`.
