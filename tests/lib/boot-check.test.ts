import { describe, expect, it, vi } from 'vitest'
import { verifyRuntimeAtBoot } from '../../src/lib/boot-check'

function deps(build: () => unknown, isProduction: boolean) {
  return { build, write: vi.fn(), exit: vi.fn(), isProduction }
}

describe('verifyRuntimeAtBoot', () => {
  it('stays silent when the runtime builds', () => {
    const d = deps(() => ({}), true)
    verifyRuntimeAtBoot(d)
    expect(d.write).not.toHaveBeenCalled()
    expect(d.exit).not.toHaveBeenCalled()
  })

  it('prints the error and exits 1 in production', () => {
    const d = deps(() => {
      throw new Error('catalog directory not found: /app/catalog\nMount one.')
    }, true)
    verifyRuntimeAtBoot(d)
    expect(d.write).toHaveBeenCalledWith(
      'mock-server: cannot start: catalog directory not found: /app/catalog\nMount one.\n',
    )
    expect(d.exit).toHaveBeenCalledWith(1)
  })

  it('prints the error but keeps running under next dev', () => {
    const d = deps(() => {
      throw new Error('boom')
    }, false)
    verifyRuntimeAtBoot(d)
    expect(d.write).toHaveBeenCalledWith(
      'mock-server: runtime failed to build (dev server keeps running): boom\n',
    )
    expect(d.exit).not.toHaveBeenCalled()
  })
})

describe('instrumentation register', () => {
  it('does nothing outside the node runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    const { register } = await import('../../src/instrumentation')
    await expect(register()).resolves.toBeUndefined()
    vi.unstubAllEnvs()
  })
})
