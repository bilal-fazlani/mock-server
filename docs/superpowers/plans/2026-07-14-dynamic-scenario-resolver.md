# Dynamic Scenario Resolver (`_dynamic.ts`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let developers author a trusted, per-endpoint `_dynamic.ts` that picks which scenario to serve from the request plus a bounded history of previously returned slugs, exposed as a reserved `dynamic` scenario alongside `real`.

**Architecture:** `dynamic` is a reserved scenario slug modeled on the existing `real` slug — injected into an endpoint's scenario list only when `_dynamic.ts` exists. When the resolved scenario is `dynamic`, the router runs the (esbuild-transpiled, `node:vm`-sandboxed, synchronous, pure) resolver, **rewrites the scenario slug in place** to its return value, and lets the existing fixture/`real`/template/schema/logging pipeline run verbatim. History is a dedicated capped MongoDB store.

**Tech Stack:** TypeScript, Next.js 16, MongoDB (`mongodb` driver), `esbuild` (new runtime dep) for TS transpile, `node:vm` for sandboxing, Vitest (+ `mongodb-memory-server`) for tests.

## Global Constraints

- **Reserved slug:** `dynamic` — copied verbatim as the constant value everywhere; a declared scenario named `dynamic` or a `dynamic.json` fixture is a catalog error.
- **Resolver file name:** `_dynamic.ts` exactly (leading underscore, `.ts`).
- **Resolver contract:** default export, **synchronous**, **pure**, no I/O. Signature `(input: ResolverInput) => string`. Return value must satisfy `isScenarioDeclared(endpoint, slug)` (a declared fixture slug or `"real"`); returning `"dynamic"`, an undeclared slug, or a non-string is a request-time error.
- **History env var:** `DYNAMIC_HISTORY_LIMIT`, default `10`, positive integer, shown on the environment page. Invalid value → `ConfigError` at startup.
- **Resolver timeout:** constant `DEFAULT_DYNAMIC_TIMEOUT_MS = 100` (ms). Enforced via `node:vm` `{ timeout }`.
- **Fail-loud on drift:** a `dynamic` pin with no `_dynamic.ts` is a request-time 500 (`dynamic_resolver_missing`), never an auto-heal.
- **Follow existing patterns:** stores take `db: Db` (see `src/lib/profiles/store.ts`); router is unit-tested with a fake `RouterDeps` (see `tests/router/route-request.test.ts`); Mongo tests use `mongodb-memory-server` (see `tests/profiles/store.test.ts`).

---

## File Structure

**New files**
- `src/lib/mock-engine/resolver.ts` — esbuild transpile + `node:vm` compile/invoke; `ResolverInput` type; error classes; `dynamicFilePath`.
- `src/lib/dynamic/history-store.ts` — capped dynamic-history collection accessors.
- `tests/mock-engine/resolver.test.ts`, `tests/dynamic/history-store.test.ts`.

**Modified files**
- `src/lib/catalog/types.ts` — `EndpointDef.hasResolver?: boolean`.
- `src/lib/catalog/load.ts` — recognize/skip `_dynamic.ts`, set `hasResolver`.
- `src/lib/catalog/validate.ts` — reserve the `dynamic` slug.
- `src/lib/config.ts` — `parseDynamicHistoryLimit`.
- `src/lib/environment.ts` — `DYNAMIC_HISTORY_LIMIT` row.
- `src/lib/scenarios.ts` — `DYNAMIC_SCENARIO`/`DYNAMIC_LABEL`, inject `dynamic` into `scenariosWithPassthrough`, `danglingScenarioLabel` helper.
- `src/lib/logs/store.ts` — `ScenarioSource` gains `'dynamic'`; `LogTraceData.dynamic`.
- `src/lib/runtime.ts` — compile resolver registry, `getCompiledResolver`, `dynamicHistoryLimit`.
- `src/lib/router/route-request.ts` — dynamic resolution step + `RouterDeps` additions.
- `src/app/[...path]/route.ts` — wire the new deps.
- `src/lib/profiles/store.ts` — `dynamicHistory` index + `deleteProfile` cleanup.
- `src/app/ui/catalog/scenario-view.ts` + `EndpointScenarios.tsx` — `dynamic` scenario card.
- `src/app/components/ScenarioPicker.tsx`, `src/app/ui/profiles/ScenarioConfig.tsx`, `src/app/ui/global-mocks/GlobalMocksForm.tsx` — dangling-pin display.
- `src/app/ui/profiles/actions.ts` — `resetDynamicHistoryAction`.

---

## Task 1: Resolver compile/invoke module (esbuild + vm)

**Files:**
- Create: `src/lib/mock-engine/resolver.ts`
- Test: `tests/mock-engine/resolver.test.ts`
- Modify: `package.json` (add `esbuild` dependency)

**Interfaces:**
- Produces:
  - `interface ResolverInput { request: { method: string; path: string; pathParams: Record<string, string>; query: Record<string, string[]>; headers: Record<string, string>; body: unknown }; history: string[]; profileId: string | null }`
  - `interface CompiledResolver { invoke(input: ResolverInput, timeoutMs: number): unknown }`
  - `function compileResolver(source: string, label: string): CompiledResolver`
  - `function dynamicFilePath(catalogDir: string, systemSlug: string, endpointName: string): string`
  - `const DYNAMIC_FILE = '_dynamic.ts'`
  - `const DEFAULT_DYNAMIC_TIMEOUT_MS = 100`
  - `class ResolverCompileError extends Error {}`
  - `class ResolverRuntimeError extends Error {}`
  - `class ResolverTimeoutError extends Error {}`

- [ ] **Step 1: Add esbuild dependency**

Run: `npm install esbuild@^0.25.0`
Expected: `esbuild` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Write failing tests**

Create `tests/mock-engine/resolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  compileResolver,
  ResolverCompileError,
  ResolverRuntimeError,
  ResolverTimeoutError,
  type ResolverInput,
} from '../../src/lib/mock-engine/resolver'

const input = (over: Partial<ResolverInput> = {}): ResolverInput => ({
  request: { method: 'POST', path: '/x', pathParams: {}, query: {}, headers: {}, body: null },
  history: [],
  profileId: null,
  ...over,
})

describe('compileResolver', () => {
  it('runs a default-exported function and returns its value', () => {
    const r = compileResolver(
      `export default (i: { history: string[] }) => i.history.length < 2 ? 'pending' : 'success'`,
      'x/y',
    )
    expect(r.invoke(input(), 100)).toBe('pending')
    expect(r.invoke(input({ history: ['a', 'b'] }), 100)).toBe('success')
  })

  it('branches on request content', () => {
    const r = compileResolver(
      `export default (i: any) => i.request.body?.amount > 10 ? 'flagged' : 'default'`,
      'x/y',
    )
    expect(r.invoke(input({ request: { ...input().request, body: { amount: 99 } } }), 100)).toBe('flagged')
  })

  it('throws ResolverCompileError on a syntax error', () => {
    expect(() => compileResolver('export default (=>', 'x/y')).toThrow(ResolverCompileError)
  })

  it('throws ResolverCompileError when there is no function export', () => {
    expect(() => compileResolver('export const foo = 1', 'x/y')).toThrow(ResolverCompileError)
  })

  it('wraps a thrown error as ResolverRuntimeError', () => {
    const r = compileResolver(`export default () => { throw new Error('boom') }`, 'x/y')
    expect(() => r.invoke(input(), 100)).toThrow(ResolverRuntimeError)
  })

  it('interrupts an infinite loop as ResolverTimeoutError', () => {
    const r = compileResolver(`export default () => { while (true) {} }`, 'x/y')
    expect(() => r.invoke(input(), 50)).toThrow(ResolverTimeoutError)
  })

  it('has no access to require, process, or fetch', () => {
    const r = compileResolver(
      `export default () => (typeof require) + ',' + (typeof process) + ',' + (typeof fetch)`,
      'x/y',
    )
    expect(r.invoke(input(), 100)).toBe('undefined,undefined,undefined')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/mock-engine/resolver.test.ts`
Expected: FAIL — cannot find module `resolver`.

- [ ] **Step 4: Implement `src/lib/mock-engine/resolver.ts`**

```ts
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

export const DYNAMIC_FILE = '_dynamic.ts'
export const DEFAULT_DYNAMIC_TIMEOUT_MS = 100

export interface ResolverInput {
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
}

export interface CompiledResolver {
  invoke(input: ResolverInput, timeoutMs: number): unknown
}

export class ResolverCompileError extends Error {}
export class ResolverRuntimeError extends Error {}
export class ResolverTimeoutError extends Error {}

export function dynamicFilePath(catalogDir: string, systemSlug: string, endpointName: string): string {
  return path.join(catalogDir, systemSlug, endpointName, DYNAMIC_FILE)
}

export function compileResolver(source: string, label: string): CompiledResolver {
  let code: string
  try {
    code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node18' }).code
  } catch (err) {
    throw new ResolverCompileError(`${label}: failed to transpile _dynamic.ts: ${message(err)}`)
  }

  // Empty context: no require / process / fetch / console leak from the host.
  const sandbox: Record<string, unknown> = { module: { exports: {} } }
  sandbox.exports = (sandbox.module as { exports: unknown }).exports
  const context = vm.createContext(sandbox)
  try {
    new vm.Script(code, { filename: label }).runInContext(context, { timeout: 1000 })
  } catch (err) {
    throw new ResolverCompileError(`${label}: failed to evaluate _dynamic.ts: ${message(err)}`)
  }

  const mod = (sandbox.module as { exports: Record<string, unknown> }).exports
  const fn = typeof mod === 'function' ? mod : (mod?.default as unknown)
  if (typeof fn !== 'function') {
    throw new ResolverCompileError(`${label}: _dynamic.ts must default-export a function`)
  }
  sandbox.__resolver = fn
  const invokeScript = new vm.Script('__resolver(__input)', { filename: `${label}#invoke` })

  return {
    invoke(input: ResolverInput, timeoutMs: number): unknown {
      sandbox.__input = input
      try {
        return invokeScript.runInContext(context, { timeout: timeoutMs })
      } catch (err) {
        if (isTimeout(err)) {
          throw new ResolverTimeoutError(`${label}: _dynamic.ts exceeded ${timeoutMs}ms`)
        }
        throw new ResolverRuntimeError(`${label}: _dynamic.ts threw: ${message(err)}`)
      }
    },
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && /timed out/i.test(err.message)
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mock-engine/resolver.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/mock-engine/resolver.ts tests/mock-engine/resolver.test.ts
git commit -m "feat: add sandboxed _dynamic.ts resolver compile/invoke module"
```

---

## Task 2: Dynamic history store

**Files:**
- Create: `src/lib/dynamic/history-store.ts`
- Test: `tests/dynamic/history-store.test.ts`
- Modify: `src/lib/profiles/store.ts` (`ensureIndexes`, `deleteProfile`)

**Interfaces:**
- Produces:
  - `type DynamicOwnerType = 'profile' | 'global'`
  - `function getDynamicHistory(db: Db, ownerType: DynamicOwnerType, ownerKey: string, endpointName: string): Promise<string[]>`
  - `function appendDynamicHistory(db: Db, ownerType: DynamicOwnerType, ownerKey: string, endpointName: string, slug: string, limit: number): Promise<void>`
  - `function resetDynamicHistory(db: Db, ownerType: DynamicOwnerType, ownerKey: string, endpointName?: string): Promise<void>`
- Consumes: `getDb`/`ensureIndexes` conventions from `src/lib/profiles/store.ts`.

- [ ] **Step 1: Write failing tests**

Create `tests/dynamic/history-store.test.ts`:

```ts
import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  appendDynamicHistory,
  getDynamicHistory,
  resetDynamicHistory,
} from '../../src/lib/dynamic/history-store'
import { deleteProfile, ensureIndexes } from '../../src/lib/profiles/store'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('test')
  await ensureIndexes(db)
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  await db.collection('dynamicHistory').deleteMany({})
})

describe('dynamic history store', () => {
  it('starts empty and appends in order', async () => {
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual([])
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'b', 10)
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual(['a', 'b'])
  })

  it('caps to the last N entries', async () => {
    for (const slug of ['a', 'b', 'c', 'd']) {
      await appendDynamicHistory(db, 'profile', 'c1', 'ep', slug, 2)
    }
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual(['c', 'd'])
  })

  it('keys profile and global owners separately', async () => {
    await appendDynamicHistory(db, 'profile', 'shared', 'ep', 'p', 10)
    await appendDynamicHistory(db, 'global', 'shared', 'ep', 'g', 10)
    expect(await getDynamicHistory(db, 'profile', 'shared', 'ep')).toEqual(['p'])
    expect(await getDynamicHistory(db, 'global', 'shared', 'ep')).toEqual(['g'])
  })

  it('resets one endpoint or a whole owner', async () => {
    await appendDynamicHistory(db, 'profile', 'c1', 'ep1', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'c1', 'ep2', 'b', 10)
    await resetDynamicHistory(db, 'profile', 'c1', 'ep1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep1')).toEqual([])
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep2')).toEqual(['b'])
    await resetDynamicHistory(db, 'profile', 'c1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep2')).toEqual([])
  })

  it('deleteProfile removes that profile\'s dynamic history', async () => {
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'a', 10)
    await deleteProfile(db, 'c1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dynamic/history-store.test.ts`
Expected: FAIL — cannot find module `history-store`.

- [ ] **Step 3: Implement `src/lib/dynamic/history-store.ts`**

```ts
import { Db } from 'mongodb'

export type DynamicOwnerType = 'profile' | 'global'

interface DynamicHistoryDoc {
  ownerType: DynamicOwnerType
  ownerKey: string
  endpointName: string
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
): Promise<string[]> {
  const doc = await db
    .collection<DynamicHistoryDoc>(COLLECTION)
    .findOne({ ownerType, ownerKey, endpointName }, { projection: { _id: 0, history: 1 } })
  return doc?.history ?? []
}

export async function appendDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName: string,
  slug: string,
  limit: number,
): Promise<void> {
  const now = new Date()
  await db.collection<DynamicHistoryDoc>(COLLECTION).updateOne(
    { ownerType, ownerKey, endpointName },
    {
      $push: { history: { $each: [slug], $slice: -Math.max(1, limit) } },
      $set: { modifiedAt: now },
      $setOnInsert: { ownerType, ownerKey, endpointName, createdAt: now },
    },
    { upsert: true },
  )
}

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

- [ ] **Step 4: Add the index and profile-deletion cleanup in `src/lib/profiles/store.ts`**

In `ensureIndexes`, after the `scenarioProgress` index (around line 102), add:

```ts
  await db
    .collection('dynamicHistory')
    .createIndex({ ownerType: 1, ownerKey: 1, endpointName: 1 }, { unique: true })
```

In `deleteProfile` (around line 149-154), add a line alongside the other `deleteMany` calls:

```ts
  await db.collection('dynamicHistory').deleteMany({ ownerType: 'profile', ownerKey: profileId })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/dynamic/history-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/dynamic/history-store.ts tests/dynamic/history-store.test.ts src/lib/profiles/store.ts
git commit -m "feat: add capped dynamic-history store with profile-deletion cleanup"
```

---

## Task 3: Catalog — `hasResolver`, loader skip, reserved slug

**Files:**
- Modify: `src/lib/catalog/types.ts`
- Modify: `src/lib/catalog/load.ts`
- Modify: `src/lib/catalog/validate.ts`
- Test: `tests/catalog/load.test.ts`, `tests/catalog/validate.test.ts`

**Interfaces:**
- Produces: `EndpointDef.hasResolver?: boolean` (true iff a `_dynamic.ts` file sits in the endpoint dir).
- Consumes: `DYNAMIC_FILE` from `src/lib/mock-engine/resolver.ts` (Task 1).

- [ ] **Step 1: Write failing tests**

In `tests/catalog/load.test.ts`, add a test that a `_dynamic.ts` file sets `hasResolver` and is not treated as a scenario or an unexpected entry. Mirror the existing fixture-directory setup in that file (it builds temp catalog dirs); add:

```ts
it('marks an endpoint with _dynamic.ts as hasResolver and ignores the file as a scenario', () => {
  const dir = makeCatalog({
    'sys/_system.json': JSON.stringify({ name: 'Sys', baseUrlEnv: 'SYS_URL' }),
    'sys/ep/_endpoint.json': JSON.stringify({ displayName: 'Ep', method: 'GET', path: '/ep' }),
    'sys/ep/default.json': JSON.stringify({ status: 200, body: {} }),
    'sys/ep/_dynamic.ts': `export default () => 'default'`,
  })
  const catalog = loadCatalog(dir)
  const ep = catalog.systems[0].endpoints[0]
  expect(ep.hasResolver).toBe(true)
  expect(Object.keys(ep.scenarios)).toEqual(['default'])
})
```

> Use `makeCatalog` (or the equivalent temp-dir helper already present in `tests/catalog/load.test.ts`). If the helper has a different name, use that name; the point is: write files into a temp catalog dir and call `loadCatalog`.

In `tests/catalog/validate.test.ts`, add:

```ts
it('rejects a scenario named "dynamic"', () => {
  const catalog: Catalog = {
    systems: [
      {
        name: 'Sys', slug: 'sys', baseUrlEnv: 'SYS_URL',
        endpoints: [
          {
            name: 'ep', displayName: 'Ep', method: 'GET', path: '/ep',
            profileIdSelector: '$.id',
            scenarios: { default: 'Default', dynamic: 'Nope' },
          },
        ],
      },
    ],
  }
  const { errors } = validateCatalog(catalog, DUMMY_DIR)
  expect(errors.some((e) => e.includes('"dynamic" must not exist'))).toBe(true)
})
```

> `DUMMY_DIR` / catalog-building conventions: match how the other cases in `tests/catalog/validate.test.ts` already construct their input.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/catalog/load.test.ts tests/catalog/validate.test.ts`
Expected: FAIL — `hasResolver` undefined; no `"dynamic" must not exist` error.

- [ ] **Step 3: Add `hasResolver` to `EndpointDef`**

In `src/lib/catalog/types.ts`, inside `EndpointDef` (after `scenarios`):

```ts
  /** True when a _dynamic.ts resolver file exists in the endpoint directory. */
  hasResolver?: boolean
```

- [ ] **Step 4: Recognize `_dynamic.ts` in the loader**

In `src/lib/catalog/load.ts`:

Add the import at the top:

```ts
import { DYNAMIC_FILE } from '../mock-engine/resolver'
```

In the endpoint loop, declare a flag before the scenario scan (before line 48 `const scenarios ...`):

```ts
      let hasResolver = false
```

Inside the `for (const fixEntry of sortedEntries(endpointDir))` loop, add this as the first check (before the `ENDPOINT_META`/`SCHEMA_META` skip at line 50):

```ts
        if (fixEntry.name === DYNAMIC_FILE) {
          hasResolver = true
          continue
        }
```

In the `endpoints.push({ ... })` object (line 65-75), add after `scenarios: orderDefaultFirst(scenarios),`:

```ts
        ...(hasResolver ? { hasResolver: true } : {}),
```

- [ ] **Step 5: Reserve the `dynamic` slug in validation**

In `src/lib/catalog/validate.ts`, add the constant near line 21:

```ts
const DYNAMIC_SCENARIO = 'dynamic'
```

After the `REAL_SCENARIO in endpoint.scenarios` check (line 117-121), add:

```ts
      if (DYNAMIC_SCENARIO in endpoint.scenarios) {
        errors.push(
          `${label}: scenario "${DYNAMIC_SCENARIO}" must not exist (dynamic.json) — ` +
            `it is reserved for the _dynamic.ts resolver`,
        )
      }
```

In the fixture-existence loop, next to `if (scenario === REAL_SCENARIO) continue` (line 124), add:

```ts
        if (scenario === DYNAMIC_SCENARIO) continue // reserved; flagged above
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/load.test.ts tests/catalog/validate.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog/types.ts src/lib/catalog/load.ts src/lib/catalog/validate.ts tests/catalog/load.test.ts tests/catalog/validate.test.ts
git commit -m "feat: recognize _dynamic.ts in catalog load and reserve the dynamic slug"
```

---

## Task 4: Config — `DYNAMIC_HISTORY_LIMIT`

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/lib/environment.ts`
- Test: `tests/lib/config.test.ts`, `tests/lib/environment.test.ts`

**Interfaces:**
- Produces: `function parseDynamicHistoryLimit(raw: string | undefined): number` (default 10, positive integer, else `ConfigError`).

- [ ] **Step 1: Write failing tests**

In `tests/lib/config.test.ts`, add:

```ts
import { parseDynamicHistoryLimit, ConfigError } from '../../src/lib/config'

describe('parseDynamicHistoryLimit', () => {
  it('defaults to 10 when unset', () => {
    expect(parseDynamicHistoryLimit(undefined)).toBe(10)
  })
  it('parses a positive integer', () => {
    expect(parseDynamicHistoryLimit('25')).toBe(25)
  })
  it('rejects zero, negatives, and non-integers', () => {
    expect(() => parseDynamicHistoryLimit('0')).toThrow(ConfigError)
    expect(() => parseDynamicHistoryLimit('-3')).toThrow(ConfigError)
    expect(() => parseDynamicHistoryLimit('abc')).toThrow(ConfigError)
    expect(() => parseDynamicHistoryLimit('1.5')).toThrow(ConfigError)
  })
})
```

In `tests/lib/environment.test.ts`, add an assertion that `DYNAMIC_HISTORY_LIMIT` appears in the rows with default `10`:

```ts
it('includes DYNAMIC_HISTORY_LIMIT with a default of 10', () => {
  const rows = buildEnvironmentRows({ systems: [] }, {})
  const row = rows.find((r) => r.name === 'DYNAMIC_HISTORY_LIMIT')
  expect(row?.value).toBe('(default: 10)')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/config.test.ts tests/lib/environment.test.ts`
Expected: FAIL — `parseDynamicHistoryLimit` undefined; no row found.

- [ ] **Step 3: Implement `parseDynamicHistoryLimit`**

In `src/lib/config.ts`, append:

```ts
export function parseDynamicHistoryLimit(raw: string | undefined): number {
  if (raw === undefined) return 10
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ConfigError(`DYNAMIC_HISTORY_LIMIT must be a positive integer, got "${raw}"`)
  }
  return n
}
```

- [ ] **Step 4: Add the environment row**

In `src/lib/environment.ts`, add to `APP_ENVIRONMENT` (after `PASSTHROUGH_TIMEOUT_MS`):

```ts
  {
    name: 'DYNAMIC_HISTORY_LIMIT',
    category: 'Routing',
    description: 'Number of past returned slugs passed to _dynamic.ts resolvers as history.',
    defaultValue: '10',
    display: true,
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/config.test.ts tests/lib/environment.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts src/lib/environment.ts tests/lib/config.test.ts tests/lib/environment.test.ts
git commit -m "feat: add DYNAMIC_HISTORY_LIMIT env var and environment row"
```

---

## Task 5: Scenarios — `dynamic` constant, injection, dangling label

**Files:**
- Modify: `src/lib/scenarios.ts`
- Test: `tests/lib/scenarios.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `const DYNAMIC_SCENARIO = 'dynamic'`
  - `const DYNAMIC_LABEL = 'Dynamic'`
  - `scenariosWithPassthrough` includes `dynamic` when `endpoint.hasResolver`
  - `function danglingScenarioLabel(slug: string): string`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/scenarios.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EndpointDef } from '../../src/lib/catalog/types'
import {
  danglingScenarioLabel,
  DYNAMIC_SCENARIO,
  scenariosWithPassthrough,
} from '../../src/lib/scenarios'

const ep = (over: Partial<EndpointDef> = {}): EndpointDef => ({
  name: 'ep', displayName: 'Ep', method: 'GET', path: '/ep',
  scenarios: { default: 'Default', frozen: 'Frozen' },
  ...over,
})

describe('scenariosWithPassthrough', () => {
  it('omits dynamic when there is no resolver', () => {
    const keys = Object.keys(scenariosWithPassthrough(ep(), false))
    expect(keys).toEqual(['default', 'frozen', 'real'])
  })
  it('includes dynamic (before real) when hasResolver is true', () => {
    const keys = Object.keys(scenariosWithPassthrough(ep({ hasResolver: true }), false))
    expect(keys).toEqual(['default', 'frozen', DYNAMIC_SCENARIO, 'real'])
  })
})

describe('danglingScenarioLabel', () => {
  it('special-cases dynamic', () => {
    expect(danglingScenarioLabel('dynamic')).toBe('Dynamic — unavailable (no _dynamic.ts)')
  })
  it('generic for other slugs', () => {
    expect(danglingScenarioLabel('frozen')).toBe('frozen — unavailable')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/scenarios.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement in `src/lib/scenarios.ts`**

Add constants near the top (after `REAL_SCENARIO`):

```ts
export const DYNAMIC_SCENARIO = 'dynamic'
export const DYNAMIC_LABEL = 'Dynamic'
```

Replace `scenariosWithPassthrough` with:

```ts
export function scenariosWithPassthrough(
  endpoint: EndpointDef,
  passthroughAsDefault: boolean,
): Record<string, string> {
  const { default: defaultLabel, ...rest } = endpoint.scenarios
  const declared =
    defaultLabel === undefined ? endpoint.scenarios : { [DEFAULT_SCENARIO]: defaultLabel, ...rest }
  const withDynamic = endpoint.hasResolver
    ? { ...declared, [DYNAMIC_SCENARIO]: DYNAMIC_LABEL }
    : declared
  return passthroughAsDefault
    ? { [REAL_SCENARIO]: REAL_LABEL, ...withDynamic }
    : { ...withDynamic, [REAL_SCENARIO]: REAL_LABEL }
}
```

Append:

```ts
export function danglingScenarioLabel(slug: string): string {
  return slug === DYNAMIC_SCENARIO ? 'Dynamic — unavailable (no _dynamic.ts)' : `${slug} — unavailable`
}
```

> Note: `isScenarioDeclared` is deliberately left unchanged — it returns `false` for `dynamic`, which is exactly what the resolver's return-value validation (Task 8) needs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/scenarios.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scenarios.ts tests/lib/scenarios.test.ts
git commit -m "feat: inject dynamic scenario and add dangling-scenario label helper"
```

---

## Task 6: Log trace types for `dynamic`

**Files:**
- Modify: `src/lib/logs/store.ts`

**Interfaces:**
- Produces: `ScenarioSource` includes `'dynamic'`; `LogTraceData.dynamic?: { returned: string }`.

- [ ] **Step 1: Extend the types**

In `src/lib/logs/store.ts`:

Change `ScenarioSource` (line 5) to:

```ts
export type ScenarioSource = 'pin' | 'sequence' | 'implicit' | 'global' | 'unmocked_policy' | 'dynamic'
```

In `LogTraceData` (after `sequence?`, around line 27), add:

```ts
  dynamic?: { returned: string }
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors from this change (unrelated pre-existing output, if any, unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/lib/logs/store.ts
git commit -m "feat: add dynamic scenario source and trace field to log types"
```

---

## Task 7: Runtime — resolver registry, `getCompiledResolver`, `dynamicHistoryLimit`

**Files:**
- Modify: `src/lib/runtime.ts`
- Test: `tests/lib/runtime.test.ts`

**Interfaces:**
- Produces (on `Runtime`):
  - `dynamicHistoryLimit: number`
  - `getCompiledResolver(systemSlug: string, endpointName: string): CompiledResolver | null`
- Consumes: `compileResolver`, `dynamicFilePath`, `CompiledResolver` (Task 1); `parseDynamicHistoryLimit` (Task 4); `EndpointDef.hasResolver` (Task 3).

- [ ] **Step 1: Write failing tests**

`tests/lib/runtime.test.ts` already exercises `getRuntime` against a temp catalog. Add a case (matching that file's existing catalog-building helper and `process.env`/`process.cwd` handling):

```ts
it('compiles _dynamic.ts and serves it via getCompiledResolver', () => {
  // ...build a temp catalog dir with an endpoint that has default.json and
  // _dynamic.ts (`export default () => 'default'`), point process.cwd()/env at it
  // exactly as the other tests in this file do...
  const rt = getRuntime()
  const resolver = rt.getCompiledResolver('sys', 'ep')
  expect(resolver).not.toBeNull()
  expect(rt.dynamicHistoryLimit).toBe(10)
})

it('fails startup when _dynamic.ts does not compile', () => {
  // ...temp catalog with _dynamic.ts = `export default (=>` ...
  expect(() => getRuntime()).toThrow(/catalog validation failed/)
})
```

> Follow the exact temp-catalog + module-reset pattern already in `tests/lib/runtime.test.ts` (it resets the cached runtime between cases). If that file resets the singleton via `vi.resetModules()` or a dedicated export, use the same mechanism.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/runtime.test.ts`
Expected: FAIL — `getCompiledResolver`/`dynamicHistoryLimit` undefined.

- [ ] **Step 3: Implement in `src/lib/runtime.ts`**

Add imports:

```ts
import fs from 'node:fs'
import { schemaKey } from './catalog/schema'
import { parseDynamicHistoryLimit } from './config'
import {
  compileResolver,
  dynamicFilePath,
  ResolverCompileError,
  type CompiledResolver,
} from './mock-engine/resolver'
```

Extend the `Runtime` interface:

```ts
  dynamicHistoryLimit: number
  getCompiledResolver: (systemSlug: string, endpointName: string) => CompiledResolver | null
```

Add a helper that compiles all resolvers at startup, collecting errors:

```ts
function compileResolvers(
  catalog: Catalog,
  catalogDir: string,
): { resolvers: Map<string, CompiledResolver>; errors: string[] } {
  const resolvers = new Map<string, CompiledResolver>()
  const errors: string[] = []
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      if (!endpoint.hasResolver) continue
      const label = `${system.slug}/${endpoint.name}`
      try {
        const source = fs.readFileSync(dynamicFilePath(catalogDir, system.slug, endpoint.name), 'utf8')
        resolvers.set(schemaKey(system.slug, endpoint.name), compileResolver(source, label))
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
  }
  return { resolvers, errors }
}
```

In `getRuntime`, parse the limit near the other env parses:

```ts
  const dynamicHistoryLimit = parseDynamicHistoryLimit(process.env.DYNAMIC_HISTORY_LIMIT)
```

Compile resolvers and fold their errors into the startup error list. After `const configErrors = validateAppConfig(...)`:

```ts
  const { resolvers, errors: resolverErrors } = compileResolvers(catalog, catalogDir)
  const errors = [...catalogErrors, ...configErrors, ...resolverErrors]
```

(Replace the existing `const errors = [...catalogErrors, ...configErrors]` line.)

Add the two fields to the `runtime = { ... }` object:

```ts
    dynamicHistoryLimit,
    getCompiledResolver: isDev
      ? (systemSlug, endpointName) => devCompileResolver(catalog, catalogDir, systemSlug, endpointName)
      : (systemSlug, endpointName) => resolvers.get(schemaKey(systemSlug, endpointName)) ?? null,
```

Add the dev helper at the bottom of the file (re-reads and re-compiles per request so edits apply live; a compile error here surfaces as a request-time 500 in Task 8):

```ts
function devCompileResolver(
  catalog: Catalog,
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
): CompiledResolver | null {
  const endpoint = catalog.systems
    .find((s) => s.slug === systemSlug)
    ?.endpoints.find((e) => e.name === endpointName)
  if (!endpoint?.hasResolver) return null
  const source = fs.readFileSync(dynamicFilePath(catalogDir, systemSlug, endpointName), 'utf8')
  return compileResolver(source, `${systemSlug}/${endpointName}`)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runtime.ts tests/lib/runtime.test.ts
git commit -m "feat: compile _dynamic.ts resolvers at startup and expose via runtime"
```

---

## Task 8: Router — dynamic resolution step

**Files:**
- Modify: `src/lib/router/route-request.ts`
- Test: `tests/router/route-request.test.ts`

**Interfaces:**
- Consumes: `CompiledResolver`, `ResolverInput`, `ResolverTimeoutError`, `ResolverRuntimeError`, `ResolverCompileError`, `DEFAULT_DYNAMIC_TIMEOUT_MS` (Task 1); `DYNAMIC_SCENARIO` (Task 5); `isScenarioDeclared` (existing); `DynamicOwnerType` (Task 2).
- Produces (new `RouterDeps` fields):
  - `getCompiledResolver: (systemSlug: string, endpointName: string) => CompiledResolver | null`
  - `getDynamicHistory: (ownerType: DynamicOwnerType, ownerKey: string, endpointName: string) => Promise<string[]>`
  - `appendDynamicHistory: (ownerType: DynamicOwnerType, ownerKey: string, endpointName: string, slug: string) => Promise<void>`
  - `dynamicResolverTimeoutMs?: number`

- [ ] **Step 1: Write failing tests**

In `tests/router/route-request.test.ts`:

1. Add an endpoint to `CATALOG` (inside the `endpoints` array):

```ts
        {
          name: 'dynamic_ep',
          displayName: 'Dynamic Ep',
          method: 'POST',
          path: '/dynamic-ep',
          profileIdSelector: '$.customerId',
          scenarios: { default: 'Success', failure: 'Failure' },
          hasResolver: true,
        },
```

2. Ensure fixtures exist: create `tests/testdata/fixtures/test-system/dynamic_ep/default.json` and `.../failure.json` (copy the shape of the existing `hello_world` fixtures — `{ "status": 200, "body": { ... } }` and a failure body).

3. Extend the `deps(...)` factory defaults (after `advanceScenarioProgress`):

```ts
    getCompiledResolver: () => null,
    getDynamicHistory: async () => [],
    appendDynamicHistory: async () => {},
```

4. Add tests:

```ts
import { ResolverRuntimeError } from '../../src/lib/mock-engine/resolver'

describe('dynamic resolver', () => {
  it('runs the resolver, serves the returned fixture, and records history', async () => {
    const appended: string[] = []
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({ invoke: (i) => (i.history.length === 0 ? 'failure' : 'default') }),
      getDynamicHistory: async () => [],
      appendDynamicHistory: async (_t, _k, _e, slug) => {
        appended.push(slug)
      },
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(422) // failure.json status — adjust to your fixture
    expect(trace.scenarioSource).toBe('dynamic')
    expect(trace.dynamic).toEqual({ returned: 'failure' })
    expect(trace.scenario).toBe('failure')
    expect(appended).toEqual(['failure'])
  })

  it('returning "real" triggers passthrough', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({ invoke: () => 'real' }),
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(d.passthroughCalls).toHaveLength(1)
    expect(trace.outcome).toBe('passthrough')
    expect(trace.dynamic).toEqual({ returned: 'real' })
  })

  it('500s when the pin is dynamic but there is no resolver (drift)', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => null,
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('dynamic_resolver_missing')
  })

  it('500s on a bad return value and records nothing', async () => {
    const appended: string[] = []
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({ invoke: () => 'nonexistent' }),
      appendDynamicHistory: async (_t, _k, _e, slug) => {
        appended.push(slug)
      },
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('dynamic_bad_return')
    expect(appended).toEqual([])
  })

  it('500s when the resolver throws', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({
        invoke: () => {
          throw new ResolverRuntimeError('boom')
        },
      }),
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('dynamic_threw')
  })
})
```

> Adjust the expected status codes to whatever your `dynamic_ep` fixtures declare. Each test fakes the compiled resolver inline as `{ invoke: (input) => <slug> }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/router/route-request.test.ts`
Expected: FAIL — dynamic not handled; `trace.scenarioSource` is `pin`, not `dynamic`.

- [ ] **Step 3: Add imports and `RouterDeps` fields**

In `src/lib/router/route-request.ts`, add imports:

```ts
import type { DynamicOwnerType } from '../dynamic/history-store'
import {
  DEFAULT_DYNAMIC_TIMEOUT_MS,
  ResolverRuntimeError,
  ResolverTimeoutError,
  type CompiledResolver,
  type ResolverInput,
} from '../mock-engine/resolver'
import { DEFAULT_SCENARIO, DYNAMIC_SCENARIO, implicitScenario, isScenarioDeclared, REAL_SCENARIO } from '../scenarios'
```

(Merge the `../scenarios` import with the existing one — it currently imports `DEFAULT_SCENARIO, implicitScenario, REAL_SCENARIO`.)

Add to `RouterDeps`:

```ts
  getCompiledResolver: (systemSlug: string, endpointName: string) => CompiledResolver | null
  getDynamicHistory: (
    ownerType: DynamicOwnerType,
    ownerKey: string,
    endpointName: string,
  ) => Promise<string[]>
  appendDynamicHistory: (
    ownerType: DynamicOwnerType,
    ownerKey: string,
    endpointName: string,
    slug: string,
  ) => Promise<void>
  dynamicResolverTimeoutMs?: number
```

- [ ] **Step 4: Insert the dynamic resolution step**

In `routeRequest`, immediately **before** `if (scenario === REAL_SCENARIO) {` (line 154), insert:

```ts
  if (scenario === DYNAMIC_SCENARIO) {
    const resolved = await resolveDynamic(system, endpoint, profileId, ctx, deps, trace)
    if (!resolved.ok) return resolved.result
    scenario = resolved.scenario
    trace.scenario = scenario
    trace.scenarioSource = 'dynamic'
    trace.dynamic = { returned: scenario }
  }
```

Add the helper (near `resolveScenarioSelection`):

```ts
async function resolveDynamic(
  system: SystemDef,
  endpoint: EndpointDef,
  profileId: string | null,
  ctx: RequestContext,
  deps: RouterDeps,
  trace: RouteTrace,
): Promise<{ ok: true; scenario: string } | { ok: false; result: RouteResult }> {
  const compiled = deps.getCompiledResolver(system.slug, endpoint.name)
  if (!compiled) {
    traceError(
      trace,
      'dynamic_resolver_missing',
      `dynamic scenario selected but endpoint "${endpoint.name}" has no _dynamic.ts`,
    )
    return { ok: false, result: jsonResult(500, {
      error: 'dynamic scenario selected but no _dynamic.ts resolver is present',
      endpoint: endpoint.name,
    }) }
  }

  const ownerType: DynamicOwnerType = profileId ? 'profile' : 'global'
  const ownerKey = profileId ?? system.slug
  const history = await deps.getDynamicHistory(ownerType, ownerKey, endpoint.name)
  const input: ResolverInput = {
    request: {
      method: endpoint.method,
      path: endpoint.path,
      pathParams: ctx.pathParams,
      query: queryToRecord(ctx.query),
      headers: ctx.headers,
      body: ctx.body,
    },
    history,
    profileId,
  }

  let returned: unknown
  try {
    returned = compiled.invoke(input, deps.dynamicResolverTimeoutMs ?? DEFAULT_DYNAMIC_TIMEOUT_MS)
  } catch (err) {
    if (err instanceof ResolverTimeoutError) {
      traceError(trace, 'dynamic_timeout', err.message)
    } else if (err instanceof ResolverRuntimeError) {
      traceError(trace, 'dynamic_threw', err.message)
    } else {
      traceError(trace, 'dynamic_threw', err instanceof Error ? err.message : String(err))
    }
    return { ok: false, result: jsonResult(500, { error: 'dynamic resolver failed', endpoint: endpoint.name }) }
  }

  if (typeof returned !== 'string' || returned === DYNAMIC_SCENARIO || !isScenarioDeclared(endpoint, returned)) {
    traceError(
      trace,
      'dynamic_bad_return',
      `_dynamic.ts returned an invalid scenario: ${JSON.stringify(returned)}`,
    )
    return { ok: false, result: jsonResult(500, {
      error: 'dynamic resolver returned an undeclared scenario',
      endpoint: endpoint.name,
      returned,
    }) }
  }

  await deps.appendDynamicHistory(ownerType, ownerKey, endpoint.name, returned)
  return { ok: true, scenario: returned }
}

function queryToRecord(query: URLSearchParams): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const key of new Set(query.keys())) out[key] = query.getAll(key)
  return out
}
```

> `request.method` uses `endpoint.method` (the matched verb) because `RequestContext` (`ctx`) does not carry the raw HTTP method — only `body`, `pathParams`, `query`, `headers`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/router/route-request.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/router/route-request.ts tests/router/route-request.test.ts tests/testdata/fixtures/test-system/dynamic_ep
git commit -m "feat: run _dynamic.ts resolver and rewrite scenario slug in the router"
```

---

## Task 9: Wire the new deps in the app route

**Files:**
- Modify: `src/app/[...path]/route.ts`
- Test: `tests/router/handler.e2e.test.ts` (extend if it exercises real deps; otherwise a smoke check)

**Interfaces:**
- Consumes: `getCompiledResolver`/`dynamicHistoryLimit` from `getRuntime()` (Task 7); `getDynamicHistory`/`appendDynamicHistory` (Task 2).

- [ ] **Step 1: Wire deps**

In `src/app/[...path]/route.ts`, add imports:

```ts
import { appendDynamicHistory, getDynamicHistory } from '../../lib/dynamic/history-store'
```

In the `createMockHandler({ ... })` object, add:

```ts
    getCompiledResolver: (systemSlug, endpointName) => rt.getCompiledResolver(systemSlug, endpointName),
    getDynamicHistory: async (ownerType, ownerKey, endpointName) =>
      getDynamicHistory(await getDb(), ownerType, ownerKey, endpointName),
    appendDynamicHistory: async (ownerType, ownerKey, endpointName, slug) =>
      appendDynamicHistory(await getDb(), ownerType, ownerKey, endpointName, slug, rt.dynamicHistoryLimit),
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (all `RouterDeps` required fields now provided).

- [ ] **Step 3: End-to-end verification**

Run the full suite: `npx vitest run`
Expected: PASS. If `tests/router/handler.e2e.test.ts` builds deps from real stores, add a dynamic-endpoint case there mirroring Task 8; otherwise the router unit tests already cover behavior and this task is pure wiring.

- [ ] **Step 4: Commit**

```bash
git add src/app/[...path]/route.ts tests/router/handler.e2e.test.ts
git commit -m "feat: wire dynamic resolver and history store into the mock route"
```

---

## Task 10: Catalog UI — `dynamic` scenario card

**Files:**
- Modify: `src/app/ui/catalog/scenario-view.ts`
- Modify: `src/app/ui/catalog/EndpointScenarios.tsx`
- Test: `tests/ui/scenario-view.test.ts`

**Interfaces:**
- Produces: `ScenarioView` union gains `{ kind: 'dynamic' }`; a synthetic `dynamic` view is appended when `endpoint.hasResolver`.

- [ ] **Step 1: Write failing test**

In `tests/ui/scenario-view.test.ts`, add:

```ts
it('includes a dynamic view when the endpoint has a resolver', () => {
  const views = buildScenarioViews(
    system, // a SystemDef with an endpoint that has hasResolver: true
    { ...endpoint, hasResolver: true },
    catalogDir,
    {},
    false,
  )
  const dyn = views.find((v) => v.key === 'dynamic')
  expect(dyn?.kind).toBe('dynamic')
})
```

> Reuse the `system`/`endpoint`/`catalogDir` fixtures already set up in that test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/scenario-view.test.ts`
Expected: FAIL — no `dynamic` view.

- [ ] **Step 3: Implement in `src/app/ui/catalog/scenario-view.ts`**

Extend the `ScenarioView` union (add a variant):

```ts
  | { kind: 'dynamic' }
```

Import the label constant:

```ts
import { DYNAMIC_LABEL } from '../../../lib/scenarios'
```

Before the final `return` in `buildScenarioViews`, add the dynamic view when present:

```ts
  const dynamic: ScenarioView[] = endpoint.hasResolver
    ? [{ key: 'dynamic', label: DYNAMIC_LABEL, isDefault: false, kind: 'dynamic' }]
    : []
```

Update the return to include it (place `dynamic` just before `passthrough`):

```ts
  return passthroughAsDefault
    ? [passthrough, ...declared, ...dynamic]
    : [...declared, ...dynamic, passthrough]
```

- [ ] **Step 4: Render the dynamic card in `EndpointScenarios.tsx`**

In `ScenarioContent` (line 95), add a branch before the `error` check:

```tsx
  if (scenario.kind === 'dynamic') {
    return (
      <p className={styles.passthrough}>
        Resolved at request time by <code>_dynamic.ts</code> — returns a scenario slug per request.
      </p>
    )
  }
```

Also guard the `status` computation (line 55) so it only runs for fixtures (it already checks `scenario.kind === 'fixture'`, so no change needed).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/ui/scenario-view.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/ui/catalog/scenario-view.ts src/app/ui/catalog/EndpointScenarios.tsx tests/ui/scenario-view.test.ts
git commit -m "feat: show a dynamic scenario card on the catalog endpoint page"
```

---

## Task 11: Dangling-pin display (generic)

**Files:**
- Modify: `src/app/components/ScenarioPicker.tsx`
- Modify: `src/app/ui/profiles/ScenarioConfig.tsx`
- Modify: `src/app/ui/global-mocks/GlobalMocksForm.tsx`
- Modify: `src/lib/scenarios.ts` (reuse `danglingScenarioLabel` from Task 5)
- Test: `tests/lib/scenarios.test.ts` (helper already tested in Task 5) + a component-free unit test for the merge helper

**Interfaces:**
- Produces: `function scenarioOptionsWithDangling(offered: Record<string, string>, selection: string | string[] | undefined): { options: Record<string, string>; unavailable: string[] }` in `src/lib/scenarios.ts`.

- [ ] **Step 1: Write failing test**

In `tests/lib/scenarios.test.ts`, add:

```ts
import { scenarioOptionsWithDangling } from '../../src/lib/scenarios'

describe('scenarioOptionsWithDangling', () => {
  const offered = { default: 'Default', real: 'Passthrough' }

  it('leaves options untouched when the selection is offered', () => {
    const r = scenarioOptionsWithDangling(offered, 'default')
    expect(r.options).toEqual(offered)
    expect(r.unavailable).toEqual([])
  })

  it('adds a dangling entry for a missing single selection', () => {
    const r = scenarioOptionsWithDangling(offered, 'dynamic')
    expect(r.options.dynamic).toBe('Dynamic — unavailable (no _dynamic.ts)')
    expect(r.unavailable).toEqual(['dynamic'])
  })

  it('adds dangling entries for missing sequence steps', () => {
    const r = scenarioOptionsWithDangling(offered, ['default', 'gone', 'dynamic'])
    expect(r.unavailable.sort()).toEqual(['dynamic', 'gone'])
    expect(r.options.gone).toBe('gone — unavailable')
  })

  it('ignores an undefined selection', () => {
    expect(scenarioOptionsWithDangling(offered, undefined).unavailable).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/scenarios.test.ts`
Expected: FAIL — `scenarioOptionsWithDangling` undefined.

- [ ] **Step 3: Implement the merge helper in `src/lib/scenarios.ts`**

```ts
export function scenarioOptionsWithDangling(
  offered: Record<string, string>,
  selection: string | string[] | undefined,
): { options: Record<string, string>; unavailable: string[] } {
  const selected = selection === undefined ? [] : Array.isArray(selection) ? selection : [selection]
  const options = { ...offered }
  const unavailable: string[] = []
  for (const slug of selected) {
    if (slug in options || unavailable.includes(slug)) continue
    options[slug] = danglingScenarioLabel(slug)
    unavailable.push(slug)
  }
  return { options, unavailable }
}
```

- [ ] **Step 4: Render dangling entries as disabled radios in `ScenarioPicker.tsx`**

Add an optional `unavailable` prop and disable those radios:

```tsx
export function ScenarioPicker({
  endpointName,
  fieldName,
  scenarios,
  selected,
  unavailable,
}: {
  endpointName: string
  fieldName?: string
  scenarios: Record<string, string>
  selected: string
  unavailable?: string[]
}) {
  const isUnavailable = (key: string) => unavailable?.includes(key) ?? false
  return (
    <div className={styles.group}>
      {Object.entries(scenarios).map(([key, label]) => (
        <label
          key={key}
          className={`${scenarioClassName(key)}${isUnavailable(key) ? ` ${styles.unavailable}` : ''}`}
        >
          <input
            type="radio"
            name={fieldName ?? `scenario:${endpointName}`}
            value={key}
            defaultChecked={key === selected}
            disabled={isUnavailable(key)}
            className={styles.input}
          />
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>{label}</span>
        </label>
      ))}
    </div>
  )
}
```

Add a `.unavailable` rule to `src/app/components/ScenarioPicker.module.css` (muted/struck style):

```css
.unavailable { opacity: 0.55; }
.unavailable .label { text-decoration: line-through; }
```

- [ ] **Step 5: Feed dangling options from `ScenarioConfig.tsx`**

In `ScenarioConfig`, compute merged options once (top of the component body):

```ts
  const { options, unavailable } = scenarioOptionsWithDangling(scenarios, selection)
```

Import it:

```ts
import { scenarioOptionsWithDangling } from '../../../lib/scenarios'
```

Pass `options`/`unavailable` into the single-mode `ScenarioPicker` (replace `scenarios={scenarios}`):

```tsx
<ScenarioPicker
  endpointName={endpointName}
  scenarios={options}
  selected={singleValue}
  unavailable={unavailable}
/>
```

For the sequence-mode `ScenarioSelect`, pass `options` instead of `scenarios` so a dangling step still shows a readable label (`ScenarioSelect` already falls back to the key, but the merged label is clearer). Change `scenarios={scenarios}` at the `ScenarioSelect` call site (line 169) to `scenarios={options}`.

- [ ] **Step 6: Feed dangling options from `GlobalMocksForm.tsx`**

At the `ScenarioPicker` call site (line ~89), replace the direct `scenarios={scenariosWithPassthrough(endpoint, passthroughAsDefault)}` with a merged version. Just above the JSX for each endpoint, compute:

```tsx
const offered = scenariosWithPassthrough(endpoint, passthroughAsDefault)
const { options, unavailable } = scenarioOptionsWithDangling(offered, currentSelection)
```

where `currentSelection` is the saved global scenario string for this endpoint (the value the form already uses for `selected`). Then:

```tsx
<ScenarioPicker
  endpointName={endpoint.name}
  scenarios={options}
  selected={currentSelection ?? fallback}
  unavailable={unavailable}
/>
```

Import `scenarioOptionsWithDangling` in that file.

- [ ] **Step 7: Run tests and type-check**

Run: `npx vitest run tests/lib/scenarios.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/scenarios.ts src/app/components/ScenarioPicker.tsx src/app/components/ScenarioPicker.module.css src/app/ui/profiles/ScenarioConfig.tsx src/app/ui/global-mocks/GlobalMocksForm.tsx tests/lib/scenarios.test.ts
git commit -m "feat: show dangling scenario pins as disabled unavailable options"
```

---

## Task 12: Dynamic-history reset action + button

**Files:**
- Modify: `src/lib/dynamic/history-store.ts` (already has `resetDynamicHistory` from Task 2 — no change)
- Modify: `src/app/ui/profiles/actions.ts`
- Modify: `src/app/ui/profiles/ScenarioConfig.tsx`
- Test: `tests/profiles/actions.test.ts`

**Interfaces:**
- Produces: `resetDynamicHistoryAction(endpointName: string, formData: FormData): Promise<void>`.
- Consumes: `resetDynamicHistory` (Task 2).

- [ ] **Step 1: Write failing test**

In `tests/profiles/actions.test.ts`, mirror the existing `resetScenarioProgressAction` test: call `resetDynamicHistoryAction('ep', formData)` with a `profileId`, and assert the `dynamicHistory` docs for `('profile', profileId, 'ep')` are gone. Follow that file's existing DB setup and mocking of `getDb`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profiles/actions.test.ts`
Expected: FAIL — `resetDynamicHistoryAction` undefined.

- [ ] **Step 3: Implement the action**

In `src/app/ui/profiles/actions.ts`, add the import:

```ts
import { resetDynamicHistory } from '../../../lib/dynamic/history-store'
```

Add the action (mirrors `resetScenarioProgressAction`):

```ts
export async function resetDynamicHistoryAction(
  endpointName: string,
  formData: FormData,
): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim()
  if (!profileId || !endpointName) throw new Error('profileId and endpoint are required')

  await resetDynamicHistory(await getDb(), 'profile', profileId, endpointName)
  await writeAdminLog(profileId, 'progress_reset', endpointName)
  revalidatePath(`/ui/profiles/${encodeURIComponent(profileId)}`)
}
```

- [ ] **Step 4: Add the reset button when `dynamic` is selected**

In `src/app/ui/profiles/ScenarioConfig.tsx`, accept an optional `resetDynamicAction` prop of the same shape as `resetAction`, and render a "Reset dynamic history" button in single mode when `singleValue === 'dynamic'` and `resetDynamicAction` is provided. Place it under the `ScenarioPicker`:

```tsx
{mode === 'single' && singleValue === 'dynamic' && resetDynamicAction && (
  <div className={styles.sequenceFooter}>
    <button formAction={resetDynamicAction} className={styles.resetButton}>
      <RotateCcw className={styles.stepButtonIcon} aria-hidden="true" />
      Reset dynamic history
    </button>
  </div>
)}
```

The profile page that renders `ScenarioConfig` (the caller passing `resetAction`) must bind `resetDynamicHistoryAction.bind(null, endpointName)` and pass it as `resetDynamicAction`, exactly as it already binds `resetScenarioProgressAction`. Update that call site to pass the new prop.

> Global-endpoint reset uses the identical mechanism: `resetDynamicHistory(db, 'global', systemSlug, endpointName)`. Wire a `resetDynamicHistoryAction`-equivalent in `src/app/ui/global-mocks/actions.ts` and a button in `GlobalMocksForm.tsx` following the same pattern if/when the global-mocks page grows per-endpoint action buttons; the store function already supports it.

- [ ] **Step 5: Run tests and type-check**

Run: `npx vitest run tests/profiles/actions.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/ui/profiles/actions.ts src/app/ui/profiles/ScenarioConfig.tsx tests/profiles/actions.test.ts
git commit -m "feat: add reset-dynamic-history action and button on the profile page"
```

---

## Task 13: Full suite, lint, and a manual smoke test

**Files:** none (verification)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Lint and type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual smoke test (documented, run locally with Mongo available)**

1. In `catalog/hello-system/customer_status/`, add `_dynamic.ts`:

```ts
export default (input: { history: string[] }) =>
  input.history.length < 1 ? 'frozen' : 'default'
```

2. Start the app (`npm run dev`), open the endpoint page — confirm a **Dynamic** scenario card appears.
3. Create/edit a profile for that endpoint, select **Dynamic**, save.
4. `curl` the endpoint twice with the profile's customer id; confirm the first call serves `frozen`, the second `default`.
5. Check the logs UI: the request log shows `source=dynamic` and the resolved scenario.
6. Delete `_dynamic.ts`, restart, `curl` again → 500 with `dynamic_resolver_missing`.
7. Remove the `_dynamic.ts` test file before finishing (or keep it as a documented example if desired).

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore: dynamic resolver end-to-end verification"
```

---

## Documentation follow-up (separate, consent-gated)

Per `AGENTS.md`, this feature is guide-affecting. After implementation, **ask the user** before updating these `docs/site/` pages, then run
`docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`:

- `index.md` (catalog tree: new `_dynamic.ts`)
- `guide/reference/scenarios.md` (the `dynamic` scenario + resolver contract)
- `guide/reference/endpoints.md` (`_dynamic.ts` file)
- `guide/reference/configuration.md` (`DYNAMIC_HISTORY_LIMIT`)
- `guide/reference/request-logs.md` (`scenarioSource: dynamic` + resolved slug)
- `request-lifecycle.md` (the dynamic resolution step)
- optionally a new `guide/reference/dynamic.md`

This is intentionally **not** a task above — the guide is updated only on explicit consent.
