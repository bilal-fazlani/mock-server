import type { ConsoleLogLevel } from '../config'
import { newLogId, type LogEntry, type LogPayload } from '../logs/store'
import { IncomingRequest, routeRequest, RouterDeps, type RouteTrace } from './route-request'

export interface MockHandlerDeps extends RouterDeps {
  /** Fire-and-forget log sink; a failed write never affects the response. */
  writeLog?: (entry: LogEntry) => Promise<void>
  consoleLogLevel?: ConsoleLogLevel
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

    if (shouldLog) {
      writeRequestConsoleLog(deps.consoleLogLevel ?? 'info', {
        incoming,
        status: result.status,
        durationMs,
        trace,
      })
    }

    if (deps.writeLog && shouldLog) {
      const entry = buildLogEntry({
        logId,
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
          deps.consoleLogLevel ?? 'info',
          'warn',
          `[mock-log] failed to write log entry: ${err instanceof Error ? err.message : String(err)}`,
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

function writeRequestConsoleLog(
  configuredLevel: ConsoleLogLevel,
  input: {
    incoming: IncomingRequest
    status: number
    durationMs: number
    trace: RouteTrace
  },
): void {
  const severity = requestConsoleSeverity(input.trace)
  writeConsoleLog(configuredLevel, severity, formatRequestConsoleLine(input))
}

function requestConsoleSeverity(trace: RouteTrace): ConsoleLogLevel {
  if (trace.error?.code === 'no_match') return 'warn'
  if (trace.outcome === 'error') return 'error'
  if (trace.scenarioSource === 'unmocked_policy') return 'warn'
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
  if (trace.validation?.response === 'drift_warning') {
    details.push('validation=response:drift_warning')
  }
  const suffix = details.length > 0 ? ` ${details.join(' ')}` : ''
  return `[mock] ${incoming.method} ${incoming.path}${incoming.search} -> ${status} ${durationMs}ms${suffix}`
}

function writeConsoleLog(
  configuredLevel: ConsoleLogLevel,
  severity: ConsoleLogLevel,
  message: string,
): void {
  if (!shouldWriteConsoleLog(configuredLevel, severity)) return
  if (severity === 'error') console.error(message)
  else if (severity === 'warn') console.warn(message)
  else console.info(message)
}

function shouldWriteConsoleLog(
  configuredLevel: ConsoleLogLevel,
  severity: ConsoleLogLevel,
): boolean {
  const rank: Record<ConsoleLogLevel, number> = { info: 0, warn: 1, error: 2 }
  return rank[severity] >= rank[configuredLevel]
}

function buildLogEntry(input: {
  logId: string
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
