import type { Db } from 'mongodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const writeConsoleLogMock = vi.fn()
vi.mock('../../src/lib/logs/console', () => ({
  writeConsoleLog: (...a: unknown[]) => writeConsoleLogMock(...a),
}))

const { PROFILE_SWEEP_INTERVAL_MS, startProfileSweeper, stopProfileSweeper, sweepExpiredProfilesOnce } =
  await import('../../src/lib/profiles/sweeper')

const db = {} as Db

beforeEach(() => {
  vi.useFakeTimers()
  writeConsoleLogMock.mockReset()
})

afterEach(() => {
  stopProfileSweeper()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('startProfileSweeper', () => {
  it('sweeps once at start and again every minute', async () => {
    const sweep = vi.fn(async () => 0)
    startProfileSweeper(db, sweep)
    expect(sweep).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(PROFILE_SWEEP_INTERVAL_MS)
    expect(sweep).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(PROFILE_SWEEP_INTERVAL_MS)
    expect(sweep).toHaveBeenCalledTimes(3)
    expect(PROFILE_SWEEP_INTERVAL_MS).toBe(60_000)
  })

  it('starts only once per process', async () => {
    const sweep = vi.fn(async () => 0)
    startProfileSweeper(db, sweep)
    startProfileSweeper(db, sweep)
    await vi.advanceTimersByTimeAsync(PROFILE_SWEEP_INTERVAL_MS)
    expect(sweep).toHaveBeenCalledTimes(2)
  })

  it('never runs during next build', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    const sweep = vi.fn(async () => 0)
    startProfileSweeper(db, sweep)
    await vi.advanceTimersByTimeAsync(PROFILE_SWEEP_INTERVAL_MS * 2)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('keeps ticking after a failed sweep', async () => {
    const sweep = vi.fn(async () => {
      throw new Error('mongo down')
    })
    startProfileSweeper(db, sweep)
    await vi.advanceTimersByTimeAsync(PROFILE_SWEEP_INTERVAL_MS)
    expect(sweep).toHaveBeenCalledTimes(2)
  })
})

describe('sweepExpiredProfilesOnce', () => {
  it('logs a warning and swallows a failure', async () => {
    await expect(
      sweepExpiredProfilesOnce(db, async () => {
        throw new Error('mongo down')
      }),
    ).resolves.toBeUndefined()
    expect(writeConsoleLogMock).toHaveBeenCalledWith('warn', expect.stringContaining('mongo down'), expect.anything())
  })

  it('logs how many profiles it removed, and nothing when none', async () => {
    await sweepExpiredProfilesOnce(db, async () => 0)
    expect(writeConsoleLogMock).not.toHaveBeenCalled()
    await sweepExpiredProfilesOnce(db, async () => 2)
    expect(writeConsoleLogMock).toHaveBeenCalledWith('info', expect.stringContaining('2 expired'), expect.anything())
  })
})
