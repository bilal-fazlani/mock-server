import { describe, expect, it } from 'vitest'
import {
  extractValue,
  extractProfileIdValue,
  parseProfileIdSelector,
  parseSelector,
  RequestContext,
  SelectorParseError,
} from '../../src/lib/catalog/selector'

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { body: null, pathParams: {}, query: new URLSearchParams(), headers: {}, ...overrides }
}

describe('parseSelector', () => {
  it('parses body selectors under the pinned subset', () => {
    expect(parseSelector('$.customerId')).toEqual({ source: 'body', segments: ['customerId'] })
    expect(parseSelector('$.customer.id')).toEqual({ source: 'body', segments: ['customer', 'id'] })
    expect(parseSelector('$.items[0].customerId')).toEqual({
      source: 'body',
      segments: ['items', 0, 'customerId'],
    })
  })

  it('parses path and query selectors', () => {
    expect(parseSelector('path:customerId')).toEqual({ source: 'path', name: 'customerId' })
    expect(parseSelector('query:cid')).toEqual({ source: 'query', name: 'cid' })
  })

  it('parses profile key selectors with body, path, and query nested selectors', () => {
    expect(parseSelector('profileKey:event-id:$.eventID')).toEqual({
      source: 'profileKey',
      namespace: 'event-id',
      keySelector: { source: 'body', segments: ['eventID'] },
    })
    expect(parseSelector('profileKey:event-id:path:eventId')).toEqual({
      source: 'profileKey',
      namespace: 'event-id',
      keySelector: { source: 'path', name: 'eventId' },
    })
    expect(parseSelector('profileKey:event-id:query:eventId')).toEqual({
      source: 'profileKey',
      namespace: 'event-id',
      keySelector: { source: 'query', name: 'eventId' },
    })
  })

  it('rejects invalid profile key selector shapes', () => {
    for (const bad of [
      'profileKey:EventID:$.eventID',
      'profileKey:-event-id:$.eventID',
      'profileKey:event-id:',
      'profileKey:event-id:header:eventID',
      'profileKey:event-id:profileKey:other-id:$.eventID',
    ]) {
      expect(() => parseSelector(bad), bad).toThrow(SelectorParseError)
    }
  })

  it('rejects everything outside the pinned subset', () => {
    for (const bad of [
      '$',
      '$.',
      '$..a',
      '$.a[*]',
      '$.a[?(@.x)]',
      'customerId',
      '$[a]',
      'path:',
      'query:',
      '$.a.',
      'header:x',
      'bearer',
      'bearer:sub',
    ]) {
      expect(() => parseSelector(bad), bad).toThrow(SelectorParseError)
    }
  })
})

describe('parseProfileIdSelector', () => {
  it('parses opaque bearer tokens and top-level JWT claims', () => {
    expect(parseProfileIdSelector('bearer')).toEqual({ source: 'bearer' })
    expect(parseProfileIdSelector('bearer:sub')).toEqual({ source: 'bearer', claim: 'sub' })
    expect(parseProfileIdSelector('$.customerId')).toEqual({
      source: 'body',
      segments: ['customerId'],
    })
  })

  it('rejects malformed bearer selectors', () => {
    for (const bad of ['bearer:', 'bearer:sub.name', 'bearer:two:claims']) {
      expect(() => parseProfileIdSelector(bad), bad).toThrow(SelectorParseError)
    }
  })
})

describe('extractValue', () => {
  it('extracts nested body fields and array indices as found values', () => {
    const c = ctx({ body: { customer: { id: 'cus-1' }, items: [{ n: 7 }] } })
    expect(extractValue(parseSelector('$.customer.id'), c)).toEqual({ found: true, value: 'cus-1' })
    expect(extractValue(parseSelector('$.items[0].n'), c)).toEqual({ found: true, value: 7 })
  })

  it('carries booleans, JSON null, objects, and arrays as found values', () => {
    const c = ctx({ body: { active: false, missing: null, user: { name: 'x' }, tags: [1, 2] } })
    expect(extractValue(parseSelector('$.active'), c)).toEqual({ found: true, value: false })
    expect(extractValue(parseSelector('$.missing'), c)).toEqual({ found: true, value: null })
    expect(extractValue(parseSelector('$.user'), c)).toEqual({ found: true, value: { name: 'x' } })
    expect(extractValue(parseSelector('$.tags'), c)).toEqual({ found: true, value: [1, 2] })
  })

  it('reports found:false only when the path is genuinely absent', () => {
    const c = ctx({ body: { b: {}, c: [] } })
    expect(extractValue(parseSelector('$.nope'), c)).toEqual({ found: false })
    expect(extractValue(parseSelector('$.nope.deeper'), c)).toEqual({ found: false })
    expect(extractValue(parseSelector('$.b[0]'), c)).toEqual({ found: false })
    expect(extractValue(parseSelector('$.c[3]'), c)).toEqual({ found: false })
  })

  it('extracts from path params and query params (no body required)', () => {
    const c = ctx({
      pathParams: { customerId: 'cus-9' },
      query: new URLSearchParams('cid=q-1'),
    })
    expect(extractValue(parseSelector('path:customerId'), c)).toEqual({ found: true, value: 'cus-9' })
    expect(extractValue(parseSelector('query:cid'), c)).toEqual({ found: true, value: 'q-1' })
    expect(extractValue(parseSelector('path:other'), c)).toEqual({ found: false })
    expect(extractValue(parseSelector('query:other'), c)).toEqual({ found: false })
  })

  it('extracts the nested key value from profile key selectors', () => {
    const c = ctx({
      body: { eventID: 'evt-body' },
      pathParams: { eventId: 'evt-path' },
      query: new URLSearchParams('eventId=evt-query'),
    })

    expect(extractValue(parseSelector('profileKey:event-id:$.eventID'), c)).toEqual({
      found: true,
      value: 'evt-body',
    })
    expect(extractValue(parseSelector('profileKey:event-id:path:eventId'), c)).toEqual({
      found: true,
      value: 'evt-path',
    })
    expect(extractValue(parseSelector('profileKey:event-id:query:eventId'), c)).toEqual({
      found: true,
      value: 'evt-query',
    })
  })
})

describe('extractProfileIdValue', () => {
  it('extracts an opaque token from a case-insensitive Bearer header', () => {
    expect(
      extractProfileIdValue(
        parseProfileIdSelector('bearer'),
        ctx({ headers: { Authorization: 'bEaReR customer-123' } }),
      ),
    ).toBe('customer-123')
  })

  it('extracts a scalar top-level JWT claim without verifying the token', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'customer-123', customer_no: 42 })).toString(
      'base64url',
    )
    const headers = { authorization: `Bearer header.${payload}.signature` }
    expect(extractProfileIdValue(parseProfileIdSelector('bearer:sub'), ctx({ headers }))).toBe(
      'customer-123',
    )
    expect(
      extractProfileIdValue(parseProfileIdSelector('bearer:customer_no'), ctx({ headers })),
    ).toBe(42)
  })

  it('returns null for missing, malformed, non-Bearer, and unresolved JWT claims', () => {
    const payload = Buffer.from(JSON.stringify({ nested: {}, enabled: true })).toString('base64url')
    const selectorsAndHeaders: Array<[string, Record<string, string>]> = [
      ['bearer', {}],
      ['bearer', { authorization: 'Basic abc' }],
      ['bearer', { authorization: 'Bearer token with spaces' }],
      ['bearer:sub', { authorization: 'Bearer not-a-jwt' }],
      ['bearer:sub', { authorization: `Bearer header.${payload}.signature` }],
    ]
    for (const [raw, headers] of selectorsAndHeaders) {
      expect(extractProfileIdValue(parseProfileIdSelector(raw), ctx({ headers })), raw).toBeNull()
    }
  })
})
