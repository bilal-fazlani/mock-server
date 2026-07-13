import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsertProfileMock = vi.fn()
const deleteProfileMock = vi.fn()
vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
  upsertProfile: (...args: unknown[]) => upsertProfileMock(...args),
  deleteProfile: (...args: unknown[]) => deleteProfileMock(...args),
}))

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

let passthroughAsDefault = false
vi.mock('../../src/lib/runtime', () => ({
  getRuntime: () => ({
    catalog: {
      systems: [
        {
          name: 'Hello System',
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
    get passthroughAsDefault() {
      return passthroughAsDefault
    },
  }),
}))

const { saveProfile } = await import('../../src/app/ui/profiles/actions')
const { deleteProfileAction } = await import('../../src/app/ui/profiles/actions')

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  upsertProfileMock.mockClear()
  deleteProfileMock.mockClear()
  redirectMock.mockClear()
  passthroughAsDefault = false
})

describe('saveProfile', () => {
  it('drops a "default" pick — nothing stored for that endpoint (delta save)', async () => {
    await expect(
      saveProfile(formData({ profileId: 'c1', 'scenario:hello_world': 'default' })),
    ).rejects.toThrow('REDIRECT:')
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpointScenarios: {} }),
    )
  })

  it('stores an explicit non-default pin', async () => {
    await expect(
      saveProfile(formData({ profileId: 'c1', 'scenario:hello_world': 'failure' })),
    ).rejects.toThrow('REDIRECT:')
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpointScenarios: { hello_world: 'failure' } }),
    )
  })

  it('rejects an undeclared scenario name', async () => {
    await expect(
      saveProfile(formData({ profileId: 'c1', 'scenario:hello_world': 'ghost' })),
    ).rejects.toThrow(/not declared/)
    expect(upsertProfileMock).not.toHaveBeenCalled()
  })

  it('stores "real" when passthrough is not the configured default', async () => {
    await expect(
      saveProfile(formData({ profileId: 'c1', 'scenario:hello_world': 'real' })),
    ).rejects.toThrow('REDIRECT:')
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpointScenarios: { hello_world: 'real' } }),
    )
  })

  it('drops a "real" pick when passthrough is the configured default', async () => {
    passthroughAsDefault = true
    await expect(
      saveProfile(formData({ profileId: 'c1', 'scenario:hello_world': 'real' })),
    ).rejects.toThrow('REDIRECT:')
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpointScenarios: {} }),
    )
  })

  it('stores "default" when passthrough is the configured default', async () => {
    passthroughAsDefault = true
    await expect(
      saveProfile(formData({ profileId: 'c1', 'scenario:hello_world': 'default' })),
    ).rejects.toThrow('REDIRECT:')
    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpointScenarios: { hello_world: 'default' } }),
    )
  })

  it('uses a random UUID when profileId is missing', async () => {
    await expect(saveProfile(formData({}))).rejects.toThrow('REDIRECT:')

    expect(upsertProfileMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        profileId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      }),
    )
  })
})

describe('deleteProfileAction', () => {
  it('deletes a profile and redirects to the list', async () => {
    await expect(deleteProfileAction(formData({ profileId: ' c1 ' }))).rejects.toThrow(
      'REDIRECT:',
    )
    expect(deleteProfileMock).toHaveBeenCalledWith(expect.anything(), 'c1')
    expect(redirectMock).toHaveBeenCalledWith('/ui')
  })

  it('requires a profileId before deleting', async () => {
    await expect(deleteProfileAction(formData({ profileId: ' ' }))).rejects.toThrow(
      /profileId is required/,
    )
    expect(deleteProfileMock).not.toHaveBeenCalled()
  })
})
