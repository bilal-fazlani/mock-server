import type { Db } from 'mongodb'
import type { SchemaIssue } from '../catalog/schema'

export type LogOutcome = 'fixture' | 'passthrough' | 'error'

export type ScenarioSource = 'pin' | 'sequence' | 'implicit' | 'global' | 'unmocked_policy'

/**
 * A schema check's outcome for one side of the exchange. Absent means the side
 * was never checked — no schema, or the request never reached the check — which
 * is a distinct state from `ok`.
 */
export type ValidationResult = 'ok' | 'failed' | 'drift_warning'

/** What failed, for one side. Bounded so a pathological body can't inflate the entry. */
export interface ValidationIssues {
  /**
   * The first `MAX_TRACED_VALIDATION_ISSUES` issues. Projected away in list
   * summaries, which need only `total`; the detail fetch carries the full list.
   */
  list?: SchemaIssue[]
  /** How many issues there were in all, including any beyond `list`. */
  total: number
}

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
  validation?: {
    request?: ValidationResult
    response?: ValidationResult
    /**
     * What went wrong, per side, when that side is `failed` or `drift_warning`.
     * A sibling of the flags rather than a nested shape around them: entries
     * written before this field existed still render, and the console fields
     * (`mock.validation.*`) stay flag-only.
     */
    issues?: {
      request?: ValidationIssues
      response?: ValidationIssues
    }
  }
  /** Injected response delay in ms, when a fixture declared a `delay`. Folded
   * into the entry's total durationMs; recorded here to distinguish injected
   * latency from real work. */
  delayMs?: number
  upstream?: { url: string; status: number; durationMs: number }
  adminAction?: 'profile_saved' | 'progress_reset'
  adminEndpoint?: string
}

export interface LogEntry {
  logId: string
  /**
   * The caller's distributed-trace ID, when the request carried one: 32
   * lowercase hex from `traceparent`, or an `x-request-id` verbatim. Sits beside
   * `logId` because both are correlation IDs; omitted for untraced requests and
   * never present on `kind: 'admin'` entries.
   */
  traceId?: string
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

/**
 * Schema-validation outcome to narrow the list to. `issues` is the union of
 * `failed` and `drift`; `ok` means something was checked and nothing was wrong;
 * `unchecked` means no schema check ran at all.
 */
export const VALIDATION_FILTERS = ['issues', 'failed', 'drift', 'ok', 'unchecked'] as const

export type ValidationFilter = (typeof VALIDATION_FILTERS)[number]

export function parseValidationFilter(raw: string | null | undefined): ValidationFilter | undefined {
  return VALIDATION_FILTERS.includes(raw as ValidationFilter) ? (raw as ValidationFilter) : undefined
}

export interface ListLogsOptions {
  profileId?: string
  endpoint?: string
  errorsOnly?: boolean
  validation?: ValidationFilter
  /** Case-insensitive prefix match on logId (paste from x-mock-log-id). */
  logIdQuery?: string
  /** Exact match against the stored `LogEntry.traceId` (see trace-context.ts). */
  traceId?: string
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
  // Rows show a badge and a count, never the issues themselves — and this list
  // is re-fetched every poll. The `total` beside each dropped `list` survives.
  'trace.validation.issues.request.list': 0,
  'trace.validation.issues.response.list': 0,
} as const

const VALIDATION_PROBLEMS = ['failed', 'drift_warning']

const REQUEST_RESULT = 'trace.validation.request'
const RESPONSE_RESULT = 'trace.validation.response'

// Both sides are searched independently: an entry qualifies when *either* the
// request or the response check landed in the asked-for state.
function validationClause(filter: ValidationFilter): Record<string, unknown> {
  switch (filter) {
    case 'issues':
      return {
        $or: [
          { [REQUEST_RESULT]: { $in: VALIDATION_PROBLEMS } },
          { [RESPONSE_RESULT]: { $in: VALIDATION_PROBLEMS } },
        ],
      }
    case 'failed':
      return { $or: [{ [REQUEST_RESULT]: 'failed' }, { [RESPONSE_RESULT]: 'failed' }] }
    case 'drift':
      return {
        $or: [{ [REQUEST_RESULT]: 'drift_warning' }, { [RESPONSE_RESULT]: 'drift_warning' }],
      }
    case 'ok':
      // At least one side passed and neither side has a problem. `$nin` also
      // matches a missing field, so a request-only check still counts as ok.
      return {
        [REQUEST_RESULT]: { $nin: VALIDATION_PROBLEMS },
        [RESPONSE_RESULT]: { $nin: VALIDATION_PROBLEMS },
        $or: [{ [REQUEST_RESULT]: 'ok' }, { [RESPONSE_RESULT]: 'ok' }],
      }
    case 'unchecked':
      return { 'trace.validation': { $exists: false } }
  }
}

async function buildLogFilter(
  collection: import('mongodb').Collection<LogEntry>,
  options: ListLogsOptions,
): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {}
  // Clauses that carry their own `$or` go here rather than onto `filter`, so
  // two of them (a validation filter and a keyset cursor) can never clobber
  // each other by both claiming the top-level `$or`.
  const and: Record<string, unknown>[] = []
  if (options.profileId) filter.profileId = options.profileId
  if (options.endpoint) filter.endpoint = options.endpoint
  if (options.errorsOnly) filter.outcome = 'error'
  if (options.validation) and.push(validationClause(options.validation))
  if (options.logIdQuery) {
    filter.logId = { $regex: `^${escapeRegex(options.logIdQuery)}`, $options: 'i' }
  }
  // Exact match, unlike logId's prefix search: traceId is copied verbatim from
  // an inbound header (or is 32 hex from traceparent), never typed by hand.
  if (options.traceId) filter.traceId = options.traceId
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
      and.push({
        $or: [{ ts: { [op]: cursor.ts } }, { ts: cursor.ts, logId: { [op]: cursor.logId } }],
      })
    } else if (options.beforeId) {
      // Unknown/expired `before` cursor → "no older entries".
      and.push({ logId: { $in: [] } })
    }
  }
  if (and.length > 0) filter.$and = and
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
