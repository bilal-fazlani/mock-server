import type { LogEntry, LogSummary } from '../../../lib/logs/store'

/** LogEntry as it crosses the server/client boundary: ts serialized to ISO. */
export type LogEntryView = Omit<LogEntry, 'ts'> & { ts: string }

export function toLogEntryView(entry: LogEntry): LogEntryView {
  return { ...entry, ts: new Date(entry.ts).toISOString() }
}

/** Row-list shape: LogEntryView without the heavy request/response payloads. */
export type LogSummaryView = Omit<LogEntryView, 'request' | 'response'> & {
  response?: { status: number }
}

export function toLogSummaryView(entry: LogSummary): LogSummaryView {
  return { ...entry, ts: new Date(entry.ts).toISOString() }
}
