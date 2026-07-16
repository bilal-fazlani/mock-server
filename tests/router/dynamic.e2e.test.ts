import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../src/lib/catalog/load'
import { loadFixture } from '../../src/lib/mock-engine/fixtures'
import { compileResolver, resolverFilePath, type CompiledResolver } from '../../src/lib/mock-engine/resolver'
import type { MockProfile } from '../../src/lib/profiles/store'
import { createMockHandler } from '../../src/lib/router/handler'
import type { RouterDeps } from '../../src/lib/router/route-request'

const NOW = new Date('2026-07-02T00:00:00.000Z')

const tmpDirs: string[] = []

function tmpCatalogDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-dynamic-e2e-'))
  tmpDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

const SYSTEM_META = { name: 'Test System', baseUrlEnv: 'TEST_URL' }
const ENDPOINT_META = {
  displayName: 'Customer Status',
  method: 'GET',
  path: '/customers/{customerId}/status',
  profileIdSelector: 'path:customerId',
}
const DEFAULT_FIXTURE = { status: 200, body: { status: 'ACTIVE' } }
const FAILURE_FIXTURE = { status: 503, body: { status: 'DOWN' } }
// Stateful pure function: serves "failure" until the history already contains
// one entry, then flips to "default". This proves the resolver actually
// receives the accumulated history from a real (non-faked) history store.
const DYNAMIC_SOURCE = `export default (i) => i.history.length < 1 ? 'failure' : 'default'`

// Keyed by `${ownerType}|${ownerKey}|${endpointName}|${scenario}`, mirroring
// the real history-store's compound key, but backed by a plain in-memory
// array instead of Mongo -- this is the "real" collaborator under test here,
// not a fake that always returns a canned value.
function makeHistoryStore() {
  const store = new Map<string, string[]>()
  const key = (ownerType: string, ownerKey: string, endpointName: string, scenario: string) =>
    `${ownerType}|${ownerKey}|${endpointName}|${scenario}`
  return {
    store,
    getDynamicHistory: async (
      ownerType: string,
      ownerKey: string,
      endpointName: string,
      scenario: string,
    ) => store.get(key(ownerType, ownerKey, endpointName, scenario)) ?? [],
    appendDynamicHistory: async (
      ownerType: string,
      ownerKey: string,
      endpointName: string,
      scenario: string,
      slug: string,
    ) => {
      const k = key(ownerType, ownerKey, endpointName, scenario)
      const existing = store.get(k) ?? []
      store.set(k, [...existing, slug])
    },
  }
}

function statusRequest(customerId: string): Request {
  return new Request(`http://localhost:3000/customers/${customerId}/status`, { method: 'GET' })
}

function statusRoute(customerId: string): string[] {
  return ['customers', customerId, 'status']
}

describe('dynamic resolver end-to-end (real compileResolver + real history store)', () => {
  it('serves failure then default as the real history accumulates across calls', async () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': DEFAULT_FIXTURE,
      'sys/ep/failure.json': FAILURE_FIXTURE,
      'sys/ep/dynamic.ts': DYNAMIC_SOURCE,
    })
    const catalog = loadCatalog(dir)

    // Compile once via the real compileResolver, exactly as the runtime does.
    const source = fs.readFileSync(resolverFilePath(dir, 'sys', 'ep', 'dynamic'), 'utf8')
    const resolver: CompiledResolver = compileResolver(source, 'sys/ep/dynamic.ts')

    const history = makeHistoryStore()

    const profiles: Record<string, MockProfile> = {
      'customer-123': {
        profileId: 'customer-123',
        endpointScenarios: { ep: 'dynamic' },
        createdAt: NOW,
        modifiedAt: NOW,
      },
    }

    const deps: RouterDeps = {
      catalog,
      passthroughAsDefault: false,
      unmockedUsers: 'ERROR',
      timeoutMs: 1000,
      env: {},
      getProfile: async (id) => profiles[id] ?? null,
      getProfileKeyMapping: async () => null,
      getGlobalMockScenario: async () => null,
      captureProfileKeyMapping: async () => {},
      advanceScenarioProgress: async () => 1,
      getCompiledResolver: () => resolver,
      getDynamicHistory: history.getDynamicHistory,
      appendDynamicHistory: history.appendDynamicHistory,
      passthrough: async () => ({
        status: 299,
        headers: { 'x-proxied': '1' },
        bodyBytes: Buffer.from('proxied'),
      }),
      loadFixture: (systemSlug, endpointName, scenario) =>
        loadFixture(dir, systemSlug, endpointName, scenario),
      now: () => NOW,
    }
    const handle = createMockHandler(deps)

    // 1st request: history is empty, so the resolver picks "failure".
    const res1 = await handle(statusRequest('customer-123'), statusRoute('customer-123'))
    expect(res1.status).toBe(503)
    expect(await res1.json()).toEqual({ status: 'DOWN' })

    // 2nd request: history now has one entry, so the resolver flips to "default".
    const res2 = await handle(statusRequest('customer-123'), statusRoute('customer-123'))
    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual({ status: 'ACTIVE' })

    // The real in-memory store actually accumulated both appended slugs, in order.
    expect(history.store.get('profile|customer-123|ep|dynamic')).toEqual(['failure', 'default'])
  })
})
