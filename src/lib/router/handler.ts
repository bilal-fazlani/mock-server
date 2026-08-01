import type { ConsoleLogLevel, LogFormat } from '../config'
import { writeConsoleLog } from '../logs/console'
import { newLogId, type LogEntry, type LogPayload } from '../logs/store'
import { extractTraceId, type TraceContext } from '../logs/trace-context'
import { IncomingRequest, routeRequest, RouterDeps, type RouteTrace } from './route-request'

export interface MockHandlerDeps extends RouterDeps {
  /** Fire-and-forget log sink; a failed write never affects the response. */
  writeLog?: (entry: LogEntry) => Promise<void>
  consoleLogLevel?: ConsoleLogLevel
  logFormat?: LogFormat
}

const MAX_LOGGED_BODY_BYTES = 16 * 1024

export function createMockHandler(deps: MockHandlerDeps) {
  return async function handle(request: Request, pathSegments: string[]): Promise<Response> {
    const url = new URL(request.url)
    const raw = Buffer.from(await request.arrayBuffer())
    const incoming: IncomingRequest = {
      method: request.method,
      path: '/' + pathSegments.join('/'),
      search: url.search,
      headers: Object.fromEntries(request.headers),
      rawBody: raw.length > 0 ? raw : null,
    }
    const logId = newLogId()
    const ts = new Date()
    const startedAt = Date.now()
    const trace: RouteTrace = {}
    const result = await routeRequest(incoming, { ...deps, trace })
    const durationMs = Date.now() - startedAt
    const shouldLog = shouldWriteRequestLog(incoming.path)
    const headers = shouldLog ? { ...result.headers, 'x-mock-log-id': logId } : result.headers
    // Read at the edge, not threaded through RouteTrace: the caller's trace ID
    // is known before routing starts and is not a routing decision.
    const traceContext = shouldLog ? extractTraceId(incoming.headers) : undefined

    if (shouldLog) {
      writeRequestConsoleLog({
        level: deps.consoleLogLevel ?? 'info',
        format: deps.logFormat,
        logId,
        traceContext,
        ts,
        incoming,
        status: result.status,
        durationMs,
        trace,
      })
    }

    if (deps.writeLog && shouldLog) {
      const entry = buildLogEntry({
        logId,
        traceId: traceContext?.traceId,
        ts,
        durationMs,
        incoming,
        status: result.status,
        responseHeaders: headers,
        responseBytes: result.bodyBytes,
        trace,
      })
      void deps.writeLog(entry).catch((err) => {
        writeConsoleLog(
          'warn',
          `[mock-log] failed to write log entry: ${err instanceof Error ? err.message : String(err)}`,
          {
            level: deps.consoleLogLevel ?? 'info',
            format: deps.logFormat,
            fields: { 'mock.logId': logId },
          },
        )
      })
    }

    return new Response(new Uint8Array(result.bodyBytes), {
      status: result.status,
      headers,
    })
  }
}

function shouldWriteRequestLog(path: string): boolean {
  return !path.startsWith('/_next/')
}

interface RequestConsoleLog {
  level: ConsoleLogLevel
  format: LogFormat | undefined
  logId: string
  traceContext: TraceContext | undefined
  ts: Date
  incoming: IncomingRequest
  status: number
  durationMs: number
  trace: RouteTrace
}

function writeRequestConsoleLog(input: RequestConsoleLog): void {
  writeConsoleLog(requestConsoleSeverity(input.trace), formatRequestConsoleLine(input), {
    level: input.level,
    format: input.format,
    ts: input.ts,
    fields: requestConsoleFields(input),
  })
}

/**
 * The console line's structured form: ECS names for anything a log aggregator
 * already understands, and a `mock.*` namespace for everything domain-specific
 * so it cannot collide with other services sharing an index. Two names are
 * deliberate: the HTTP status is never a top-level `status` (Datadog's remapper
 * reads that as the log severity), and `event.duration` is in nanoseconds
 * because that is the unit ECS defines for it — every `mock.*` duration carries
 * its unit in the name instead.
 *
 * Metadata only — bodies and headers stay in Mongo. If that ever changes,
 * `redactSensitiveHeaders` has to move out of `buildLogEntry` and be shared;
 * today it guards only the Mongo path.
 */
function requestConsoleFields(input: RequestConsoleLog): Record<string, unknown> {
  const { incoming, status, durationMs, trace } = input
  return {
    'http.request.method': incoming.method,
    'url.path': incoming.path,
    // ECS stores url.query without the leading "?"; omitted when there is none.
    'url.query': incoming.search ? incoming.search.slice(1) : undefined,
    'http.response.status_code': status,
    'event.duration': durationMs * 1_000_000,
    // The caller's trace ID under the ECS name both Kibana and Datadog already
    // recognise, so a mock-server line joins the rest of the distributed trace
    // with no aggregator configuration. Omitted when the request carried none.
    'trace.id': input.traceContext?.traceId,
    'mock.logId': input.logId,
    'mock.traceSampled': input.traceContext?.sampled,
    'mock.system': trace.system,
    'mock.endpoint': trace.endpoint,
    'mock.profileId': trace.profileId,
    'mock.scenario': trace.scenario,
    'mock.scenarioSource': trace.scenarioSource,
    'mock.outcome': trace.outcome,
    'mock.delayMs': trace.delayMs,
    'mock.validation.request': trace.validation?.request,
    'mock.validation.response': trace.validation?.response,
    'mock.error.code': trace.error?.code,
    'mock.upstream.status': trace.upstream?.status,
    'mock.upstream.durationMs': trace.upstream?.durationMs,
  }
}

function requestConsoleSeverity(trace: RouteTrace): ConsoleLogLevel {
  if (trace.error?.code === 'no_match') return 'warn'
  if (trace.outcome === 'error') return 'error'
  if (trace.scenarioSource === 'unmocked_policy') return 'warn'
  if (trace.validation?.request === 'drift_warning') return 'warn'
  if (trace.validation?.response === 'drift_warning') return 'warn'
  return 'info'
}

function formatRequestConsoleLine(input: {
  incoming: IncomingRequest
  status: number
  durationMs: number
  trace: RouteTrace
}): string {
  const { incoming, status, durationMs, trace } = input
  const details: string[] = []
  if (trace.system && trace.endpoint) details.push(`${trace.system}/${trace.endpoint}`)
  if (trace.profileId) details.push(`profile=${trace.profileId}`)
  if (trace.scenario) details.push(`scenario=${trace.scenario}`)
  if (trace.scenarioSource === 'unmocked_policy') details.push('source=unmocked_policy')
  if (trace.outcome) details.push(`outcome=${trace.outcome}`)
  if (trace.delayMs !== undefined) details.push(`delay=${trace.delayMs}ms`)
  if (trace.error) details.push(`error=${trace.error.code}`)
  if (trace.validation?.request === 'drift_warning') {
    details.push('validation=request:drift_warning')
  }
  if (trace.validation?.response === 'drift_warning') {
    details.push('validation=response:drift_warning')
  }
  const suffix = details.length > 0 ? ` ${details.join(' ')}` : ''
  return `[mock] ${incoming.method} ${incoming.path}${incoming.search} -> ${status} ${durationMs}ms${suffix}`
}

function buildLogEntry(input: {
  logId: string
  traceId: string | undefined
  ts: Date
  durationMs: number
  incoming: IncomingRequest
  status: number
  responseHeaders: Record<string, string>
  responseBytes: Buffer
  trace: RouteTrace
}): LogEntry {
  const { system, endpoint, profileId, outcome, error, ...traceData } = input.trace
  return {
    logId: input.logId,
    ...(input.traceId !== undefined && { traceId: input.traceId }),
    ts: input.ts,
    durationMs: input.durationMs,
    kind: 'request',
    ...(profileId !== undefined && { profileId }),
    ...(system !== undefined && { system }),
    ...(endpoint !== undefined && { endpoint }),
    method: input.incoming.method,
    path: input.incoming.path,
    query: input.incoming.search,
    request: loggedPayload(redactSensitiveHeaders(input.incoming.headers), input.incoming.rawBody),
    response: {
      status: input.status,
      ...loggedPayload(input.responseHeaders, input.responseBytes),
    },
    ...(outcome !== undefined && { outcome }),
    ...(error !== undefined && { error }),
    trace: traceData,
  }
}

function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      name.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
    ]),
  )
}

function loggedPayload(headers: Record<string, string>, raw: Buffer | null): LogPayload {
  if (!raw || raw.length === 0) return { headers, body: null, truncated: false }
  const text = raw.toString('utf8')
  if (raw.length > MAX_LOGGED_BODY_BYTES) {
    return { headers, body: text.slice(0, MAX_LOGGED_BODY_BYTES), truncated: true }
  }
  try {
    return { headers, body: JSON.parse(text), truncated: false }
  } catch {
    return { headers, body: text, truncated: false }
  }
}
