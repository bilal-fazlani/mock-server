import type { LogEntry, LogSummary } from '../../../lib/logs/store'

/** LogEntry as it crosses the server/client boundary: ts serialized to ISO. */
export type LogEntryView = Omit<LogEntry, 'ts'> & { ts: string }

export function toLogEntryView(entry: LogEntry): LogEntryView {
  return { ...entry, ts: new Date(entry.ts).toISOString() }
}

/**
 * Shiki-highlighted markup for the entry's bodies, built server-side because
 * the highlighter is async and Node-only. Absent per side when that body is
 * missing or is a raw string rather than structured JSON.
 */
export interface LogBodyHtml {
  request?: string
  response?: string
}

/** What `/ui/api/logs/[logId]` returns. */
export interface LogDetailResponse {
  entry: LogEntryView
  bodyHtml?: LogBodyHtml
}

/** Row-list shape: LogEntryView without the heavy request/response payloads. */
export type LogSummaryView = Omit<LogEntryView, 'request' | 'response'> & {
  response?: { status: number }
}

export function toLogSummaryView(entry: LogSummary): LogSummaryView {
  return { ...entry, ts: new Date(entry.ts).toISOString() }
}
