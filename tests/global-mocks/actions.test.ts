import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsertGlobalMockScenarioMock = vi.fn()
const clearGlobalMockScenarioMock = vi.fn()

vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
  upsertGlobalMockScenario: (...args: unknown[]) => upsertGlobalMockScenarioMock(...args),
  clearGlobalMockScenario: (...args: unknown[]) => clearGlobalMockScenarioMock(...args),
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
              scenarios: { default: 'Success' },
            },
          ],
        },
      ],
    },
  }),
}))

const { saveGlobalMocks } = await import('../../src/app/ui/global-mocks/actions')

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  upsertGlobalMockScenarioMock.mockClear()
  clearGlobalMockScenarioMock.mockClear()
  redirectMock.mockClear()
  passthroughAsDefault = false
})

describe('saveGlobalMocks', () => {
  it('clears default when passthrough is not the configured default', async () => {
    await expect(
      saveGlobalMocks(formData({ 'scenario:hello-system:oauth_token': 'default' })),
    ).rejects.toThrow('REDIRECT:')

    expect(clearGlobalMockScenarioMock).toHaveBeenCalledWith(
      expect.anything(),
      'hello-system',
      'oauth_token',
    )
    expect(upsertGlobalMockScenarioMock).not.toHaveBeenCalled()
  })

  it('stores real when passthrough is not the configured default', async () => {
    await expect(
      saveGlobalMocks(formData({ 'scenario:hello-system:oauth_token': 'real' })),
    ).rejects.toThrow('REDIRECT:')

    expect(upsertGlobalMockScenarioMock).toHaveBeenCalledWith(expect.anything(), {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'real',
    })
  })

  it('clears real when passthrough is the configured default', async () => {
    passthroughAsDefault = true
    await expect(
      saveGlobalMocks(formData({ 'scenario:hello-system:oauth_token': 'real' })),
    ).rejects.toThrow('REDIRECT:')

    expect(clearGlobalMockScenarioMock).toHaveBeenCalledWith(
      expect.anything(),
      'hello-system',
      'oauth_token',
    )
  })

  it('stores default when passthrough is the configured default', async () => {
    passthroughAsDefault = true
    await expect(
      saveGlobalMocks(formData({ 'scenario:hello-system:oauth_token': 'default' })),
    ).rejects.toThrow('REDIRECT:')

    expect(upsertGlobalMockScenarioMock).toHaveBeenCalledWith(expect.anything(), {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'default',
    })
  })

  it('rejects undeclared fixture scenarios', async () => {
    await expect(
      saveGlobalMocks(formData({ 'scenario:hello-system:oauth_token': 'ghost' })),
    ).rejects.toThrow(/not declared/)
    expect(upsertGlobalMockScenarioMock).not.toHaveBeenCalled()
    expect(clearGlobalMockScenarioMock).not.toHaveBeenCalled()
  })
})
