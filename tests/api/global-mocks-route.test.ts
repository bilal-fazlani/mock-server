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
              resolverScenarios: [],
            },
            {
              name: 'account_balance',
              displayName: 'Account Balance',
              method: 'POST',
              path: '/accounts/balance',
              mockType: 'global',
              scenarios: { default: 'Settled', pending: 'Pending', dynamic: 'dynamic' },
              resolverScenarios: ['dynamic'],
            },
            {
              name: 'profiled_endpoint',
              displayName: 'Profiled Endpoint',
              method: 'POST',
              path: '/profiled',
              profileIdSelector: '$.customerId',
              scenarios: { default: 'Success' },
              resolverScenarios: [],
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

  it('sets "dynamic" on a resolver-backed global endpoint', async () => {
    const res = await detailRoute.PUT(
      putReq({ scenario: 'dynamic' }),
      params('hello-system', 'account_balance'),
    )
    expect(res.status).toBe(200)
    expect(upsertGlobalMockScenarioMock).toHaveBeenCalledWith(expect.anything(), {
      system: 'hello-system',
      endpoint: 'account_balance',
      scenario: 'dynamic',
    })
  })

  it('400s for "dynamic" on a global endpoint without a resolver', async () => {
    const res = await detailRoute.PUT(
      putReq({ scenario: 'dynamic' }),
      params('hello-system', 'oauth_token'),
    )
    expect(res.status).toBe(400)
    expect(upsertGlobalMockScenarioMock).not.toHaveBeenCalled()
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
