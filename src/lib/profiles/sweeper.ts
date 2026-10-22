import type { Db } from 'mongodb'
import { writeConsoleLog } from '../logs/console'

export const PROFILE_SWEEP_INTERVAL_MS = 60_000

type Sweep = (db: Db) => Promise<number>

// Pinned to globalThis like the Mongo client in store.ts: every bundle shares one
// connection, so it must share one timer too.
const globalScope = globalThis as typeof globalThis & {
  __mockServerProfileSweeper?: ReturnType<typeof setInterval>
}

/**
 * One sweep of expired profiles. Best-effort, like pruneOrphanedHistoryOnce: a
 * failure is logged and swallowed, and the next tick retries.
 */
export async function sweepExpiredProfilesOnce(db: Db, sweep: Sweep): Promise<void> {
  try {
    const swept = await sweep(db)
    if (swept > 0) {
      writeConsoleLog('info', `profiles: removed ${swept} expired profile(s)`, {
        fields: { 'event.action': 'profiles_expired_swept', 'mock.sweptProfiles': swept },
      })
    }
  } catch (err) {
    writeConsoleLog(
      'warn',
      `profiles: expired-profile sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      { fields: { 'event.action': 'profiles_expired_sweep_failed' } },
    )
  }
}

/**
 * Sweeps once now and every minute after, once per process. Started from the
 * first MongoDB connect, so `next build` — which never connects — never runs it;
 * the phase check covers a build that does. Several instances sweeping one
 * database at once is harmless: each delete is conditional on the profile still
 * being expired.
 */
export function startProfileSweeper(db: Db, sweep: Sweep): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (globalScope.__mockServerProfileSweeper) return
  void sweepExpiredProfilesOnce(db, sweep)
  globalScope.__mockServerProfileSweeper = setInterval(
    () => void sweepExpiredProfilesOnce(db, sweep),
    PROFILE_SWEEP_INTERVAL_MS,
  ).unref()
}

export function stopProfileSweeper(): void {
  clearInterval(globalScope.__mockServerProfileSweeper)
  globalScope.__mockServerProfileSweeper = undefined
}
