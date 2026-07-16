# Code-Backed Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any scenario can be backed by a fixture (`x.json`) or a resolver (`x.ts`); the special `_dynamic.ts` file and reserved `dynamic` slug are removed.

**Architecture:** The loader discovers `<slug>.ts` scenario files alongside `<slug>.json` and records which slugs are resolver-backed on `EndpointDef.resolverScenarios`. The runtime compiles every resolver at boot into a per-`(system, endpoint, slug)` map. The router runs a resolver whenever the *resolved* scenario slug is resolver-backed, substituting its return value (a fixture-backed slug or `real`). History is keyed per-slug. UI marks resolver-backed scenarios with a `</>` badge and shows resolver source (syntax-highlighted) in the catalog.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, MongoDB, esbuild + node:vm (resolver engine, unchanged), vitest, shiki (new dep, Task 8 only).

**Spec:** `docs/superpowers/specs/2026-07-16-code-backed-scenarios-design.md` — read it before starting any task.

## Global Constraints

- **Clean break, no migration:** no compat shims for `_dynamic.ts`, the `dynamic` reserved slug, `DYNAMIC_HISTORY_LIMIT`, the `'dynamic'` scenarioSource value, or old history rows.
- **Renames (exact):** env `DYNAMIC_HISTORY_LIMIT` → `RESOLVER_HISTORY_LIMIT` (default `10`); trace codes `dynamic_compile_error|dynamic_resolver_missing|dynamic_threw|dynamic_timeout|dynamic_bad_return` → `resolver_compile_error|resolver_missing|resolver_threw|resolver_timeout|resolver_bad_return`; UI button label `Reset dynamic history` → `Reset resolver history`.
- **Reserved slug:** only `real` (neither `real.json` nor `real.ts` may exist). `default` is required as `default.json` XOR `default.ts`. `dynamic` becomes an ordinary slug.
- **Resolver return invariant (runtime-enforced):** a resolver must return a *fixture-backed* declared slug or `"real"`; returning a resolver-backed slug (incl. itself), an undeclared slug, or a non-string is `resolver_bad_return` (500, nothing appended to history).
- **Conventional Commits** (repo releases via release-please): use the exact commit messages given per task. Task 4's commit carries the `!`/BREAKING CHANGE marker.
- Run `npx tsc --noEmit` and `npm test` before every commit; both must be clean.
- Node >= 22; tests run with `npm test` (vitest) or `npx vitest run <file>` for one file.

---

### Task 1: Rename `DYNAMIC_HISTORY_LIMIT` → `RESOLVER_HISTORY_LIMIT`

**Files:**
- Modify: `src/lib/config.ts:47-54`
- Modify: `src/lib/runtime.ts` (field `dynamicHistoryLimit` → `resolverHistoryLimit`, parse call)
- Modify: `src/lib/environment.ts:79-84` (env var entry)
- Modify: `src/app/[...path]/route.ts:34` (`rt.dynamicHistoryLimit` → `rt.resolverHistoryLimit`)
- Test: `tests/lib/config.test.ts`, `tests/lib/environment.test.ts`, `tests/lib/runtime.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `parseResolverHistoryLimit(raw: string | undefined): number` in `src/lib/config.ts`; `Runtime.resolverHistoryLimit: number`.

- [ ] **Step 1: Update the config test to the new name (failing)**

In `tests/lib/config.test.ts`, rename the import and describe block: `parseDynamicHistoryLimit` → `parseResolverHistoryLimit`, and every env-name string in expected error messages: `DYNAMIC_HISTORY_LIMIT` → `RESOLVER_HISTORY_LIMIT`. Keep all cases (default 10, valid integer, rejects zero/negative/non-integer) otherwise unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lib/config.test.ts`
Expected: FAIL — `parseResolverHistoryLimit` is not exported.

- [ ] **Step 3: Rename in `src/lib/config.ts`**

```ts
export function parseResolverHistoryLimit(raw: string | undefined): number {
  if (raw === undefined) return 10
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ConfigError(`RESOLVER_HISTORY_LIMIT must be a positive integer, got "${raw}"`)
  }
  return n
}
```

(Replaces `parseDynamicHistoryLimit` — no alias left behind.)

- [ ] **Step 4: Update `src/lib/runtime.ts`**

- Import `parseResolverHistoryLimit` instead of `parseDynamicHistoryLimit`.
- `Runtime` interface: `dynamicHistoryLimit: number` → `resolverHistoryLimit: number`.
- In `getRuntime()`: `const resolverHistoryLimit = parseResolverHistoryLimit(process.env.RESOLVER_HISTORY_LIMIT)` and set `resolverHistoryLimit` in the runtime object literal.

- [ ] **Step 5: Update `src/lib/environment.ts` entry (around line 80)**

```ts
  {
    name: 'RESOLVER_HISTORY_LIMIT',
    category: 'Routing',
    description: 'Number of past returned slugs passed to scenario resolvers (<slug>.ts) as history.',
    defaultValue: '10',
    display: true,
  },
```

- [ ] **Step 6: Update `src/app/[...path]/route.ts:34`** — `rt.dynamicHistoryLimit` → `rt.resolverHistoryLimit`.

- [ ] **Step 7: Fix remaining references**

Run: `grep -rn "dynamicHistoryLimit\|DYNAMIC_HISTORY_LIMIT\|parseDynamicHistoryLimit" src tests`
Update every hit (expect `tests/lib/environment.test.ts` and `tests/lib/runtime.test.ts` to assert the env name/field — update them to the new names).

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: rename DYNAMIC_HISTORY_LIMIT env var to RESOLVER_HISTORY_LIMIT"
```

---

### Task 2: History store keyed per scenario slug

**Files:**
- Modify: `src/lib/dynamic/history-store.ts`
- Modify: `src/lib/router/route-request.ts:77-87` (RouterDeps signatures) and the two call sites in `resolveDynamic` (lines ~340, ~389)
- Modify: `src/app/[...path]/route.ts:31-34`
- Test: `tests/dynamic/history-store.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Tasks 4):
  - `getDynamicHistory(db, ownerType, ownerKey, endpointName, scenario): Promise<string[]>`
  - `appendDynamicHistory(db, ownerType, ownerKey, endpointName, scenario, slug, limit): Promise<void>` — `scenario` is the resolver-backed slug being run; `slug` is the returned value being recorded.
  - `resetDynamicHistory(db, ownerType, ownerKey, endpointName?)` — **unchanged** signature; per spec UI decision C it clears **all** scenarios' windows for the owner(+endpoint).
  - `RouterDeps.getDynamicHistory/appendDynamicHistory` gain the `scenario: string` parameter (before `slug`).

- [ ] **Step 1: Extend the history-store test (failing)**

In `tests/dynamic/history-store.test.ts`, update every `getDynamicHistory`/`appendDynamicHistory` call to pass a scenario slug (use `'dynamic'` where the test previously implied the single resolver), and add one new test:

```ts
it('keeps separate windows per scenario slug on the same endpoint', async () => {
  await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount', 'hold', 10)
  await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'default', 'success', 10)
  expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount')).toEqual(['hold'])
  expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'default')).toEqual(['success'])
})

it('resetDynamicHistory clears every scenario window for the endpoint', async () => {
  await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount', 'hold', 10)
  await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'default', 'success', 10)
  await resetDynamicHistory(db, 'profile', 'p1', 'ep')
  expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount')).toEqual([])
  expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'default')).toEqual([])
})
```

(Match the existing test file's db setup/teardown conventions.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/dynamic/history-store.test.ts`
Expected: FAIL (wrong arity / windows collide).

- [ ] **Step 3: Implement per-slug keying**

Replace the body of `src/lib/dynamic/history-store.ts`:

```ts
import { Db } from 'mongodb'

export type DynamicOwnerType = 'profile' | 'global'

interface DynamicHistoryDoc {
  ownerType: DynamicOwnerType
  ownerKey: string
  endpointName: string
  /** The resolver-backed scenario slug this window belongs to. */
  scenario: string
  history: string[]
  createdAt: Date
  modifiedAt: Date
}

const COLLECTION = 'dynamicHistory'

export async function getDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName: string,
  scenario: string,
): Promise<string[]> {
  const doc = await db
    .collection<DynamicHistoryDoc>(COLLECTION)
    .findOne({ ownerType, ownerKey, endpointName, scenario }, { projection: { _id: 0, history: 1 } })
  return doc?.history ?? []
}

export async function appendDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName: string,
  scenario: string,
  slug: string,
  limit: number,
): Promise<void> {
  const now = new Date()
  await db.collection<DynamicHistoryDoc>(COLLECTION).updateOne(
    { ownerType, ownerKey, endpointName, scenario },
    {
      $push: { history: { $each: [slug], $slice: -Math.max(1, limit) } },
      $set: { modifiedAt: now },
      $setOnInsert: { ownerType, ownerKey, endpointName, scenario, createdAt: now },
    },
    { upsert: true },
  )
}

// Reset clears every scenario's window for the owner (+endpoint): the UI
// exposes one reset button per endpoint, and pre-rename rows (no `scenario`
// field) simply never match get/append again — clean break, no migration.
export async function resetDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName?: string,
): Promise<void> {
  await db
    .collection<DynamicHistoryDoc>(COLLECTION)
    .deleteMany(
      endpointName === undefined
        ? { ownerType, ownerKey }
        : { ownerType, ownerKey, endpointName },
    )
}
```

- [ ] **Step 4: Thread the parameter through RouterDeps**

In `src/lib/router/route-request.ts`, change the deps signatures:

```ts
  getDynamicHistory: (
    ownerType: DynamicOwnerType,
    ownerKey: string,
    endpointName: string,
    scenario: string,
  ) => Promise<string[]>
  appendDynamicHistory: (
    ownerType: DynamicOwnerType,
    ownerKey: string,
    endpointName: string,
    scenario: string,
    slug: string,
  ) => Promise<void>
```

In `resolveDynamic`, pass `DYNAMIC_SCENARIO` as the `scenario` argument at both call sites (temporary — Task 4 replaces this with the actual resolver slug):

```ts
const history = await deps.getDynamicHistory(ownerType, ownerKey, endpoint.name, DYNAMIC_SCENARIO)
// ...
await deps.appendDynamicHistory(ownerType, ownerKey, endpoint.name, DYNAMIC_SCENARIO, returned)
```

- [ ] **Step 5: Update the wiring in `src/app/[...path]/route.ts`**

```ts
    getDynamicHistory: async (ownerType, ownerKey, endpointName, scenario) =>
      getDynamicHistory(await getDb(), ownerType, ownerKey, endpointName, scenario),
    appendDynamicHistory: async (ownerType, ownerKey, endpointName, scenario, slug) =>
      appendDynamicHistory(await getDb(), ownerType, ownerKey, endpointName, scenario, slug, rt.resolverHistoryLimit),
```

- [ ] **Step 6: Fix compile fallout in tests**

Run: `npx tsc --noEmit` — fix any test doubles implementing the old signatures (`tests/router/dynamic.e2e.test.ts` `makeHistoryStore` gains the `scenario` key segment: `${ownerType}|${ownerKey}|${endpointName}|${scenario}`; `tests/router/route-request.test.ts` fakes likewise).

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: key resolver history per scenario slug"
```

---

### Task 3: Resolver module — `description` export, generalized wording, per-slug file path

**Files:**
- Modify: `src/lib/mock-engine/resolver.ts`
- Test: create `tests/mock-engine/resolver.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 4):
  - `CompiledResolver` gains `description?: string` (from an optional `export const description = '…'` in the resolver source).
  - `resolverFilePath(catalogDir: string, systemSlug: string, endpointName: string, slug: string): string` → `<catalogDir>/<system>/<endpoint>/<slug>.ts`.
  - `DYNAMIC_FILE` and `dynamicFilePath` remain exported **until Task 4 deletes them** (runtime/loader still reference them).
  - Error message wording says "resolver" (the `label` argument identifies the file).

- [ ] **Step 1: Write failing tests**

Create `tests/mock-engine/resolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compileResolver, resolverFilePath } from '../../src/lib/mock-engine/resolver'

describe('resolverFilePath', () => {
  it('points at <catalogDir>/<system>/<endpoint>/<slug>.ts', () => {
    expect(resolverFilePath('/cat', 'sys', 'ep', 'by-amount')).toBe('/cat/sys/ep/by-amount.ts')
  })
})

describe('compileResolver description export', () => {
  it('exposes export const description', () => {
    const compiled = compileResolver(
      `export const description = 'Routes by amount'\nexport default () => 'success'`,
      'sys/ep/by-amount.ts',
    )
    expect(compiled.description).toBe('Routes by amount')
  })

  it('leaves description undefined when absent or not a string', () => {
    expect(compileResolver(`export default () => 'x'`, 'l').description).toBeUndefined()
    expect(
      compileResolver(`export const description = 42\nexport default () => 'x'`, 'l').description,
    ).toBeUndefined()
  })

  it('names the resolver generically in compile errors', () => {
    expect(() => compileResolver('const nope =', 'sys/ep/broken.ts')).toThrowError(
      /sys\/ep\/broken\.ts: failed to transpile resolver/,
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/mock-engine/resolver.test.ts`
Expected: FAIL (`resolverFilePath` not exported; `description` undefined behavior; old `_dynamic.ts` wording).

- [ ] **Step 3: Implement**

In `src/lib/mock-engine/resolver.ts`:

- Add below `dynamicFilePath`:

```ts
export function resolverFilePath(
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
  slug: string,
): string {
  return path.join(catalogDir, systemSlug, endpointName, `${slug}.ts`)
}
```

- `CompiledResolver` interface:

```ts
export interface CompiledResolver {
  /** Optional `export const description = '…'` from the resolver source — its UI label. */
  description?: string
  invoke(input: ResolverInput, timeoutMs: number): unknown
}
```

- In `compileResolver`, after resolving `fn`, read the description and include it in the returned object:

```ts
  const rawDescription = (mod as Record<string, unknown> | undefined)?.description
  const description = typeof rawDescription === 'string' ? rawDescription : undefined
  sandbox.__resolver = fn
  const invokeScript = new vm.Script('__resolver(__input)', { filename: `${label}#invoke` })

  return {
    ...(description !== undefined ? { description } : {}),
    invoke(input: ResolverInput, timeoutMs: number): unknown {
      // ... unchanged body ...
    },
  }
```

- Reword the four error messages (keep `label` prefix):
  - `failed to transpile _dynamic.ts:` → `failed to transpile resolver:`
  - `failed to evaluate _dynamic.ts:` → `failed to evaluate resolver:`
  - `_dynamic.ts must default-export a function` → `resolver must default-export a function`
  - `_dynamic.ts exceeded ${timeoutMs}ms` → `resolver exceeded ${timeoutMs}ms`
  - `_dynamic.ts threw:` → `resolver threw:`

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — if any existing test asserts on the old `_dynamic.ts` error wording (check `tests/router/dynamic.e2e.test.ts`, `tests/lib/runtime.test.ts`), update those assertions to the new wording in this task.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: resolver description export and slug-addressed resolver files"
```

---

### Task 4: Core generalization — loader, runtime, router, scenarios (BREAKING)

This is the semantic flip. Everything compiles and all tests pass at the end of the task; intermediate steps won't.

**Files:**
- Modify: `src/lib/catalog/types.ts`, `src/lib/catalog/load.ts`, `src/lib/catalog/validate.ts` (fixture-loop skip + reserved-slug changes only), `src/lib/runtime.ts`, `src/lib/scenarios.ts`, `src/lib/router/route-request.ts`, `src/lib/logs/store.ts`, `src/lib/profiles/stale.ts`, `src/lib/profiles/form.ts`, `src/lib/profiles/api-scenarios.ts`, `src/lib/mock-engine/resolver.ts` (delete `DYNAMIC_FILE`/`dynamicFilePath`)
- Modify (compile-fix minimum): `src/app/ui/catalog/scenario-view.ts`, `src/app/ui/catalog/EndpointScenarios.tsx` (one branch), `src/app/ui/global-mocks/GlobalMocksForm.tsx` (condition only), `src/app/ui/global-mocks/actions.ts`, `src/app/ui/api/global-mocks/[system]/[endpoint]/route.ts`, `src/app/ui/api/catalog/route.ts`, `src/app/ui/logs/LogRow.tsx` (delete the `dynamic` source entry)
- Rename: `catalog/hello-system/account_balance/_dynamic.ts` → `catalog/hello-system/account_balance/dynamic.ts`; same rename inside `tests/testdata/fixtures/test-system/dynamic_ep/` if present
- Test: `tests/catalog/load.test.ts`, `tests/lib/scenarios.test.ts`, `tests/router/route-request.test.ts`, `tests/router/dynamic.e2e.test.ts`, `tests/lib/runtime.test.ts`, `tests/profiles/stale.test.ts`, `tests/profiles/form.test.ts`, `tests/profiles/api-scenarios.test.ts`, `tests/global-mocks/actions.test.ts`, `tests/api/catalog-route.test.ts`, `tests/api/global-mocks-route.test.ts`, `tests/ui/scenario-view.test.ts`

**Interfaces:**
- Consumes: `resolverFilePath`, `CompiledResolver.description` (Task 3); per-slug history deps (Task 2).
- Produces (relied on by Tasks 5–8):
  - `EndpointDef.resolverScenarios: string[]` (required, `[]` when none; every entry is also a key of `scenarios`). `EndpointDef.hasResolver` is **gone**.
  - `Runtime.getCompiledResolver(systemSlug, endpointName, slug): CompiledResolver | null`
  - `scenarios.ts` exports only: `DEFAULT_SCENARIO`, `REAL_SCENARIO`, `implicitScenario`, `scenariosWithPassthrough`, `isScenarioDeclared`, `danglingScenarioLabel`, `scenarioOptionsWithDangling`. (`DYNAMIC_SCENARIO`, `DYNAMIC_LABEL`, `isScenarioSelectable` are gone.)
  - `LogTraceData.resolver?: { slug: string; returned: string }`; `ScenarioSource` no longer includes `'dynamic'`; `LogTraceData.dynamic` is gone.
  - Trace codes: `resolver_missing`, `resolver_compile_error`, `resolver_threw`, `resolver_timeout`, `resolver_bad_return`.
  - `/ui/api/catalog` endpoint objects: `hasResolver` replaced by `resolverScenarios: string[]`.

- [ ] **Step 1: Write the key failing tests first**

Add to `tests/catalog/load.test.ts` (follow the file's existing tmp-catalog helper conventions):

```ts
it('discovers <slug>.ts scenario files as resolver-backed scenarios', () => {
  // catalog with: default.json, hold.json, by-amount.ts
  const catalog = loadCatalog(dir)
  const ep = catalog.systems[0].endpoints[0]
  expect(Object.keys(ep.scenarios)).toContain('by-amount')
  expect(ep.scenarios['by-amount']).toBe('by-amount') // label = slug until runtime patches
  expect(ep.resolverScenarios).toEqual(['by-amount'])
})

it('rejects a slug backed by both x.json and x.ts', () => {
  // catalog with hold.json AND hold.ts
  expect(() => loadCatalog(dir)).toThrowError(/backed by both hold\.json and hold\.ts/)
})

it('allows default.ts in place of default.json', () => {
  // catalog with: default.ts, success.json
  const ep = loadCatalog(dir).systems[0].endpoints[0]
  expect(ep.resolverScenarios).toEqual(['default'])
  expect(Object.keys(ep.scenarios)).toEqual(['default', 'success'])
})
```

Add to `tests/router/route-request.test.ts` (using the file's existing deps-faking pattern):

```ts
it('runs a resolver-backed default for a profile with no pick, recording trace.resolver', async () => {
  // endpoint: scenarios {default, hold, success}, resolverScenarios ['default']
  // getCompiledResolver returns { invoke: () => 'hold' }
  // profile exists with no endpointScenarios entry
  const result = await routeRequest(req, deps)
  expect(result.status).toBe(200) // hold.json fixture
  expect(trace.scenarioSource).toBe('implicit') // NOT overwritten
  expect(trace.resolver).toEqual({ slug: 'default', returned: 'hold' })
  expect(trace.scenario).toBe('hold')
})

it('rejects a resolver returning a resolver-backed slug with resolver_bad_return', async () => {
  // resolverScenarios ['default', 'flaky']; resolver for default returns 'flaky'
  const result = await routeRequest(req, deps)
  expect(result.status).toBe(500)
  expect(trace.error?.code).toBe('resolver_bad_return')
})

it('runs default.ts for an unmocked caller under DEFAULT_MOCK', async () => {
  // getProfile → null, unmockedUsers 'DEFAULT_MOCK', resolverScenarios ['default']
  const result = await routeRequest(req, deps)
  expect(trace.scenarioSource).toBe('unmocked_policy')
  expect(trace.resolver?.slug).toBe('default')
})
```

Update `tests/lib/scenarios.test.ts`: delete tests for `DYNAMIC_SCENARIO` injection/`isScenarioSelectable`; add:

```ts
it('scenariosWithPassthrough no longer injects any synthetic entries beyond real', () => {
  const ep = { name: 'e', displayName: 'E', method: 'GET', path: '/e',
    scenarios: { default: 'default', 'by-amount': 'Routes by amount' },
    resolverScenarios: ['by-amount'] } as EndpointDef
  expect(Object.keys(scenariosWithPassthrough(ep, false))).toEqual(['default', 'by-amount', 'real'])
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/catalog/load.test.ts tests/router/route-request.test.ts tests/lib/scenarios.test.ts`
Expected: FAIL (compile errors on `resolverScenarios`, missing behavior).

- [ ] **Step 3: `src/lib/catalog/types.ts`**

```ts
export interface EndpointDef {
  name: string
  displayName: string
  method: string
  path: string
  mockType?: 'global' | 'profiled'
  profileIdSelector?: string
  captureProfileKeys?: ProfileKeyCaptureDef[]
  scenarios: Record<string, string>
  /**
   * Slugs in `scenarios` backed by a `<slug>.ts` resolver instead of a
   * `<slug>.json` fixture. Always present; empty when the endpoint has none.
   */
  resolverScenarios: string[]
  /** Raw parsed _schema.json (OpenAPI 3.1 operation object), if present. */
  schema?: Record<string, unknown>
}
```

(`hasResolver` deleted.)

- [ ] **Step 4: `src/lib/catalog/load.ts`**

- Change the scenario regex and drop the `_dynamic.ts` branch:

```ts
const SCENARIO_FILE = /^([a-z0-9][a-z0-9_-]*)\.(json|ts)$/
```

- Remove `import { DYNAMIC_FILE } from '../mock-engine/resolver'` and the `if (fixEntry.name === DYNAMIC_FILE)` block.
- Replace the per-endpoint scenario loop body:

```ts
      const scenarios: Record<string, string> = {}
      const fixtureSlugs = new Set<string>()
      const resolverSlugs = new Set<string>()
      for (const fixEntry of sortedEntries(endpointDir)) {
        if (fixEntry.name === ENDPOINT_META || fixEntry.name === SCHEMA_META) continue
        const match = fixEntry.isFile() ? SCENARIO_FILE.exec(fixEntry.name) : null
        if (!match) {
          problems.push(
            `${slug}/${endpointName}: unexpected entry (scenarios are <name>.json fixtures or ` +
              `<name>.ts resolvers, name matching [a-z0-9][a-z0-9_-]*): ${fixEntry.name}`,
          )
          continue
        }
        const [, scenario, ext] = match
        if (ext === 'ts') {
          resolverSlugs.add(scenario)
          // Label = slug for now; getRuntime patches in the compiled resolver's
          // `description` export after compilation.
          scenarios[scenario] ??= scenario
        } else {
          fixtureSlugs.add(scenario)
          scenarios[scenario] =
            scenarioDescription(path.join(endpointDir, fixEntry.name)) ?? scenario
        }
      }
      for (const scenario of resolverSlugs) {
        if (fixtureSlugs.has(scenario)) {
          problems.push(
            `${slug}/${endpointName}: scenario "${scenario}" is backed by both ` +
              `${scenario}.json and ${scenario}.ts — pick one`,
          )
        }
      }
```

- In `endpoints.push({...})`: replace `...(hasResolver ? { hasResolver: true } : {})` with `resolverScenarios: [...resolverSlugs].sort()`.

- [ ] **Step 5: `src/lib/catalog/validate.ts` (minimal — full rules are Task 5)**

- Delete the `DYNAMIC_SCENARIO in endpoint.scenarios` reserved check (and the `DYNAMIC_SCENARIO` import once nothing uses it).
- In the per-scenario fixture loop, skip resolver-backed slugs:

```ts
      for (const scenario of Object.keys(endpoint.scenarios)) {
        if (scenario === REAL_SCENARIO) continue // already flagged above
        if (endpoint.resolverScenarios.includes(scenario)) continue // backed by <slug>.ts, not a fixture
        // ... existing fixture read/parse/schema checks unchanged ...
      }
```

- [ ] **Step 6: `src/lib/runtime.ts`**

- Imports: `compileResolver, resolverFilePath, type CompiledResolver` (drop `dynamicFilePath`).
- Add a key helper and generalize compilation (replaces the old `compileResolvers` body):

```ts
function resolverKey(systemSlug: string, endpointName: string, slug: string): string {
  return `${systemSlug}/${endpointName}/${slug}`
}

// Compiles every endpoint's <slug>.ts resolvers at startup, aggregating
// failures into the same fail-fast error list as catalog/config problems.
// Also patches each resolver-backed scenario's UI label from the compiled
// module's optional `description` export (label = slug otherwise).
export function compileResolvers(
  catalog: Catalog,
  catalogDir: string,
): { resolvers: Map<string, CompiledResolver>; errors: string[] } {
  const resolvers = new Map<string, CompiledResolver>()
  const errors: string[] = []
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      for (const slug of endpoint.resolverScenarios) {
        const label = `${system.slug}/${endpoint.name}/${slug}.ts`
        try {
          const source = fs.readFileSync(
            resolverFilePath(catalogDir, system.slug, endpoint.name, slug),
            'utf8',
          )
          const compiled = compileResolver(source, label)
          resolvers.set(resolverKey(system.slug, endpoint.name, slug), compiled)
          if (compiled.description) endpoint.scenarios[slug] = compiled.description
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err))
        }
      }
    }
  }
  return { resolvers, errors }
}
```

- Dev counterpart:

```ts
function devCompileResolver(
  catalog: Catalog,
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
  slug: string,
): CompiledResolver | null {
  const endpoint = catalog.systems
    .find((s) => s.slug === systemSlug)
    ?.endpoints.find((e) => e.name === endpointName)
  if (!endpoint?.resolverScenarios.includes(slug)) return null
  const source = fs.readFileSync(resolverFilePath(catalogDir, systemSlug, endpointName, slug), 'utf8')
  return compileResolver(source, `${systemSlug}/${endpointName}/${slug}.ts`)
}
```

- `Runtime.getCompiledResolver: (systemSlug: string, endpointName: string, slug: string) => CompiledResolver | null`, wired:

```ts
    getCompiledResolver: isDev
      ? (systemSlug, endpointName, slug) =>
          devCompileResolver(catalog, catalogDir, systemSlug, endpointName, slug)
      : (systemSlug, endpointName, slug) =>
          resolvers.get(resolverKey(systemSlug, endpointName, slug)) ?? null,
```

- [ ] **Step 7: `src/lib/scenarios.ts` — final form**

```ts
import type { EndpointDef } from './catalog/types'
import { REAL_LABEL } from './config'

export const DEFAULT_SCENARIO = 'default'
export const REAL_SCENARIO = 'real'

export function implicitScenario(passthroughAsDefault: boolean): string {
  return passthroughAsDefault ? REAL_SCENARIO : DEFAULT_SCENARIO
}

export function scenariosWithPassthrough(
  endpoint: EndpointDef,
  passthroughAsDefault: boolean,
): Record<string, string> {
  const { default: defaultLabel, ...rest } = endpoint.scenarios
  const declared =
    defaultLabel === undefined ? endpoint.scenarios : { [DEFAULT_SCENARIO]: defaultLabel, ...rest }
  return passthroughAsDefault
    ? { [REAL_SCENARIO]: REAL_LABEL, ...declared }
    : { ...declared, [REAL_SCENARIO]: REAL_LABEL }
}

/**
 * Single source of truth for "is this step selectable on this endpoint" — a
 * declared scenario (fixture- or resolver-backed; both live in
 * endpoint.scenarios) or the implicit `real` passthrough. Used by every
 * write/validation path so the UI and API stay consistent with the router.
 */
export function isScenarioDeclared(endpoint: EndpointDef, scenario: string): boolean {
  return scenario === REAL_SCENARIO || scenario in endpoint.scenarios
}

export function danglingScenarioLabel(slug: string): string {
  return `${slug} — unavailable`
}

export function scenarioOptionsWithDangling(/* unchanged */) { /* unchanged body */ }
```

Update the four `isScenarioSelectable` call sites to `isScenarioDeclared`: `src/lib/profiles/stale.ts:13`, `src/lib/profiles/form.ts:61`, `src/lib/profiles/api-scenarios.ts:64`, `src/app/ui/api/global-mocks/[system]/[endpoint]/route.ts:37` (and `src/app/ui/global-mocks/actions.ts:24`).

- [ ] **Step 8: `src/lib/logs/store.ts`**

```ts
export type ScenarioSource = 'pin' | 'sequence' | 'implicit' | 'global' | 'unmocked_policy'
```

In `LogTraceData`: replace `dynamic?: { returned: string }` with:

```ts
  /** Present when a resolver-backed scenario ran: the picked slug and what it returned. */
  resolver?: { slug: string; returned: string }
```

- [ ] **Step 9: `src/lib/router/route-request.ts`**

- Imports: drop `DYNAMIC_SCENARIO`; keep `DEFAULT_SCENARIO`, `REAL_SCENARIO`, `implicitScenario`, `isScenarioDeclared` as used.
- Replace the trigger block (currently `if (scenario === DYNAMIC_SCENARIO) { ... }`):

```ts
  if (endpoint.resolverScenarios.includes(scenario)) {
    const resolved = await runResolver(system, endpoint, scenario, profileId, ctx, deps, trace)
    if (!resolved.ok) return resolved.result
    trace.resolver = { slug: scenario, returned: resolved.scenario }
    scenario = resolved.scenario
    trace.scenario = scenario
  }
```

(Note: `trace.scenarioSource` is deliberately NOT touched — it keeps the selection mechanism.)

- Rename `resolveDynamic` → `runResolver`, taking the picked slug:

```ts
async function runResolver(
  system: SystemDef,
  endpoint: EndpointDef,
  slug: string,
  profileId: string | null,
  ctx: RequestContext,
  deps: RouterDeps,
  trace: RouteTrace,
): Promise<{ ok: true; scenario: string } | { ok: false; result: RouteResult }> {
  let compiled: CompiledResolver | null
  try {
    compiled = deps.getCompiledResolver(system.slug, endpoint.name, slug)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    traceError(trace, 'resolver_compile_error', message)
    return {
      ok: false,
      result: jsonResult(500, { error: 'scenario resolver failed to compile', endpoint: endpoint.name, scenario: slug, message }),
    }
  }
  if (!compiled) {
    traceError(trace, 'resolver_missing',
      `scenario "${slug}" is resolver-backed but no compiled resolver was found for endpoint "${endpoint.name}"`)
    return {
      ok: false,
      result: jsonResult(500, { error: 'scenario resolver is missing', endpoint: endpoint.name, scenario: slug }),
    }
  }

  const ownerType: DynamicOwnerType = profileId ? 'profile' : 'global'
  const ownerKey = profileId ?? system.slug
  const history = await deps.getDynamicHistory(ownerType, ownerKey, endpoint.name, slug)
  const input: ResolverInput = { /* unchanged construction */ }
  const isolatedInput = structuredClone(input)

  let returned: unknown
  try {
    returned = compiled.invoke(isolatedInput, deps.dynamicResolverTimeoutMs ?? DEFAULT_DYNAMIC_TIMEOUT_MS)
  } catch (err) {
    if (err instanceof ResolverTimeoutError) {
      traceError(trace, 'resolver_timeout', err.message)
    } else {
      traceError(trace, 'resolver_threw', err instanceof Error ? err.message : String(err))
    }
    return { ok: false, result: jsonResult(500, { error: 'scenario resolver failed', endpoint: endpoint.name, scenario: slug }) }
  }

  // Return invariant: a fixture-backed declared slug, or "real". A
  // resolver-backed slug (including this one) would chain resolvers — rejected.
  const valid =
    typeof returned === 'string' &&
    (returned === REAL_SCENARIO ||
      (returned in endpoint.scenarios && !endpoint.resolverScenarios.includes(returned)))
  if (!valid) {
    traceError(trace, 'resolver_bad_return',
      `resolver "${slug}" returned an invalid scenario: ${JSON.stringify(returned)}`)
    return {
      ok: false,
      result: jsonResult(500, { error: 'scenario resolver returned an invalid scenario', endpoint: endpoint.name, scenario: slug, returned }),
    }
  }

  await deps.appendDynamicHistory(ownerType, ownerKey, endpoint.name, slug, returned)
  return { ok: true, scenario: returned }
}
```

(Keep the `ResolverRuntimeError` import only if still referenced; the `err instanceof ResolverRuntimeError` branch collapses into the generic `resolver_threw` else-branch above.)

- `RouterDeps.getCompiledResolver` gains the `slug` parameter:

```ts
  getCompiledResolver: (systemSlug: string, endpointName: string, slug: string) => CompiledResolver | null
```

- [ ] **Step 10: Compile-fix the app layer (minimal versions)**

- `src/app/ui/catalog/scenario-view.ts`: remove the `DYNAMIC_LABEL` import and `dynamic` view injection. `ScenarioView` kind union: replace `| { kind: 'dynamic' }` with `| { kind: 'resolver' }`. In `buildScenarioViews`, resolver-backed slugs get the resolver kind:

```ts
  const declared: ScenarioView[] = Object.entries(endpoint.scenarios).map(([key, label]) => {
    const isDefault = key === 'default'
    if (endpoint.resolverScenarios.includes(key)) {
      return { key, label, isDefault, kind: 'resolver' }
    }
    try {
      const fixture = loadFixture(catalogDir, system.slug, endpoint.name, key)
      return { key, label, isDefault, kind: 'fixture', json: JSON.stringify(fixture, null, 2) }
    } catch (err) {
      return { key, label, isDefault, kind: 'error', message: (err as Error).message }
    }
  })
```

Delete the `const dynamic: ScenarioView[] = ...` block and its spread.

- `src/app/ui/catalog/EndpointScenarios.tsx`: change the `kind === 'dynamic'` branch to:

```tsx
  if (scenario.kind === 'resolver') {
    return (
      <p className="font-mono text-[0.85rem] text-secondary-foreground">
        Resolved at request time by <code>{scenario.key}.ts</code> — returns a scenario slug per request.
      </p>
    )
  }
```

- `src/app/ui/global-mocks/GlobalMocksForm.tsx`: replace `stored === DYNAMIC_SCENARIO` with `stored !== undefined && endpoint.resolverScenarios.includes(stored)` (adjust to the variable actually in scope; drop the `DYNAMIC_SCENARIO` import). Leave the button label for Task 7.
- `src/app/ui/api/catalog/route.ts`: replace `hasResolver: endpoint.hasResolver ?? false` with `resolverScenarios: endpoint.resolverScenarios`.
- `src/app/ui/logs/LogRow.tsx`: delete the `dynamic:` entry from `scenarioSourceViews` (the narrowed `ScenarioSource` type forces this).

- [ ] **Step 11: Rename catalog + testdata resolver files**

```bash
git mv catalog/hello-system/account_balance/_dynamic.ts catalog/hello-system/account_balance/dynamic.ts
ls tests/testdata/fixtures/test-system/dynamic_ep/   # rename any _dynamic.ts here the same way
```

- [ ] **Step 12: Update the remaining tests**

Run `npx tsc --noEmit` and `npm test`, then fix file by file. Expected changes:

- `tests/router/dynamic.e2e.test.ts`: tmp catalogs write `'dynamic.ts'` instead of `'_dynamic.ts'`; profiles that pinned `dynamic` still pin `dynamic` (now an ordinary resolver-backed slug); `makeHistoryStore` key gains the scenario segment (done in Task 2); assertions on trace codes `dynamic_*` → `resolver_*`; assertions on `trace.dynamic` → `trace.resolver` (now `{ slug: 'dynamic', returned: … }`); `scenarioSource` assertions change from `'dynamic'` to the underlying selection mechanism (`'pin'`).
- `tests/router/route-request.test.ts`: endpoints in fixtures gain `resolverScenarios: []` (or `['dynamic']` where they had `hasResolver: true`); `getCompiledResolver` fakes gain the `slug` param; same trace-code/field renames.
- `tests/catalog/load.test.ts`: `hasResolver` expectations → `resolverScenarios`.
- `tests/lib/runtime.test.ts`: compiled-resolver lookups now need the slug argument; label patching from `description` can be asserted here if convenient.
- `tests/lib/scenarios.test.ts`: per Step 1.
- `tests/profiles/stale.test.ts`, `tests/profiles/form.test.ts`, `tests/profiles/api-scenarios.test.ts`, `tests/global-mocks/actions.test.ts`, `tests/api/global-mocks-route.test.ts`: `isScenarioSelectable` → `isScenarioDeclared`; endpoint literals gain `resolverScenarios: []`; a "dynamic is selectable only with hasResolver" test becomes "a resolver-backed slug is declared/selectable like any other".
- `tests/api/catalog-route.test.ts`: `hasResolver` → `resolverScenarios`.
- `tests/ui/scenario-view.test.ts`: `kind: 'dynamic'` → `kind: 'resolver'`; endpoints gain `resolverScenarios`.

- [ ] **Step 13: Verify everything**

Run: `npx tsc --noEmit && npm test && npm run validate:catalog`
Expected: all PASS (validate:catalog proves the renamed `catalog/hello-system` sample compiles).

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat!: generalize scenarios to fixture (x.json) or resolver (x.ts) backing

Any scenario slug can now be backed by a TypeScript resolver instead of a
fixture. The special _dynamic.ts file and reserved dynamic slug are removed;
rename _dynamic.ts to dynamic.ts to keep existing pins working. Resolver
history restarts (now keyed per scenario slug).

BREAKING CHANGE: _dynamic.ts is no longer recognized; the dynamic scenario
slug is no longer reserved or auto-injected; trace codes dynamic_* are now
resolver_*; scenarioSource 'dynamic' is replaced by a trace.resolver field."
```

---

### Task 5: Validation rules

**Files:**
- Modify: `src/lib/catalog/validate.ts`
- Test: `tests/catalog/validate.test.ts`

**Interfaces:**
- Consumes: `EndpointDef.resolverScenarios` (Task 4).
- Produces: startup errors for missing-default (either backing), reserved `real` (both backings), all-resolver endpoints. (The both-backings XOR error already lives in the loader, Task 4.)

- [ ] **Step 1: Write failing tests**

Add to `tests/catalog/validate.test.ts` (follow its existing catalog-literal conventions; endpoints now carry `resolverScenarios`):

```ts
it('accepts default.ts as the required default scenario', () => {
  // endpoint: scenarios { default: 'default', success: '…' }, resolverScenarios: ['default']
  // with success.json present on disk
  expect(errors).toEqual([])
})

it('rejects real.ts the same as real.json', () => {
  // endpoint with scenarios containing 'real', resolverScenarios: ['real']
  expect(errors).toContainEqual(expect.stringContaining('scenario "real" must not exist'))
})

it('rejects an endpoint whose scenarios are all resolver-backed', () => {
  // scenarios { default: 'default' }, resolverScenarios: ['default']
  expect(errors).toContainEqual(
    expect.stringContaining('declare at least one fixture-backed scenario'),
  )
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/catalog/validate.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement in `src/lib/catalog/validate.ts`**

Replace the default/real checks (around line 115):

```ts
      if (!(DEFAULT_SCENARIO in endpoint.scenarios)) {
        errors.push(
          `${label}: missing required "${DEFAULT_SCENARIO}" scenario ` +
            `(no default.json or default.ts)`,
        )
      }
      if (REAL_SCENARIO in endpoint.scenarios) {
        errors.push(
          `${label}: scenario "${REAL_SCENARIO}" must not exist (real.json or real.ts) — ` +
            `passthrough is implicit`,
        )
      }
      const fixtureBacked = Object.keys(endpoint.scenarios).filter(
        (s) => !endpoint.resolverScenarios.includes(s),
      )
      if (Object.keys(endpoint.scenarios).length > 0 && fixtureBacked.length === 0) {
        errors.push(
          `${label}: every scenario is resolver-backed (.ts) — declare at least one ` +
            `fixture-backed scenario for resolvers to return`,
        )
      }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: validate resolver-backed scenario rules at startup"
```

---

### Task 6: Request-log display — `picked → returned`

**Files:**
- Modify: `src/app/ui/logs/LogRow.tsx` (scenario chip around line 125; detail trace rows near `sourceView`, line ~173)
- Test: `tests/ui/log-row.test.tsx`

**Interfaces:**
- Consumes: `LogTraceData.resolver?: { slug, returned }` (Task 4). Note `trace.scenario` already holds the *final served* slug and `trace.resolver.returned === trace.scenario` on resolver-run requests.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write a failing test**

Add to `tests/ui/log-row.test.tsx` (follow its render conventions):

```tsx
it('shows picked → returned when a resolver ran', () => {
  // entry.trace = { scenario: 'hold', scenarioSource: 'implicit', resolver: { slug: 'default', returned: 'hold' } }
  render(<LogRow entry={entry} />)
  expect(screen.getByText('default → hold')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/log-row.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/app/ui/logs/LogRow.tsx` at the scenario chip (line ~125), render the resolver arrow form when present:

```tsx
            {entry.trace.scenario && (
              <span className={scenarioChipClass(entry.trace.scenario)}>
                {entry.trace.resolver
                  ? `${entry.trace.resolver.slug} → ${scenarioLabel(entry.trace.scenario)}`
                  : scenarioLabel(entry.trace.scenario)}
              </span>
            )}
```

If the detail view renders a per-field trace table near `sourceView`, add a `resolver` row there with the same `slug → returned` text (match the surrounding row markup).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: show resolver picked-vs-returned scenario in request logs"
```

---

### Task 7: Picker badge + reset-history condition and label

**Files:**
- Modify: `src/app/components/ScenarioPicker.tsx`
- Modify: `src/app/ui/profiles/ScenarioConfig.tsx`
- Modify: `src/app/ui/profiles/ProfileForm.tsx` (~line 102, pass `resolverSlugs`)
- Modify: `src/app/ui/global-mocks/GlobalMocksForm.tsx` (badge prop + label "Reset resolver history")
- Test: `tests/ui/profile-form.test.tsx`, `tests/ui/global-mocks-form.test.tsx`

**Interfaces:**
- Consumes: `EndpointDef.resolverScenarios` (Task 4).
- Produces: `ScenarioPicker` and `ScenarioConfig` accept `resolverSlugs?: string[]` (default `[]`).

- [ ] **Step 1: Write failing tests**

Add to `tests/ui/profile-form.test.tsx`:

```tsx
it('marks resolver-backed scenarios with a code badge and offers Reset resolver history', () => {
  // endpoint with scenarios { default, hold, 'by-amount' }, resolverScenarios: ['by-amount']
  // profile selection: 'by-amount'
  render(<ProfileForm ... />)
  expect(screen.getByLabelText('Resolved by code at request time')).toBeInTheDocument()
  expect(screen.getByText('Reset resolver history')).toBeInTheDocument()
})
```

Add to `tests/ui/global-mocks-form.test.tsx`: assert the button text is `Reset resolver history` (replacing any `Reset dynamic history` assertion) and that it renders when the stored selection is a resolver-backed slug.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/profile-form.test.tsx tests/ui/global-mocks-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `ScenarioPicker.tsx` — badge**

```tsx
import { CodeXml } from 'lucide-react'
```

Props gain `resolverSlugs?: string[]`. Inside the label, after the name span:

```tsx
            {resolverSlugs?.includes(key) && (
              <CodeXml
                className="size-3.5 flex-none text-muted-foreground"
                aria-label="Resolved by code at request time"
                role="img"
              />
            )}
```

- [ ] **Step 4: `ScenarioConfig.tsx` — prop, condition, label, sequence support**

- Props gain `resolverSlugs?: string[]` (default `[]` in destructuring). Pass through to `ScenarioPicker` and add the same badge inside `ScenarioSelect` options/trigger (render `CodeXml` next to the option label when `resolverSlugs.includes(key)`).
- Replace the reset-button condition (currently `singleValue === 'dynamic'`) and show it in both modes. After the single/sequence conditional blocks, compute:

```tsx
  const involvesResolver = (mode === 'single' ? [singleValue] : steps).some((s) =>
    resolverSlugs.includes(s),
  )
```

Render once, below whichever mode block is active:

```tsx
      {involvesResolver && resetDynamicAction && (
        <div className="flex w-full flex-wrap items-center gap-2.5">
          <button formAction={resetDynamicAction} className={resetButtonClass}>
            <RotateCcw className="size-[13px]" aria-hidden="true" />
            Reset resolver history
          </button>
        </div>
      )}
```

(Remove the old single-mode-only block at lines 116-123. The `resetDynamicAction` prop name and server actions keep their names — internal identifiers, not user-facing.)

- [ ] **Step 5: Pass `resolverSlugs` at both call sites**

- `ProfileForm.tsx` (~line 102): `resolverSlugs={endpoint.resolverScenarios}` on `<ScenarioConfig …>`.
- `GlobalMocksForm.tsx`: `resolverSlugs={endpoint.resolverScenarios}` on `<ScenarioPicker …>`; change the button text `Reset dynamic history` → `Reset resolver history`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: badge resolver-backed scenarios and generalize reset-history button"
```

---

### Task 8: Catalog page — resolver source + syntax highlighting

**Files:**
- Create: `src/app/ui/catalog/highlight.ts`
- Modify: `src/app/ui/catalog/scenario-view.ts` (async; `html` fields; read resolver source)
- Modify: `src/app/ui/catalog/EndpointScenarios.tsx` (render highlighted HTML)
- Modify: `src/app/ui/catalog/[system]/[endpoint]/page.tsx` (await the async builder)
- Modify: `src/app/globals.css` (shiki dual-theme swap)
- Modify: `package.json` (add `shiki`)
- Test: `tests/ui/scenario-view.test.ts`

**Interfaces:**
- Consumes: `ScenarioView` kinds from Task 4.
- Produces: `buildScenarioViews` becomes `async`; `kind: 'fixture'` gains `html: string` (keeps `json` for the status chip); `kind: 'resolver'` gains `code: string; html: string`.
- Check for other `buildScenarioViews` callers first: `grep -rn "buildScenarioViews" src tests` — update every caller to await.

- [ ] **Step 1: Install shiki**

Run: `npm install shiki`
Expected: added to `dependencies`.

- [ ] **Step 2: Update `tests/ui/scenario-view.test.ts` (failing)**

Make the test calls `await buildScenarioViews(...)`, and add:

```ts
it('includes resolver source and highlighted html for resolver-backed scenarios', async () => {
  // endpoint with by-amount.ts on disk in the tmp catalog
  const views = await buildScenarioViews(system, endpoint, dir, {}, false)
  const resolver = views.find((v) => v.key === 'by-amount')
  expect(resolver).toMatchObject({ kind: 'resolver' })
  expect((resolver as { code: string }).code).toContain('export default')
  expect((resolver as { html: string }).html).toContain('<pre')
})

it('includes highlighted html for fixture scenarios', async () => {
  const fixture = views.find((v) => v.kind === 'fixture')
  expect((fixture as { html: string }).html).toContain('<pre')
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/ui/scenario-view.test.ts`
Expected: FAIL.

- [ ] **Step 4: Create `src/app/ui/catalog/highlight.ts`**

```ts
import { codeToHtml } from 'shiki'

// Server-side dual-theme highlighting. defaultColor:false emits both palettes
// as --shiki-light/--shiki-dark CSS variables; globals.css swaps them on the
// `.dark` root class set by next-themes (attribute="class" in layout.tsx).
export async function highlight(code: string, lang: 'json' | 'typescript'): Promise<string> {
  return codeToHtml(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  })
}
```

- [ ] **Step 5: Make `buildScenarioViews` async with `html`**

In `src/app/ui/catalog/scenario-view.ts`:

- Type changes: `{ kind: 'fixture'; json: string; html: string }` and `{ kind: 'resolver'; code: string; html: string }`.
- `buildScenarioViews` returns `Promise<ScenarioView[]>`; map with `Promise.all`:

```ts
import fs from 'node:fs'
import { resolverFilePath } from '../../../lib/mock-engine/resolver'
import { highlight } from './highlight'
// ...
  const declared: ScenarioView[] = await Promise.all(
    Object.entries(endpoint.scenarios).map(async ([key, label]) => {
      const isDefault = key === 'default'
      if (endpoint.resolverScenarios.includes(key)) {
        try {
          const code = fs.readFileSync(
            resolverFilePath(catalogDir, system.slug, endpoint.name, key),
            'utf8',
          )
          return { key, label, isDefault, kind: 'resolver' as const, code, html: await highlight(code, 'typescript') }
        } catch (err) {
          return { key, label, isDefault, kind: 'error' as const, message: (err as Error).message }
        }
      }
      try {
        const fixture = loadFixture(catalogDir, system.slug, endpoint.name, key)
        const json = JSON.stringify(fixture, null, 2)
        return { key, label, isDefault, kind: 'fixture' as const, json, html: await highlight(json, 'json') }
      } catch (err) {
        return { key, label, isDefault, kind: 'error' as const, message: (err as Error).message }
      }
    }),
  )
```

(The `passthrough` view is unchanged.)

- [ ] **Step 6: Render in `EndpointScenarios.tsx`**

- Resolver branch replaces the Task-4 placeholder:

```tsx
  if (scenario.kind === 'resolver') {
    return (
      <div className="grid gap-2">
        <p className="font-mono text-[0.85rem] text-secondary-foreground">
          Resolved at request time by <code>{scenario.key}.ts</code>
        </p>
        <div
          className="overflow-x-auto rounded-sm border border-border text-[0.8rem] [&_pre]:p-3"
          dangerouslySetInnerHTML={{ __html: scenario.html }}
        />
      </div>
    )
  }
```

- In `FixtureContent`, render `html` for the body block instead of the plain `<pre>{bodyJson}</pre>` — pass `html` down from `ScenarioContent` (`<FixtureContent json={scenario.json} html={scenario.html} />`) and replace the body `<pre>` with the same `dangerouslySetInnerHTML` wrapper div. Keep the `json` prop for the header-chip parsing (`fixtureStatusFromJson` continues to use `scenario.json`).

- [ ] **Step 7: Await in the page + fix other callers**

`src/app/ui/catalog/[system]/[endpoint]/page.tsx`: `const scenarios = await buildScenarioViews(...)`. Fix any other caller found by `grep -rn "buildScenarioViews" src tests`.

- [ ] **Step 8: Dual-theme CSS in `src/app/globals.css`**

```css
/* shiki dual-theme: light values by default, dark values under .dark */
.shiki,
.shiki span {
  color: var(--shiki-light);
  background-color: var(--shiki-light-bg);
}
.dark .shiki,
.dark .shiki span {
  color: var(--shiki-dark);
  background-color: var(--shiki-dark-bg);
}
```

- [ ] **Step 9: Verify, including visually**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.
Then start the dev server (preview tooling / `.claude/launch.json`, not a bare shell) and open `/ui/catalog/hello-system/account_balance`: the `dynamic` scenario card shows highlighted TypeScript; fixture cards show highlighted JSON; toggle dark mode and confirm colors swap.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: show highlighted resolver source and fixture json on catalog page"
```

---

### Task 9: Documentation guide updates (requires user consent — AGENTS.md)

**Files:**
- Modify (on consent): `docs/site/docs/building/scenarios.md`, `docs/site/docs/building/dynamic.md`, `docs/site/docs/building/fixtures.md`, `docs/site/docs/building/endpoints.md`, `docs/site/docs/index.md`, `docs/site/docs/reference/configuration.md`, `docs/site/docs/reference/request-lifecycle.md`, `docs/site/docs/driving/request-logs.md`, `docs/site/docs/driving/api.md`

**Interfaces:** none — prose only.

- [ ] **Step 1: Ask the user (mandatory gate)**

Per AGENTS.md, list the guide drift for this feature (everything in the spec's "Documentation impact" section) and ask whether to update the guide. **Do not edit without a yes.**

- [ ] **Step 2 (on consent): Update the pages**

Rewrite against the *actual merged code*, not from memory. Coverage checklist:
- `building/dynamic.md`: retitle/reframe as code-backed scenario resolvers (`<slug>.ts`); resolver contract; return invariant (fixture-backed slug or `real`); `export const description`; per-slug history; `resolver_*` error codes; `default.ts` baseline pattern with the money-transfer example.
- `building/scenarios.md`: a scenario is `x.json` or `x.ts`; `real` the only reserved slug; `default` required in either backing; sequences may include resolver-backed steps.
- `building/fixtures.md` + `building/endpoints.md` + `index.md`: directory-shape mentions of `_dynamic.ts` → `<slug>.ts`; XOR rule.
- `reference/configuration.md`: `RESOLVER_HISTORY_LIMIT` (rename), new validation rules (XOR, default either backing, real both backings, ≥1 fixture-backed).
- `reference/request-lifecycle.md`: step 6 trigger is now "resolved slug is resolver-backed"; mermaid diagram + trace-code table updated to `resolver_*`; `scenarioSource` no longer overwritten; `trace.resolver` field.
- `driving/request-logs.md`: `picked → returned` display and the `resolver` trace field; `'dynamic'` source removed.
- `driving/api.md`: catalog discovery now returns `resolverScenarios` per endpoint (replacing `hasResolver`).

- [ ] **Step 3: Build the site**

Run: `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`
Expected: clean build, no broken links.

- [ ] **Step 4: Commit**

```bash
git add docs/site
git commit -m "docs: document code-backed scenarios in the guide"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit && npm test && npm run lint && npm run validate:catalog` — all clean.
- [ ] `grep -rni "_dynamic\|DYNAMIC_SCENARIO\|DYNAMIC_LABEL\|hasResolver\|DYNAMIC_HISTORY_LIMIT\|isScenarioSelectable" src tests catalog` — zero hits (docs/ and specs may still reference them historically).
- [ ] Manual smoke via dev server: pin a profile to the `dynamic` slug on `hello-system/account_balance` → behaves as before Task 4 (failure then default per its resolver); `</>` badge visible; reset button reads "Reset resolver history"; request log shows `dynamic → failure`.
