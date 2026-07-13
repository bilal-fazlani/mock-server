import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }
const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('getRuntime', () => {
  it('ignores legacy STRICT_MODE when parsing current routing config', async () => {
    process.chdir(__dirname + '/../..')
    process.env = {
      ...originalEnv,
      STRICT_MODE: 'true',
      PASSTHROUGH_AS_DEFAULT: 'false',
      UNMOCKED_USERS: 'ERROR',
      MOCK_CONSOLE_LOG_LEVEL: 'warn',
    }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(getRuntime()).toMatchObject({
      passthroughAsDefault: false,
      unmockedUsers: 'ERROR',
      consoleLogLevel: 'warn',
    })
  })
})
