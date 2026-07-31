import type { Db } from 'mongodb'
import { writeConsoleLog } from './console'
import { insertLogEntry, newLogId } from './store'

/**
 * Records an admin action (profile save / progress reset) as a log entry so it
 * shows in the logs view, regardless of whether the UI or the /ui/api routes
 * drove the change. Failures are swallowed — an admin action must not fail
 * because logging failed.
 */
export async function writeAdminLog(
  db: Db,
  profileId: string,
  adminAction: 'profile_saved' | 'progress_reset',
  adminEndpoint?: string,
): Promise<void> {
  try {
    await insertLogEntry(db, {
      logId: newLogId(),
      ts: new Date(),
      kind: 'admin',
      profileId,
      trace: { adminAction, ...(adminEndpoint && { adminEndpoint }) },
    })
  } catch (err) {
    writeConsoleLog(
      'warn',
      `[mock-log] failed to write admin log entry: ${err instanceof Error ? err.message : String(err)}`,
      { fields: { 'event.action': adminAction, 'mock.profileId': profileId } },
    )
  }
}
