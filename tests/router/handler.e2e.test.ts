import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../../src/lib/catalog/load'
import { loadFixture } from '../../src/lib/mock-engine/fixtures'
import type { MockProfile } from '../../src/lib/profiles/store'
import { createMockHandler } from '../../src/lib/router/handler'
import type { RouterDeps } from '../../src/lib/router/route-request'

const NOW = new Date('2026-07-02T00:00:00.000Z')
const CATALOG_DIR = path.join(__dirname, '../../catalog')

function handlerWith(profiles: Record<string, Partial<MockProfile>>, overrides: Partial<RouterDeps> = {}) {
  const deps: RouterDeps = {
    catalog: loadCatalog(CATALOG_DIR),
    passthroughAsDefault: false,
    unmockedUsers: 'ERROR',
    timeoutMs: 1000,
    env: { HELLO_SYSTEM_URL: 'http://real.example' },
    getProfile: async (id) =>
      profiles[id]
        ? { profileId: id, endpointScenarios: {}, createdAt: NOW, modifiedAt: NOW, ...profiles[id] }
        : null,
    getProfileKeyMapping: async () => null,
    getGlobalMockScenario: async () => null,
    captureProfileKeyMapping: async () => {},
    advanceScenarioProgress: async () => 1,
    getCompiledResolver: () => null,
    getDynamicHistory: async () => [],
    appendDynamicHistory: async () => {},
    passthrough: async () => ({
      status: 299,
      headers: { 'x-proxied': '1' },
      bodyBytes: Buffer.from('proxied'),
    }),
    loadFixture: (systemSlug, endpointName, scenario) =>
      loadFixture(CATALOG_DIR, systemSlug, endpointName, scenario),
    now: () => NOW,
    ...overrides,
  }
  return createMockHandler(deps)
}

function statusRequest(customerId: string): Request {
  return new Request(`http://localhost:3000/customers/${customerId}/status`, {
    method: 'GET',
  })
}

function statusRoute(customerId: string): string[] {
  return ['customers', customerId, 'status']
}

describe('customer-status end to end', () => {
  it('gap-fill (no pick) returns the default fixture with the echoed customerId', async () => {
    const handle = handlerWith({ 'customer-123': { endpointScenarios: {} } })
    const res = await handle(statusRequest('customer-123'), statusRoute('customer-123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      customerId: 'customer-123',
      status: 'ACTIVE',
    })
  })

  it('frozen scenario returns the frozen fixture with the echoed customerId', async () => {
    const handle = handlerWith({ 'customer-123': { endpointScenarios: { customer_status: 'frozen' } } })
    const res = await handle(statusRequest('customer-123'), statusRoute('customer-123'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      customerId: 'customer-123',
      status: 'FROZEN',
    })
  })

  it('real scenario proxies to the passthrough', async () => {
    const handle = handlerWith({ 'customer-123': { endpointScenarios: { customer_status: 'real' } } })
    const res = await handle(statusRequest('customer-123'), statusRoute('customer-123'))
    expect(res.status).toBe(299)
    expect(res.headers.get('x-proxied')).toBe('1')
    expect(await res.text()).toBe('proxied')
  })

  it('a profile pinning real 500s when the base URL is missing', async () => {
    const handle = handlerWith(
      { 'customer-123': { endpointScenarios: { customer_status: 'real' } } },
      { env: {} },
    )
    const res = await handle(statusRequest('customer-123'), statusRoute('customer-123'))
    expect(res.status).toBe(500)
  })

  it('unknown profile under UNMOCKED_USERS=ERROR is a 404 with the extracted ID', async () => {
    const handle = handlerWith({})
    const res = await handle(statusRequest('ghost'), statusRoute('ghost'))
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toMatch(/ghost/)
  })
})
