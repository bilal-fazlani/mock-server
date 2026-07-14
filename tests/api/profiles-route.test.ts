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
