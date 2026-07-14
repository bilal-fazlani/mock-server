# `/ui/api` Runtime-Control API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an unauthenticated JSON API under `/ui/api/*` that lets an automated client discover the catalog, switch global-mock scenarios, manage profiles, reset progress, and read request logs — so an agent can arrange → run → assert → restore against the mock server.

**Architecture:** New Next.js route handlers (`route.ts`) under `src/app/ui/api/`, each delegating directly to the existing `src/lib/profiles/store.ts` and `src/lib/dynamic/history-store.ts` functions the UI server actions already use — skipping the `FormData`/`redirect`/`revalidatePath` machinery that is UI-only. Two pure/shared helpers are extracted first (a JSON scenario validator and an admin-log writer) so the handlers stay thin.

**Tech Stack:** TypeScript, Next.js 16 (App Router route handlers), MongoDB (`mongodb` driver), Vitest + `mongodb-memory-server`.

## Global Constraints

- All new routes live under `/ui/api/*` — mocks serve at root `/…`, so any other prefix collides with a mocked API.
- No authentication on any route.
- No mock authoring (no create/edit of endpoints, fixtures, or catalog files) — runtime control only.
- Error bodies are JSON `{ "error": "<message>" }`. Status codes: `400` validation, `404` not-found, `200` reads / `PUT` upserts returning a body, `204` `DELETE` and `POST /reset`.
- `endpointScenarios` values are `ScenarioSelection` = `string | string[]` (a single scenario key, or an ordered sequence served call-by-call).
- Follow existing test conventions: unit-mock the store + runtime for handler tests (as `tests/global-mocks/actions.test.ts` does); use `mongodb-memory-server` for tests that exercise real DB writes (as `tests/profiles/store.test.ts` does).
- Route handlers set `export const dynamic = 'force-dynamic'` (matching the existing logs routes).
- Node relative-import depth from a route file to `src/lib`: count the directory segments after `src/` and use that many `../`. Verified examples in this plan: `catalog/route.ts` → `../../../../lib`; `global-mocks/[system]/[endpoint]/route.ts` → `../../../../../../lib`; `profiles/[profileId]/route.ts` → `../../../../../lib`; `profiles/[profileId]/reset/route.ts` → `../../../../../../lib`.

---

## Task 1: JSON scenario-selection validator

A pure function mirroring `parseEndpointScenarios` in `src/lib/profiles/form.ts`, but reading a plain JSON object instead of `FormData`. Used by the profiles `PUT` route (Task 5).

**Files:**
- Create: `src/lib/profiles/api-scenarios.ts`
- Test: `tests/profiles/api-scenarios.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `EndpointDef` from `../catalog/types`; `isScenarioDeclared` from `../scenarios`; `ScenarioSelection` from `./store`.
- Produces:
  - `class InvalidScenarioSelectionError extends Error`
  - `parseEndpointScenariosFromJson(input: unknown, catalog: Catalog, implicit: string): Record<string, ScenarioSelection>` — validates and normalizes; throws `InvalidScenarioSelectionError` on any bad input. Delta-save semantics: values equal to `implicit` are dropped; a one-step sequence collapses to a single selection; an empty sequence is dropped.

- [ ] **Step 1: Write the failing test**

Create `tests/profiles/api-scenarios.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import {
  InvalidScenarioSelectionError,
  parseEndpointScenariosFromJson,
} from '../../src/lib/profiles/api-scenarios'

const catalog: Catalog = {
  systems: [
    {
      name: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [
        {
          name: 'hello_world',
          displayName: 'Hello World',
          method: 'POST',
          path: '/hello/world',
          profileIdSelector: '$.customerId',
          scenarios: { default: 'Success', failure: 'Failure', slow: 'Slow' },
        },
      ],
    },
  ],
}

describe('parseEndpointScenariosFromJson', () => {
  it('keeps an explicit non-implicit single selection', () => {
    const out = parseEndpointScenariosFromJson({ hello_world: 'failure' }, catalog, 'default')
    expect(out).toEqual({ hello_world: 'failure' })
  })

  it('drops a selection equal to the implicit scenario (delta save)', () => {
    const out = parseEndpointScenariosFromJson({ hello_world: 'default' }, catalog, 'default')
    expect(out).toEqual({})
  })

  it('keeps a multi-step sequence and collapses a one-step sequence', () => {
    expect(
      parseEndpointScenariosFromJson({ hello_world: ['failure', 'slow'] }, catalog, 'default'),
    ).toEqual({ hello_world: ['failure', 'slow'] })
    expect(
      parseEndpointScenariosFromJson({ hello_world: ['failure'] }, catalog, 'default'),
    ).toEqual({ hello_world: 'failure' })
  })

  it('accepts the implicit "real" passthrough as a declared selection', () => {
    expect(
      parseEndpointScenariosFromJson({ hello_world: 'real' }, catalog, 'default'),
    ).toEqual({ hello_world: 'real' })
  })

  it('rejects a non-object input', () => {
    expect(() => parseEndpointScenariosFromJson([], catalog, 'default')).toThrow(
      InvalidScenarioSelectionError,
    )
  })

  it('rejects an unknown endpoint name', () => {
    expect(() => parseEndpointScenariosFromJson({ ghost: 'default' }, catalog, 'default')).toThrow(
      /unknown endpoint "ghost"/,
    )
  })

  it('rejects an undeclared scenario', () => {
    expect(() =>
      parseEndpointScenariosFromJson({ hello_world: 'nope' }, catalog, 'default'),
    ).toThrow(/not declared/)
  })

  it('rejects a sequence with a non-string step', () => {
    expect(() =>
      parseEndpointScenariosFromJson({ hello_world: ['failure', 3] }, catalog, 'default'),
    ).toThrow(InvalidScenarioSelectionError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/profiles/api-scenarios.test.ts`
Expected: FAIL — cannot find module `../../src/lib/profiles/api-scenarios`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/profiles/api-scenarios.ts`:

```ts
import type { Catalog, EndpointDef } from '../catalog/types'
import { isScenarioDeclared } from '../scenarios'
import type { ScenarioSelection } from './store'

export class InvalidScenarioSelectionError extends Error {}

/**
 * JSON-body counterpart to parseEndpointScenarios (form.ts). Validates every
 * endpoint name and scenario key against the catalog and applies the same
 * delta-save normalization: selections equal to the implicit scenario are
 * dropped, and a one-step sequence collapses to a single selection.
 */
export function parseEndpointScenariosFromJson(
  input: unknown,
  catalog: Catalog,
  implicit: string,
): Record<string, ScenarioSelection> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidScenarioSelectionError('endpointScenarios must be an object')
  }

  const byName = new Map<string, EndpointDef>()
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) byName.set(endpoint.name, endpoint)
  }

  const result: Record<string, ScenarioSelection> = {}
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    const endpoint = byName.get(name)
    if (!endpoint) throw new InvalidScenarioSelectionError(`unknown endpoint "${name}"`)
    const selection = normalizeSelection(endpoint, raw, implicit)
    if (selection !== undefined) result[name] = selection
  }
  return result
}

function normalizeSelection(
  endpoint: EndpointDef,
  raw: unknown,
  implicit: string,
): ScenarioSelection | undefined {
  if (Array.isArray(raw)) {
    if (!raw.every((step) => typeof step === 'string')) {
      throw new InvalidScenarioSelectionError(
        `endpoint "${endpoint.name}": scenario sequence must be an array of strings`,
      )
    }
    for (const step of raw) assertDeclared(endpoint, step)
    if (raw.length === 0) return undefined
    if (raw.length > 1) return raw
    return raw[0] === implicit ? undefined : raw[0]
  }
  if (typeof raw !== 'string') {
    throw new InvalidScenarioSelectionError(
      `endpoint "${endpoint.name}": scenario must be a string or array of strings`,
    )
  }
  if (raw === '' || raw === implicit) return undefined
  assertDeclared(endpoint, raw)
  return raw
}

function assertDeclared(endpoint: EndpointDef, scenario: string): void {
  if (!isScenarioDeclared(endpoint, scenario)) {
    throw new InvalidScenarioSelectionError(
      `endpoint "${endpoint.name}": scenario "${scenario}" is not declared`,
    )
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/profiles/api-scenarios.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/profiles/api-scenarios.ts tests/profiles/api-scenarios.test.ts
git commit -m "feat(api): JSON scenario-selection validator

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared admin-log helper

Extract the admin-log writer currently private to `src/app/ui/profiles/actions.ts` into a shared lib module so both the UI actions and the new API routes write identical `admin` log entries.

**Files:**
- Create: `src/lib/logs/admin-log.ts`
- Modify: `src/app/ui/profiles/actions.ts` (remove the private `writeAdminLog`, import the shared one, pass `db`)
- Test: `tests/logs/admin-log.test.ts`

**Interfaces:**
- Consumes: `insertLogEntry`, `newLogId` from `./store`; `Db` from `mongodb`.
- Produces: `writeAdminLog(db: Db, profileId: string, adminAction: 'profile_saved' | 'progress_reset', adminEndpoint?: string): Promise<void>` — inserts a `kind: 'admin'` log entry; swallows and warns on failure (never throws).

- [ ] **Step 1: Write the failing test**

Create `tests/logs/admin-log.test.ts`:

```ts
import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { writeAdminLog } from '../../src/lib/logs/admin-log'
import { listLogSummaries } from '../../src/lib/logs/store'
import { ensureIndexes } from '../../src/lib/profiles/store'

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
  await db.collection('requestLogs').deleteMany({})
})

describe('writeAdminLog', () => {
  it('writes an admin log entry with the action and endpoint', async () => {
    await writeAdminLog(db, 'p1', 'progress_reset', 'hello_world')
    const entries = await listLogSummaries(db, {})
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('admin')
    expect(entries[0].profileId).toBe('p1')
    expect(entries[0].trace.adminAction).toBe('progress_reset')
    expect(entries[0].trace.adminEndpoint).toBe('hello_world')
  })

  it('omits adminEndpoint when not provided', async () => {
    await writeAdminLog(db, 'p2', 'profile_saved')
    const entries = await listLogSummaries(db, {})
    expect(entries[0].trace.adminEndpoint).toBeUndefined()
  })

  it('never throws when the db write fails', async () => {
    await expect(
      writeAdminLog({} as unknown as Db, 'p3', 'profile_saved'),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/logs/admin-log.test.ts`
Expected: FAIL — cannot find module `../../src/lib/logs/admin-log`.

- [ ] **Step 3: Write the implementation and refactor the UI action**

Create `src/lib/logs/admin-log.ts`:

```ts
import type { Db } from 'mongodb'
import { insertLogEntry, newLogId } from './store'

/**
 * Records an admin action (profile save / progress reset) as a log entry so it
 * shows in the logs view, regardless of whether the UI or the /ui/api routes
 * drove the change. Failures are swallowed — an admin action must not fail
 * because logging failed.
 */
export async function writeAdminLog(
  db: Db,
  profileId: string,
  adminAction: 'profile_saved' | 'progress_reset',
  adminEndpoint?: string,
): Promise<void> {
  try {
    await insertLogEntry(db, {
      logId: newLogId(),
      ts: new Date(),
      kind: 'admin',
      profileId,
      trace: { adminAction, ...(adminEndpoint && { adminEndpoint }) },
    })
  } catch (err) {
    console.warn('[mock-log] failed to write admin log entry:', err)
  }
}
```

Modify `src/app/ui/profiles/actions.ts`:

1. Remove the local `async function writeAdminLog(...)` (lines 17–33) and its now-unused imports `insertLogEntry, newLogId` from `../../../lib/logs/store`.
2. Add import: `import { writeAdminLog } from '../../../lib/logs/admin-log'`.
3. Update the three call sites to pass the db handle:
   - in `saveProfile`: `await writeAdminLog(await getDb(), profileId, 'profile_saved')`
   - in `resetScenarioProgressAction`: `await writeAdminLog(await getDb(), profileId, 'progress_reset', endpointName)`
   - in `resetDynamicHistoryAction`: `await writeAdminLog(await getDb(), profileId, 'progress_reset', endpointName)`

   (Each of these functions already calls `getDb()` elsewhere; reuse a local `const db = await getDb()` if you prefer to avoid calling `getDb()` twice — but a second call is harmless since the client is cached.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/logs/admin-log.test.ts tests/profiles/actions.test.ts`
Expected: PASS. The existing `tests/profiles/actions.test.ts` still passes because it does not assert on admin-log behavior and the real `insertLogEntry` failure (against the mocked `{}` db) is swallowed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logs/admin-log.ts src/app/ui/profiles/actions.ts tests/logs/admin-log.test.ts
git commit -m "refactor(logs): extract shared writeAdminLog helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `GET /ui/api/catalog`

Read-only catalog projection for discovery — systems, endpoints, declared scenarios, `mockType`, `hasResolver`. No fixture bodies.

**Files:**
- Create: `src/app/ui/api/catalog/route.ts`
- Test: `tests/api/catalog-route.test.ts`

**Interfaces:**
- Consumes: `getRuntime` from `../../../../lib/runtime`; `Catalog` from `../../../../lib/catalog/types`.
- Produces: `GET(): Promise<Response>` returning `{ systems: [{ slug, name, baseUrlEnv, endpoints: [{ name, displayName, method, path, mockType, hasResolver, scenarios }] }] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/catalog-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

let passthroughAsDefault = false
vi.mock('../../src/lib/runtime', () => ({
  getRuntime: () => ({
    passthroughAsDefault,
    catalog: {
      systems: [
        {
          name: 'Hello System',
          slug: 'hello-system',
          baseUrlEnv: 'HELLO_SYSTEM_URL',
          endpoints: [
            {
              name: 'oauth_token',
              displayName: 'OAuth Token',
              method: 'POST',
              path: '/oauth/token',
              mockType: 'global',
              scenarios: { default: 'Token', expired: 'Expired' },
            },
            {
              name: 'profiled_endpoint',
              displayName: 'Profiled Endpoint',
              method: 'POST',
              path: '/profiled',
              profileIdSelector: '$.customerId',
              hasResolver: true,
              scenarios: { default: 'Success' },
            },
          ],
        },
      ],
    },
  }),
}))

const { GET } = await import('../../src/app/ui/api/catalog/route')

beforeEach(() => {
  passthroughAsDefault = false
})

describe('GET /ui/api/catalog', () => {
  it('projects systems and endpoints with mockType and hasResolver defaults', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.systems).toHaveLength(1)
    const [system] = body.systems
    expect(system.slug).toBe('hello-system')
    expect(system.endpoints[0]).toEqual({
      name: 'oauth_token',
      displayName: 'OAuth Token',
      method: 'POST',
      path: '/oauth/token',
      mockType: 'global',
      hasResolver: false,
      scenarios: { default: 'Token', expired: 'Expired' },
    })
    // mockType defaults to 'profiled', hasResolver preserved
    expect(system.endpoints[1].mockType).toBe('profiled')
    expect(system.endpoints[1].hasResolver).toBe(true)
  })

  it('does not leak fixture bodies', async () => {
    const res = await GET()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/catalog-route.test.ts`
Expected: FAIL — cannot find module `../../src/app/ui/api/catalog/route`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/ui/api/catalog/route.ts`:

```ts
import type { Catalog } from '../../../../lib/catalog/types'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const { catalog } = getRuntime()
  return Response.json(toCatalogView(catalog))
}

function toCatalogView(catalog: Catalog) {
  return {
    systems: catalog.systems.map((system) => ({
      slug: system.slug,
      name: system.name,
      baseUrlEnv: system.baseUrlEnv,
      endpoints: system.endpoints.map((endpoint) => ({
        name: endpoint.name,
        displayName: endpoint.displayName,
        method: endpoint.method,
        path: endpoint.path,
        mockType: endpoint.mockType ?? 'profiled',
        hasResolver: endpoint.hasResolver ?? false,
        scenarios: endpoint.scenarios,
      })),
    })),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/catalog-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/api/catalog/route.ts tests/api/catalog-route.test.ts
git commit -m "feat(api): GET /ui/api/catalog discovery endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Global-mocks routes (`GET` list, `PUT`, `DELETE`)

**Files:**
- Create: `src/app/ui/api/global-mocks/route.ts` (`GET` list)
- Create: `src/app/ui/api/global-mocks/[system]/[endpoint]/route.ts` (`PUT`, `DELETE`)
- Test: `tests/api/global-mocks-route.test.ts`

**Interfaces:**
- Consumes: `getRuntime` from runtime; `findEndpointBySlug` from catalog/find; `isScenarioDeclared` from scenarios; `getDb`, `listGlobalMockScenarios`, `upsertGlobalMockScenario`, `clearGlobalMockScenario` from profiles/store.
- Produces:
  - list route: `GET(): Promise<Response>` → `{ scenarios: GlobalMockScenario[] }`
  - detail route: `PUT(request: Request, ctx: { params: Promise<{ system: string; endpoint: string }> }): Promise<Response>`; `DELETE(request: Request, ctx: { params: Promise<{ system: string; endpoint: string }> }): Promise<Response>`

- [ ] **Step 1: Write the failing test**

Create `tests/api/global-mocks-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listGlobalMockScenariosMock = vi.fn()
const upsertGlobalMockScenarioMock = vi.fn()
const clearGlobalMockScenarioMock = vi.fn()

vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
  listGlobalMockScenarios: (...a: unknown[]) => listGlobalMockScenariosMock(...a),
  upsertGlobalMockScenario: (...a: unknown[]) => upsertGlobalMockScenarioMock(...a),
  clearGlobalMockScenario: (...a: unknown[]) => clearGlobalMockScenarioMock(...a),
}))

vi.mock('../../src/lib/runtime', () => ({
  getRuntime: () => ({
    passthroughAsDefault: false,
    catalog: {
      systems: [
        {
          name: 'Hello System',
          slug: 'hello-system',
          baseUrlEnv: 'HELLO_SYSTEM_URL',
          endpoints: [
            {
              name: 'oauth_token',
              displayName: 'OAuth Token',
              method: 'POST',
              path: '/oauth/token',
              mockType: 'global',
              scenarios: { default: 'Token', expired: 'Expired' },
            },
            {
              name: 'profiled_endpoint',
              displayName: 'Profiled Endpoint',
              method: 'POST',
              path: '/profiled',
              profileIdSelector: '$.customerId',
              scenarios: { default: 'Success' },
            },
          ],
        },
      ],
    },
  }),
}))

const listRoute = await import('../../src/app/ui/api/global-mocks/route')
const detailRoute = await import('../../src/app/ui/api/global-mocks/[system]/[endpoint]/route')

const params = (system: string, endpoint: string) => ({
  params: Promise.resolve({ system, endpoint }),
})
const putReq = (body: unknown) =>
  new Request('http://x/ui/api/global-mocks/hello-system/oauth_token', {
    method: 'PUT',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  listGlobalMockScenariosMock.mockReset()
  upsertGlobalMockScenarioMock.mockReset()
  clearGlobalMockScenarioMock.mockReset()
})

describe('GET /ui/api/global-mocks', () => {
  it('returns the stored overrides', async () => {
    listGlobalMockScenariosMock.mockResolvedValue([
      { system: 'hello-system', endpoint: 'oauth_token', scenario: 'expired' },
    ])
    const res = await listRoute.GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      scenarios: [{ system: 'hello-system', endpoint: 'oauth_token', scenario: 'expired' }],
    })
  })
})

describe('PUT /ui/api/global-mocks/{system}/{endpoint}', () => {
  it('sets a declared scenario on a global endpoint', async () => {
    const res = await detailRoute.PUT(putReq({ scenario: 'expired' }), params('hello-system', 'oauth_token'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'expired',
    })
    expect(upsertGlobalMockScenarioMock).toHaveBeenCalledWith(expect.anything(), {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'expired',
    })
  })

  it('404s for an unknown endpoint', async () => {
    const res = await detailRoute.PUT(putReq({ scenario: 'expired' }), params('hello-system', 'ghost'))
    expect(res.status).toBe(404)
    expect(upsertGlobalMockScenarioMock).not.toHaveBeenCalled()
  })

  it('400s for a non-global endpoint', async () => {
    const res = await detailRoute.PUT(
      putReq({ scenario: 'default' }),
      params('hello-system', 'profiled_endpoint'),
    )
    expect(res.status).toBe(400)
    expect(upsertGlobalMockScenarioMock).not.toHaveBeenCalled()
  })

  it('400s for an undeclared scenario', async () => {
    const res = await detailRoute.PUT(putReq({ scenario: 'nope' }), params('hello-system', 'oauth_token'))
    expect(res.status).toBe(400)
  })

  it('400s for a missing scenario field', async () => {
    const res = await detailRoute.PUT(putReq({}), params('hello-system', 'oauth_token'))
    expect(res.status).toBe(400)
  })

  it('400s for malformed JSON', async () => {
    const bad = new Request('http://x', { method: 'PUT', body: '{not json' })
    const res = await detailRoute.PUT(bad, params('hello-system', 'oauth_token'))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /ui/api/global-mocks/{system}/{endpoint}', () => {
  it('clears the override and returns 204', async () => {
    const res = await detailRoute.DELETE(new Request('http://x', { method: 'DELETE' }), params('hello-system', 'oauth_token'))
    expect(res.status).toBe(204)
    expect(clearGlobalMockScenarioMock).toHaveBeenCalledWith(expect.anything(), 'hello-system', 'oauth_token')
  })

  it('404s for an unknown endpoint', async () => {
    const res = await detailRoute.DELETE(new Request('http://x', { method: 'DELETE' }), params('hello-system', 'ghost'))
    expect(res.status).toBe(404)
    expect(clearGlobalMockScenarioMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/global-mocks-route.test.ts`
Expected: FAIL — cannot find the route modules.

- [ ] **Step 3: Write the implementations**

Create `src/app/ui/api/global-mocks/route.ts`:

```ts
import { getDb, listGlobalMockScenarios } from '../../../../lib/profiles/store'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const scenarios = await listGlobalMockScenarios(await getDb())
  return Response.json({ scenarios })
}
```

Create `src/app/ui/api/global-mocks/[system]/[endpoint]/route.ts`:

```ts
import { findEndpointBySlug } from '../../../../../../lib/catalog/find'
import {
  clearGlobalMockScenario,
  getDb,
  upsertGlobalMockScenario,
} from '../../../../../../lib/profiles/store'
import { getRuntime } from '../../../../../../lib/runtime'
import { isScenarioDeclared } from '../../../../../../lib/scenarios'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ system: string; endpoint: string }> }

export async function PUT(request: Request, { params }: Ctx): Promise<Response> {
  const { system, endpoint } = await params
  const found = findEndpointBySlug(getRuntime().catalog, system, endpoint)
  if (!found) {
    return Response.json({ error: `unknown endpoint ${system}/${endpoint}` }, { status: 404 })
  }
  if ((found.endpoint.mockType ?? 'profiled') !== 'global') {
    return Response.json(
      { error: `endpoint "${endpoint}" is not a global mock` },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'request body is not valid JSON' }, { status: 400 })
  }
  const scenario = (body as { scenario?: unknown } | null)?.scenario
  if (typeof scenario !== 'string' || scenario === '') {
    return Response.json({ error: 'scenario is required' }, { status: 400 })
  }
  if (!isScenarioDeclared(found.endpoint, scenario)) {
    return Response.json({ error: `scenario "${scenario}" is not declared` }, { status: 400 })
  }

  await upsertGlobalMockScenario(await getDb(), { system, endpoint, scenario })
  return Response.json({ system, endpoint, scenario })
}

export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { system, endpoint } = await params
  const found = findEndpointBySlug(getRuntime().catalog, system, endpoint)
  if (!found) {
    return Response.json({ error: `unknown endpoint ${system}/${endpoint}` }, { status: 404 })
  }
  await clearGlobalMockScenario(await getDb(), system, endpoint)
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/global-mocks-route.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/api/global-mocks tests/api/global-mocks-route.test.ts
git commit -m "feat(api): global-mocks list/set/clear routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Profile routes (`GET`, `PUT`, `DELETE`)

**Files:**
- Create: `src/app/ui/api/profiles/[profileId]/route.ts`
- Test: `tests/api/profiles-route.test.ts`

**Interfaces:**
- Consumes: `getRuntime` from runtime; `implicitScenario` from scenarios; `parseEndpointScenariosFromJson`, `InvalidScenarioSelectionError` from profiles/api-scenarios (Task 1); `writeAdminLog` from logs/admin-log (Task 2); `getDb`, `getProfile`, `upsertProfile`, `deleteProfile` from profiles/store.
- Produces: `GET`, `PUT`, `DELETE`, each `(request: Request, ctx: { params: Promise<{ profileId: string }> }): Promise<Response>`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/profiles-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfileMock = vi.fn()
const upsertProfileMock = vi.fn()
const deleteProfileMock = vi.fn()
const writeAdminLogMock = vi.fn()

vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  upsertProfile: (...a: unknown[]) => upsertProfileMock(...a),
  deleteProfile: (...a: unknown[]) => deleteProfileMock(...a),
}))
vi.mock('../../src/lib/logs/admin-log', () => ({
  writeAdminLog: (...a: unknown[]) => writeAdminLogMock(...a),
}))
vi.mock('../../src/lib/runtime', () => ({
  getRuntime: () => ({
    passthroughAsDefault: false,
    catalog: {
      systems: [
        {
          name: 'Hello System',
          slug: 'hello-system',
          baseUrlEnv: 'HELLO_SYSTEM_URL',
          endpoints: [
            {
              name: 'hello_world',
              displayName: 'Hello World',
              method: 'POST',
              path: '/hello/world',
              profileIdSelector: '$.customerId',
              scenarios: { default: 'Success', failure: 'Failure' },
            },
          ],
        },
      ],
    },
  }),
}))

const route = await import('../../src/app/ui/api/profiles/[profileId]/route')
const params = (profileId: string) => ({ params: Promise.resolve({ profileId }) })
const jsonReq = (method: string, body: unknown) =>
  new Request('http://x', { method, body: JSON.stringify(body) })

beforeEach(() => {
  getProfileMock.mockReset()
  upsertProfileMock.mockReset()
  deleteProfileMock.mockReset()
  writeAdminLogMock.mockReset()
})

describe('GET /ui/api/profiles/{id}', () => {
  it('returns the profile', async () => {
    getProfileMock.mockResolvedValue({ profileId: 'c1', endpointScenarios: {} })
    const res = await route.GET(new Request('http://x'), params('c1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ profileId: 'c1', endpointScenarios: {} })
  })

  it('404s when the profile is absent', async () => {
    getProfileMock.mockResolvedValue(null)
    const res = await route.GET(new Request('http://x'), params('missing'))
    expect(res.status).toBe(404)
  })
})

describe('PUT /ui/api/profiles/{id}', () => {
  it('upserts a validated profile, writes an admin log, and returns the stored profile', async () => {
    upsertProfileMock.mockResolvedValue(undefined)
    getProfileMock.mockResolvedValue({
      profileId: 'c1',
      displayName: 'run',
      endpointScenarios: { hello_world: 'failure' },
    })
    const res = await route.PUT(
      jsonReq('PUT', { displayName: 'run', endpointScenarios: { hello_world: 'failure' } }),
      params('c1'),
    )
    expect(res.status).toBe(200)
    expect(upsertProfileMock).toHaveBeenCalledWith(expect.anything(), {
      profileId: 'c1',
      displayName: 'run',
      endpointScenarios: { hello_world: 'failure' },
    })
    expect(writeAdminLogMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'profile_saved')
    expect((await res.json()).endpointScenarios).toEqual({ hello_world: 'failure' })
  })

  it('400s on an undeclared scenario', async () => {
    const res = await route.PUT(
      jsonReq('PUT', { endpointScenarios: { hello_world: 'ghost' } }),
      params('c1'),
    )
    expect(res.status).toBe(400)
    expect(upsertProfileMock).not.toHaveBeenCalled()
  })

  it('400s on an unknown endpoint', async () => {
    const res = await route.PUT(
      jsonReq('PUT', { endpointScenarios: { nope: 'default' } }),
      params('c1'),
    )
    expect(res.status).toBe(400)
  })

  it('400s on malformed JSON', async () => {
    const res = await route.PUT(new Request('http://x', { method: 'PUT', body: '{bad' }), params('c1'))
    expect(res.status).toBe(400)
  })

  it('treats a missing endpointScenarios as empty', async () => {
    upsertProfileMock.mockResolvedValue(undefined)
    getProfileMock.mockResolvedValue({ profileId: 'c1', endpointScenarios: {} })
    const res = await route.PUT(jsonReq('PUT', {}), params('c1'))
    expect(res.status).toBe(200)
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpointScenarios: {} }),
    )
  })
})

describe('DELETE /ui/api/profiles/{id}', () => {
  it('deletes and returns 204', async () => {
    deleteProfileMock.mockResolvedValue(undefined)
    const res = await route.DELETE(new Request('http://x', { method: 'DELETE' }), params('c1'))
    expect(res.status).toBe(204)
    expect(deleteProfileMock).toHaveBeenCalledWith(expect.anything(), 'c1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/profiles-route.test.ts`
Expected: FAIL — cannot find module `../../src/app/ui/api/profiles/[profileId]/route`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/ui/api/profiles/[profileId]/route.ts`:

```ts
import { writeAdminLog } from '../../../../../lib/logs/admin-log'
import {
  InvalidScenarioSelectionError,
  parseEndpointScenariosFromJson,
} from '../../../../../lib/profiles/api-scenarios'
import { deleteProfile, getDb, getProfile, upsertProfile } from '../../../../../lib/profiles/store'
import { getRuntime } from '../../../../../lib/runtime'
import { implicitScenario } from '../../../../../lib/scenarios'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ profileId: string }> }

export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params
  const profile = await getProfile(await getDb(), profileId)
  if (!profile) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json(profile)
}

export async function PUT(request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'request body is not valid JSON' }, { status: 400 })
  }
  const raw = body as { displayName?: unknown; endpointScenarios?: unknown } | null

  const { catalog, passthroughAsDefault } = getRuntime()
  const implicit = implicitScenario(passthroughAsDefault)

  let endpointScenarios
  try {
    endpointScenarios = parseEndpointScenariosFromJson(
      raw?.endpointScenarios ?? {},
      catalog,
      implicit,
    )
  } catch (err) {
    if (err instanceof InvalidScenarioSelectionError) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  const displayName =
    typeof raw?.displayName === 'string' && raw.displayName.trim() !== ''
      ? raw.displayName.trim()
      : undefined

  const db = await getDb()
  await upsertProfile(db, { profileId, displayName, endpointScenarios })
  await writeAdminLog(db, profileId, 'profile_saved')
  return Response.json(await getProfile(db, profileId))
}

export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params
  await deleteProfile(await getDb(), profileId)
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/profiles-route.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/api/profiles/[profileId]/route.ts tests/api/profiles-route.test.ts
git commit -m "feat(api): profile get/put/delete routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Profile reset route (`POST`)

Resets scenario-sequence progress and dynamic history for a profile, scoped to one endpoint if `endpoint` is supplied, else the whole profile.

**Files:**
- Create: `src/app/ui/api/profiles/[profileId]/reset/route.ts`
- Test: `tests/api/profiles-reset-route.test.ts`

**Interfaces:**
- Consumes: `getDb`, `resetScenarioProgress` from profiles/store; `resetDynamicHistory` from dynamic/history-store; `writeAdminLog` from logs/admin-log.
- Produces: `POST(request: Request, ctx: { params: Promise<{ profileId: string }> }): Promise<Response>`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/profiles-reset-route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resetScenarioProgressMock = vi.fn()
const resetDynamicHistoryMock = vi.fn()
const writeAdminLogMock = vi.fn()

vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
  resetScenarioProgress: (...a: unknown[]) => resetScenarioProgressMock(...a),
}))
vi.mock('../../src/lib/dynamic/history-store', () => ({
  resetDynamicHistory: (...a: unknown[]) => resetDynamicHistoryMock(...a),
}))
vi.mock('../../src/lib/logs/admin-log', () => ({
  writeAdminLog: (...a: unknown[]) => writeAdminLogMock(...a),
}))

const route = await import('../../src/app/ui/api/profiles/[profileId]/reset/route')
const params = (profileId: string) => ({ params: Promise.resolve({ profileId }) })

beforeEach(() => {
  resetScenarioProgressMock.mockReset()
  resetDynamicHistoryMock.mockReset()
  writeAdminLogMock.mockReset()
})

describe('POST /ui/api/profiles/{id}/reset', () => {
  it('resets a single endpoint when given one', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ endpoint: 'hello_world' }) })
    const res = await route.POST(req, params('c1'))
    expect(res.status).toBe(204)
    expect(resetScenarioProgressMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'hello_world')
    expect(resetDynamicHistoryMock).toHaveBeenCalledWith(expect.anything(), 'profile', 'c1', 'hello_world')
    expect(writeAdminLogMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'progress_reset', 'hello_world')
  })

  it('resets the whole profile when no endpoint and no body', async () => {
    const res = await route.POST(new Request('http://x', { method: 'POST' }), params('c1'))
    expect(res.status).toBe(204)
    expect(resetScenarioProgressMock).toHaveBeenCalledWith(expect.anything(), 'c1', undefined)
    expect(resetDynamicHistoryMock).toHaveBeenCalledWith(expect.anything(), 'profile', 'c1', undefined)
    expect(writeAdminLogMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'progress_reset', undefined)
  })

  it('treats malformed JSON as a whole-profile reset', async () => {
    const res = await route.POST(new Request('http://x', { method: 'POST', body: '{bad' }), params('c1'))
    expect(res.status).toBe(204)
    expect(resetScenarioProgressMock).toHaveBeenCalledWith(expect.anything(), 'c1', undefined)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/profiles-reset-route.test.ts`
Expected: FAIL — cannot find the reset route module.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/ui/api/profiles/[profileId]/reset/route.ts`:

```ts
import { resetDynamicHistory } from '../../../../../../lib/dynamic/history-store'
import { writeAdminLog } from '../../../../../../lib/logs/admin-log'
import { getDb, resetScenarioProgress } from '../../../../../../lib/profiles/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ profileId: string }> }

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params

  let endpoint: string | undefined
  try {
    const body = (await request.json()) as { endpoint?: unknown } | null
    if (typeof body?.endpoint === 'string' && body.endpoint !== '') endpoint = body.endpoint
  } catch {
    // No body / malformed JSON → whole-profile reset.
  }

  const db = await getDb()
  await resetScenarioProgress(db, profileId, endpoint)
  await resetDynamicHistory(db, 'profile', profileId, endpoint)
  await writeAdminLog(db, profileId, 'progress_reset', endpoint)
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/profiles-reset-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/api/profiles/[profileId]/reset/route.ts tests/api/profiles-reset-route.test.ts
git commit -m "feat(api): profile progress-reset route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all pre-existing tests plus the new `tests/api/*`, `tests/profiles/api-scenarios.test.ts`, and `tests/logs/admin-log.test.ts`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Type-check via build (optional but recommended)**

Run: `npx tsc --noEmit`
Expected: no type errors. (If the project has no standalone `tsc` script, `npm run build` also type-checks; skip if build is too slow for this checkpoint.)

- [ ] **Step 4: Manual smoke test (optional)**

Start the dev server (`npm run dev`), then from another shell:

```bash
curl -s localhost:3000/ui/api/catalog | head
curl -s -X PUT localhost:3000/ui/api/global-mocks/<system>/<endpoint> \
  -H 'content-type: application/json' -d '{"scenario":"<declared-scenario>"}'
curl -s 'localhost:3000/ui/api/logs?limit=5'
```

Expected: catalog JSON, a `{system,endpoint,scenario}` echo, and log summaries. Substitute a real `<system>/<endpoint>` with `mockType:"global"` from the catalog output.

---

## Documentation follow-up (do NOT do unprompted)

Per `AGENTS.md`, after the code lands, flag to the user that these guide pages now describe UI-only behavior that has a programmatic equivalent, and ask whether to update them:
- `docs/site/docs/guide/reference/scenarios.md`
- `docs/site/docs/guide/reference/profiles.md`
- `docs/site/docs/guide/reference/configuration.md` and `request-logs.md`

Only edit the guide on explicit consent, then run
`docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`.
