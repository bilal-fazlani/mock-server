import type { LogEntry } from '../../../lib/logs/store'

/** LogEntry as it crosses the server/client boundary: ts serialized to ISO. */
export type LogEntryView = Omit<LogEntry, 'ts'> & { ts: string }

export function toLogEntryView(entry: LogEntry): LogEntryView {
  return { ...entry, ts: new Date(entry.ts).toISOString() }
}
