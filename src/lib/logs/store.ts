import type { Db } from 'mongodb'

export type LogOutcome = 'fixture' | 'passthrough' | 'error'

export type ScenarioSource = 'pin' | 'sequence' | 'implicit' | 'global' | 'unmocked_policy' | 'dynamic'

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
  dynamic?: { returned: string }
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
  limit?: number
}

const DEFAULT_LIMIT = 100

export async function insertLogEntry(db: Db, entry: LogEntry): Promise<void> {
  await db.collection<LogEntry>('requestLogs').insertOne({ ...entry })
}

export async function listLogEntries(db: Db, options: ListLogsOptions): Promise<LogEntry[]> {
  const collection = db.collection<LogEntry>('requestLogs')
  const filter: Record<string, unknown> = {}
  if (options.profileId) filter.profileId = options.profileId
  if (options.endpoint) filter.endpoint = options.endpoint
  if (options.errorsOnly) filter.outcome = 'error'
  if (options.logIdQuery) {
    filter.logId = { $regex: `^${escapeRegex(options.logIdQuery)}`, $options: 'i' }
  }
  if (options.sinceId) {
    // Cursor for polling: only entries newer than the given one. An expired
    // or unknown cursor falls back to the newest page.
    const since = await collection.findOne({ logId: options.sinceId }, { projection: { ts: 1 } })
    if (since) filter.ts = { $gt: since.ts }
  }
  return collection
    .find(filter, { projection: { _id: 0 } })
    .sort({ ts: -1, logId: -1 })
    .limit(options.limit ?? DEFAULT_LIMIT)
    .toArray()
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
