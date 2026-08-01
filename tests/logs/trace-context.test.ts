import { describe, expect, it } from 'vitest'
import { extractTraceId } from '../../src/lib/logs/trace-context'

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = 'b7ad6b7169203331'
const TAB = String.fromCharCode(9)

describe('extractTraceId', () => {
  it('parses the trace ID and the sampled flag out of traceparent', () => {
    expect(extractTraceId({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` })).toEqual({
      traceId: TRACE_ID,
      sampled: true,
    })
  })

  it('reports sampled=false for an unsampled trace', () => {
    expect(extractTraceId({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-00` })).toEqual({
      traceId: TRACE_ID,
      sampled: false,
    })
  })

  it('reads the sampled bit rather than the whole flags byte', () => {
    // 0x03 = sampled + a future flag; 0x02 = that flag alone, not sampled.
    expect(extractTraceId({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-03` })?.sampled).toBe(true)
    expect(extractTraceId({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-02` })?.sampled).toBe(false)
  })

  it('accepts an unknown version with trailing fields, which the spec reserves', () => {
    expect(extractTraceId({ traceparent: `01-${TRACE_ID}-${SPAN_ID}-01-future` })).toEqual({
      traceId: TRACE_ID,
      sampled: true,
    })
  })

  it('rejects version ff, which the spec reserves as invalid', () => {
    expect(extractTraceId({ traceparent: `ff-${TRACE_ID}-${SPAN_ID}-01` })).toBeUndefined()
  })

  it('rejects a version-00 traceparent carrying extra fields', () => {
    expect(extractTraceId({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-01-extra` })).toBeUndefined()
  })

  it('rejects the all-zero trace ID', () => {
    expect(extractTraceId({ traceparent: `00-${'0'.repeat(32)}-${SPAN_ID}-01` })).toBeUndefined()
  })

  it.each([
    ['empty', ''],
    ['not a traceparent at all', 'garbage'],
    ['too few fields', `00-${TRACE_ID}-${SPAN_ID}`],
    ['short trace ID', `00-${TRACE_ID.slice(0, 30)}-${SPAN_ID}-01`],
    ['non-hex trace ID', `00-${'z'.repeat(32)}-${SPAN_ID}-01`],
    ['uppercase trace ID, which the spec forbids', `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`],
    ['short span ID', `00-${TRACE_ID}-${SPAN_ID.slice(0, 8)}-01`],
    ['non-hex flags', `00-${TRACE_ID}-${SPAN_ID}-zz`],
    ['non-hex version', `zz-${TRACE_ID}-${SPAN_ID}-01`],
  ])('ignores a malformed traceparent (%s)', (_label, traceparent) => {
    expect(extractTraceId({ traceparent })).toBeUndefined()
  })

  it('falls back to x-request-id when traceparent is malformed', () => {
    expect(extractTraceId({ traceparent: 'garbage', 'x-request-id': 'req-42' })).toEqual({
      traceId: 'req-42',
    })
  })

  it('prefers traceparent over x-request-id', () => {
    expect(
      extractTraceId({ traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`, 'x-request-id': 'req-42' }),
    ).toEqual({ traceId: TRACE_ID, sampled: true })
  })

  it('uses x-request-id verbatim, with no sampled flag to report', () => {
    const envoyStyle = '2a3f1b6c-9d4e-4a71-8f0b-1c2d3e4f5a6b'
    expect(extractTraceId({ 'x-request-id': envoyStyle })).toEqual({ traceId: envoyStyle })
  })

  it('trims surrounding whitespace on both headers', () => {
    expect(extractTraceId({ traceparent: `  00-${TRACE_ID}-${SPAN_ID}-01  ` })?.traceId).toBe(
      TRACE_ID,
    )
    expect(extractTraceId({ 'x-request-id': '  req-42  ' })?.traceId).toBe('req-42')
  })

  it.each([
    ['blank', '   '],
    ['over-long', 'r'.repeat(201)],
    ['carrying a control character', `req${TAB}42`],
  ])('ignores an x-request-id that is %s', (_label, requestId) => {
    expect(extractTraceId({ 'x-request-id': requestId })).toBeUndefined()
  })

  it('returns undefined when the request carries no trace header at all', () => {
    expect(extractTraceId({ 'content-type': 'application/json' })).toBeUndefined()
    expect(extractTraceId({})).toBeUndefined()
  })

  it('matches header names case-insensitively', () => {
    expect(extractTraceId({ TraceParent: `00-${TRACE_ID}-${SPAN_ID}-01` })?.traceId).toBe(TRACE_ID)
    expect(extractTraceId({ 'X-Request-Id': 'req-42' })?.traceId).toBe('req-42')
  })
})
