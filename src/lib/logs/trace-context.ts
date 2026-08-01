/**
 * Inbound trace correlation, read off the incoming request at the edge.
 *
 * The mock server mints no spans and talks to no tracing backend — it only
 * borrows the caller's trace ID so its own log lines can be joined against the
 * traced services around it. Everything here is diagnostic metadata: a
 * malformed value is ignored, never surfaced as an error, and never affects the
 * response.
 *
 * The field's shape is deliberately one line long, because its whole job is to
 * be pasted between tools: `traceId` is always 32 lowercase hex, or it is a
 * caller-supplied request ID.
 */

export interface TraceContext {
  /** 32 lowercase hex from `traceparent`, or an `x-request-id` verbatim. */
  traceId: string
  /**
   * The `traceparent` sampled flag. Absent when the ID came from
   * `x-request-id`, which carries no such notion. `false` explains the
   * otherwise-confusing case where this trace ID is in the mock server's logs
   * but the trace itself never reached the tracing backend.
   */
  sampled?: boolean
}

const HEX_2 = /^[0-9a-f]{2}$/
const HEX_16 = /^[0-9a-f]{16}$/
const HEX_32 = /^[0-9a-f]{32}$/
const ALL_ZERO_TRACE_ID = '0'.repeat(32)
const MAX_REQUEST_ID_LENGTH = 200

/**
 * `traceparent` first, then `x-request-id` — a mesh (Envoy, and Istio's
 * guidance) generates the latter even where nothing is W3C-instrumented. A
 * malformed `traceparent` falls through to `x-request-id` rather than failing
 * outright. Returns undefined when neither header yields a usable ID; no
 * synthetic ID is minted, because one would join with nothing.
 */
export function extractTraceId(headers: Record<string, string>): TraceContext | undefined {
  const fromTraceparent = parseTraceparent(headerValue(headers, 'traceparent'))
  if (fromTraceparent) return fromTraceparent
  const requestId = parseRequestId(headerValue(headers, 'x-request-id'))
  return requestId === undefined ? undefined : { traceId: requestId }
}

/**
 * `version-traceId-parentId-flags`, e.g.
 * `00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01`. The spec mandates
 * lowercase hex, so an uppercase value is malformed rather than normalised.
 */
function parseTraceparent(raw: string | undefined): TraceContext | undefined {
  if (raw === undefined) return undefined
  const fields = raw.trim().split('-')
  if (fields.length < 4) return undefined
  const [version, traceId, parentId, flags] = fields
  // `ff` is reserved as invalid. Other unknown versions are accepted: the spec
  // reserves the right to append fields, and the first four keep their meaning,
  // so only version 00 is held to an exact field count.
  if (!HEX_2.test(version) || version === 'ff') return undefined
  if (version === '00' && fields.length !== 4) return undefined
  if (!HEX_32.test(traceId) || traceId === ALL_ZERO_TRACE_ID) return undefined
  // The parent span ID is validated for shape but not kept — see the issue's
  // note on why no `mock.parentSpanId` is recorded.
  if (!HEX_16.test(parentId)) return undefined
  if (!HEX_2.test(flags)) return undefined
  return { traceId, sampled: (Number.parseInt(flags, 16) & 0b1) === 0b1 }
}

/** Used verbatim: it is an opaque caller-supplied ID, not a parsed format. */
function parseRequestId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value.length === 0 || value.length > MAX_REQUEST_ID_LENGTH) return undefined
  if (hasControlChars(value)) return undefined
  return value
}

/** A control character means the value is mangled; it must not reach a log line. */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

// Header names arrive lowercased from `Headers`, but this is a pure function
// callable with any record, so the fallback scan keeps it honest.
function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const direct = headers[name]
  if (direct !== undefined) return direct
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return undefined
}
