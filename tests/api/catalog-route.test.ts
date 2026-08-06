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
              scenarios: { default: { label: 'Token' }, expired: { label: 'Expired' } },
              resolverScenarios: [],
            },
            {
              name: 'profiled_endpoint',
              displayName: 'Profiled Endpoint',
              method: 'POST',
              path: '/profiled',
              profileIdSelector: '$.customerId',
              scenarios: { default: { label: 'Success' }, by_amount: { label: 'Routes by amount' } },
              resolverScenarios: ['by_amount'],
            },
            {
              name: 'create_order',
              displayName: 'Create Order',
              method: 'POST',
              path: '/orders',
              profileIdSelector: '$.customer.customerId',
              captureProfileKeys: [{ namespace: 'order-id', keySelector: '$.orderId' }],
              scenarios: { default: { label: 'Accepted' } },
              resolverScenarios: [],
            },
            {
              name: 'empty_capture_endpoint',
              displayName: 'Empty Capture Endpoint',
              method: 'POST',
              path: '/empty-capture',
              profileIdSelector: '$.customerId',
              captureProfileKeys: [],
              scenarios: { default: { label: 'Success' } },
              resolverScenarios: [],
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

  it('projects profileIdSelector and captureProfileKeys only where the catalog declares them', async () => {
    const res = await GET()
    const body = await res.json()
    const [system] = body.systems

    // Global endpoint declares neither — both keys are omitted, not present-as-undefined/null.
    const globalEndpoint = system.endpoints[0]
    expect(globalEndpoint).not.toHaveProperty('profileIdSelector')
    expect(globalEndpoint).not.toHaveProperty('captureProfileKeys')

    // Profiled endpoint declares a selector but no captures.
    const profiledEndpoint = system.endpoints[1]
    expect(profiledEndpoint.profileIdSelector).toBe('$.customerId')
    expect(profiledEndpoint).not.toHaveProperty('captureProfileKeys')

    // Endpoint declaring both: selector and captures pass through verbatim, unreformatted.
    const createOrder = system.endpoints[2]
    expect(createOrder.profileIdSelector).toBe('$.customer.customerId')
    expect(createOrder.captureProfileKeys).toEqual([{ namespace: 'order-id', keySelector: '$.orderId' }])
  })

  it('projects a declared-but-empty captureProfileKeys as [], not omitted', async () => {
    const res = await GET()
    const body = await res.json()
    const [system] = body.systems

    // Guards against a future `.length > 0` refactor of the projection's
    // `!== undefined` check silently turning a declared [] into an omission.
    const emptyCapture = system.endpoints[3]
    expect(emptyCapture).toHaveProperty('captureProfileKeys')
    expect(emptyCapture.captureProfileKeys).toEqual([])
  })
})
