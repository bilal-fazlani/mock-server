import type { Db } from 'mongodb'

export type LogOutcome = 'fixture' | 'passthrough' | 'error'

export type ScenarioSource = 'pin' | 'sequence' | 'implicit' | 'global' | 'unmocked_policy'

export interface LogPayload {
  headers: Record<string, string>
  body: unknown
  truncated: boolean
}

export interface LogResponsePayload extends LogPayload {
  status: number
}

export interface ProfileResolutionTrace {
  selector: string
  value: string
  via: 'direct' | { namespace: string; key: string }
}

export interface LogTraceData {
  profileResolution?: ProfileResolutionTrace
  scenario?: string
  scenarioSource?: ScenarioSource
  sequence?: { step: number; of: number; served: number }
  /** Present when a resolver-backed scenario ran: the picked slug and what it returned. */
  resolver?: { slug: string; returned: string }
  captures?: Array<{ namespace: string; key: string }>
  placeholders?: Record<string, string>
  validation?: { request?: 'ok' | 'failed'; response?: 'ok' | 'failed' | 'drift_warning' }
  upstream?: { url: string; status: number; durationMs: number }
  adminAction?: 'profile_saved' | 'progress_reset'
  adminEndpoint?: string
}

export interface LogEntry {
  logId: string
  ts: Date
  durationMs?: number
  kind: 'request' | 'admin'
  profileId?: string
  system?: string
  endpoint?: string
  method?: string
  path?: string
  query?: string
  request?: LogPayload
  response?: LogResponsePayload
  outcome?: LogOutcome
  error?: { code: string; message: string }
  trace: LogTraceData
}

export interface ListLogsOptions {
  profileId?: string
  endpoint?: string
  errorsOnly?: boolean
  /** Case-insensitive prefix match on logId (paste from x-mock-log-id). */
  logIdQuery?: string
  sinceId?: string
  beforeId?: string
  limit?: number
}

export type LogSummary = Omit<LogEntry, 'request' | 'response'> & {
  response?: { status: number }
}

const DEFAULT_LIMIT = 100

const SUMMARY_PROJECTION = {
  _id: 0,
  request: 0,
  'response.headers': 0,
  'response.body': 0,
  'response.truncated': 0,
} as const

async function buildLogFilter(
  collection: import('mongodb').Collection<LogEntry>,
  options: ListLogsOptions,
): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {}
  if (options.profileId) filter.profileId = options.profileId
  if (options.endpoint) filter.endpoint = options.endpoint
  if (options.errorsOnly) filter.outcome = 'error'
  if (options.logIdQuery) {
    filter.logId = { $regex: `^${escapeRegex(options.logIdQuery)}`, $options: 'i' }
  }
  // Keyset cursors respect the { ts: -1, logId: -1 } sort so entries sharing a
  // millisecond are never skipped. `before` (older) takes precedence over
  // `since` (newer) if both are somehow supplied; the UI only sends one.
  const cursorId = options.beforeId ?? options.sinceId
  if (cursorId) {
    const cursor = await collection.findOne(
      { logId: cursorId },
      { projection: { _id: 0, ts: 1, logId: 1 } },
    )
    if (cursor) {
      const op = options.beforeId ? '$lt' : '$gt'
      filter.$or = [{ ts: { [op]: cursor.ts } }, { ts: cursor.ts, logId: { [op]: cursor.logId } }]
    } else if (options.beforeId) {
      // Unknown/expired `before` cursor → "no older entries". `$and` with an
      // impossible clause guarantees empty without clobbering a logId regex.
      filter.$and = [{ logId: { $in: [] } }]
    }
  }
  return filter
}

export async function insertLogEntry(db: Db, entry: LogEntry): Promise<void> {
  await db.collection<LogEntry>('requestLogs').insertOne({ ...entry })
}

export async function listLogEntries(db: Db, options: ListLogsOptions): Promise<LogEntry[]> {
  const collection = db.collection<LogEntry>('requestLogs')
  const filter = await buildLogFilter(collection, options)
  return collection
    .find(filter, { projection: { _id: 0 } })
    .sort({ ts: -1, logId: -1 })
    .limit(options.limit ?? DEFAULT_LIMIT)
    .toArray()
}

export async function listLogSummaries(db: Db, options: ListLogsOptions): Promise<LogSummary[]> {
  const collection = db.collection<LogEntry>('requestLogs')
  const filter = await buildLogFilter(collection, options)
  return collection
    .find<LogSummary>(filter, { projection: SUMMARY_PROJECTION })
    .sort({ ts: -1, logId: -1 })
    .limit(options.limit ?? DEFAULT_LIMIT)
    .toArray()
}

export async function getLogEntry(db: Db, logId: string): Promise<LogEntry | null> {
  return db.collection<LogEntry>('requestLogs').findOne({ logId }, { projection: { _id: 0 } })
}

export async function clearLogs(db: Db, profileId?: string): Promise<void> {
  await db
    .collection<LogEntry>('requestLogs')
    .deleteMany(profileId === undefined ? {} : { profileId })
}

export function newLogId(): string {
  return `lg_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
