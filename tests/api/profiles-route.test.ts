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
    profileApiTtl: '1d',
    catalog: {
      systems: [
        {
          displayName: 'Hello System',
          slug: 'hello-system',
          baseUrlEnv: 'HELLO_SYSTEM_URL',
          endpoints: [
            {
              slug: 'hello_world',
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
    expect(await res.json()).toEqual({ error: 'not_found', code: 'profile_not_found' })
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
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        profileId: 'c1',
        displayName: 'run',
        endpointScenarios: { hello_world: 'failure' },
        ttl: undefined,
      },
      { defaultTtl: '1d' },
    )
    expect(writeAdminLogMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'profile_saved')
    expect((await res.json()).endpointScenarios).toEqual({ hello_world: 'failure' })
  })

  it('400s on an undeclared scenario', async () => {
    const res = await route.PUT(
      jsonReq('PUT', { endpointScenarios: { hello_world: 'ghost' } }),
      params('c1'),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_scenario_selection')
    expect(upsertProfileMock).not.toHaveBeenCalled()
  })

  it('400s on an unknown endpoint', async () => {
    const res = await route.PUT(
      jsonReq('PUT', { endpointScenarios: { nope: 'default' } }),
      params('c1'),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_scenario_selection')
  })

  it('400s on malformed JSON', async () => {
    const res = await route.PUT(new Request('http://x', { method: 'PUT', body: '{bad' }), params('c1'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_json')
  })

  it('treats a missing endpointScenarios as empty', async () => {
    upsertProfileMock.mockResolvedValue(undefined)
    getProfileMock.mockResolvedValue({ profileId: 'c1', endpointScenarios: {} })
    const res = await route.PUT(jsonReq('PUT', {}), params('c1'))
    expect(res.status).toBe(200)
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpointScenarios: {} }),
      { defaultTtl: '1d' },
    )
  })
})

describe('PUT /ui/api/profiles/{id} ttl', () => {
  it.each([['2h'], [false]])('passes ttl %j through to the store', async (ttl) => {
    upsertProfileMock.mockResolvedValue(undefined)
    getProfileMock.mockResolvedValue({ profileId: 'c1', endpointScenarios: {} })
    const res = await route.PUT(jsonReq('PUT', { ttl }), params('c1'))
    expect(res.status).toBe(200)
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ttl }),
      { defaultTtl: '1d' },
    )
  })

  it.each([['forever'], ['0h'], ['1d12h'], [''], [null], [true], [3600], [{}]])(
    '400s on ttl %j without saving',
    async (ttl) => {
      const res = await route.PUT(jsonReq('PUT', { ttl }), params('c1'))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('invalid_ttl')
      expect(upsertProfileMock).not.toHaveBeenCalled()
    },
  )

  it('returns the stored ttl and expiresAt', async () => {
    const expiresAt = new Date('2026-10-23T12:00:00Z')
    upsertProfileMock.mockResolvedValue(undefined)
    getProfileMock.mockResolvedValue({ profileId: 'c1', endpointScenarios: {}, ttl: '1d', expiresAt })
    const body = await (await route.PUT(jsonReq('PUT', {}), params('c1'))).json()
    expect(body).toMatchObject({ ttl: '1d', expiresAt: expiresAt.toISOString() })
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
