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
              resolverScenarios: [],
            },
            {
              name: 'profiled_endpoint',
              displayName: 'Profiled Endpoint',
              method: 'POST',
              path: '/profiled',
              profileIdSelector: '$.customerId',
              scenarios: { default: 'Success', by_amount: 'Routes by amount' },
              resolverScenarios: ['by_amount'],
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
  it('projects systems and endpoints with mockType and resolverScenarios', async () => {
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
      resolverScenarios: [],
      scenarios: { default: 'Token', expired: 'Expired' },
    })
    // mockType defaults to 'profiled', resolverScenarios preserved
    expect(system.endpoints[1].mockType).toBe('profiled')
    expect(system.endpoints[1].resolverScenarios).toEqual(['by_amount'])
  })

  it('does not leak fixture bodies', async () => {
    const res = await GET()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('json')
  })
})
