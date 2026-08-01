import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const fixturesDir = path.join(__dirname, '../testdata/fixtures')

vi.mock('../../src/lib/runtime', () => ({
  getRuntime: () => ({
    catalogDir: fixturesDir,
    catalog: {
      systems: [
        {
          name: 'Test System',
          slug: 'test-system',
          baseUrlEnv: 'TEST_SYSTEM_URL',
          endpoints: [
            {
              name: 'hello_world',
              displayName: 'Hello World',
              method: 'POST',
              path: '/hello/world',
              profileIdSelector: '$.customerId',
              scenarios: {
                default: { label: 'Success', summary: 'Happy path', status: 200 },
                by_amount: { label: 'Routes by amount' },
              },
              resolverScenarios: ['by_amount'],
            },
          ],
        },
      ],
    },
  }),
}))

const { GET } = await import(
  '../../src/app/ui/api/catalog/[system]/[endpoint]/scenarios/[slug]/route'
)

function ctx(system: string, endpoint: string, slug: string) {
  return { params: Promise.resolve({ system, endpoint, slug }) }
}

describe('GET /ui/api/catalog/[system]/[endpoint]/scenarios/[slug]', () => {
  it('returns the prepared view for a declared fixture scenario', async () => {
    const res = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'default'))
    expect(res.status).toBe(200)
    const { view } = await res.json()
    expect(view).toMatchObject({ key: 'default', label: 'Success', summary: 'Happy path', kind: 'fixture' })
    expect(view.html).toContain('shiki')
  })

  it('returns a resolver view with the highlighted source', async () => {
    // tests/testdata/fixtures/test-system/hello_world/by_amount.mjs exists on disk
    const res = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'by_amount'))
    expect(res.status).toBe(200)
    const { view } = await res.json()
    expect(view).toMatchObject({ key: 'by_amount', kind: 'resolver' })
    expect(view.code).toContain('export default')
  })

  it('404s for the implicit real scenario', async () => {
    const res = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'real'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown scenario "real"' })
  })

  it('404s for an unknown slug and an unknown endpoint', async () => {
    const ghost = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'ghost'))
    expect(ghost.status).toBe(404)
    expect(await ghost.json()).toEqual({ error: 'unknown scenario "ghost"' })

    const unknownEndpoint = await GET(new Request('http://mock/x'), ctx('nope', 'hello_world', 'default'))
    expect(unknownEndpoint.status).toBe(404)
    expect(await unknownEndpoint.json()).toEqual({ error: 'unknown endpoint nope/hello_world' })
  })

  it('404s for a prototype-chain slug like "constructor" instead of leaking it to buildScenarioView', async () => {
    // Object.hasOwn (not `in`) guards this: plain-object scenario maps inherit
    // `constructor`/`toString`/etc. from Object.prototype, so `in` would say
    // these slugs exist even though none was declared in the catalog.
    const res = await GET(new Request('http://mock/x'), ctx('test-system', 'hello_world', 'constructor'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown scenario "constructor"' })
  })
})
