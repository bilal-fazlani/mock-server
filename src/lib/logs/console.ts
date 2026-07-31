import { BUILD_INFO } from '../build-info'
import {
  parseConsoleLogLevel,
  parseLogFormat,
  type ConsoleLogLevel,
  type LogFormat,
} from '../config'

/** `service.name` on every JSON line: the product, not the npm package name. */
export const SERVICE_NAME = 'mock-server'

export interface ConsoleLogOptions {
  /** Threshold to compare the severity against. Defaults to MOCK_CONSOLE_LOG_LEVEL. */
  level?: ConsoleLogLevel
  /** Serialization. Defaults to MOCK_LOG_FORMAT. */
  format?: LogFormat
  /**
   * Structured fields for the JSON line, as flat dotted ECS keys
   * (`http.request.method`, `mock.scenario`). Dropped entirely in text format,
   * where `message` is the whole line. Entries with an `undefined` value are
   * omitted rather than emitted as null.
   */
  fields?: Record<string, unknown>
  /** Line timestamp. Defaults to now. */
  ts?: Date
}

/**
 * The single choke point for everything this server prints. Both formats go
 * through here so the severity threshold is applied identically, and so a
 * `MOCK_LOG_FORMAT=json` stream has no stray human-readable lines in it.
 */
export function writeConsoleLog(
  severity: ConsoleLogLevel,
  message: string,
  options: ConsoleLogOptions = {},
): void {
  const level = options.level ?? envConsoleLogLevel()
  if (!shouldWriteConsoleLog(level, severity)) return
  const format = options.format ?? envLogFormat()
  const line =
    format === 'json' ? formatJsonLine(severity, message, options.fields, options.ts) : message
  if (severity === 'error') console.error(line)
  else if (severity === 'warn') console.warn(line)
  else console.info(line)
}

/**
 * One ECS-style object per line. `@timestamp`, `log.level`, and `message` lead
 * because Kibana and Datadog both treat those three specially; `message` keeps
 * the human one-liner so a JSON stream is still readable by eye.
 */
export function formatJsonLine(
  severity: ConsoleLogLevel,
  message: string,
  fields: Record<string, unknown> = {},
  ts: Date = new Date(),
): string {
  const line: Record<string, unknown> = {
    '@timestamp': ts.toISOString(),
    'log.level': severity,
    message,
    'service.name': SERVICE_NAME,
    'service.version': BUILD_INFO.version,
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) line[key] = value
  }
  return JSON.stringify(line)
}

export function shouldWriteConsoleLog(
  configuredLevel: ConsoleLogLevel,
  severity: ConsoleLogLevel,
): boolean {
  const rank: Record<ConsoleLogLevel, number> = { info: 0, warn: 1, error: 2 }
  return rank[severity] >= rank[configuredLevel]
}

// Call sites outside the request path (catalog warnings, the embedded-mongo
// notice, background sweeps) have no injected config, so they read the env
// directly. A bad value is already startup-fatal at the runtime gate; falling
// back to the default here keeps logging itself from ever throwing — including
// in the window before that gate runs.
function envConsoleLogLevel(): ConsoleLogLevel {
  try {
    return parseConsoleLogLevel(process.env.MOCK_CONSOLE_LOG_LEVEL)
  } catch {
    return 'info'
  }
}

function envLogFormat(): LogFormat {
  try {
    return parseLogFormat(process.env.MOCK_LOG_FORMAT)
  } catch {
    return 'text'
  }
}
