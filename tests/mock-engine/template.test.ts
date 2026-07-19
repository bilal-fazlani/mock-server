import { describe, expect, it } from 'vitest'
import type { RequestContext } from '../../src/lib/catalog/selector'
import {
  listPlaceholders,
  PlaceholderError,
  resolveTemplate,
} from '../../src/lib/mock-engine/template'

const now = new Date('2026-07-02T10:20:30.000Z')

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { body: null, pathParams: {}, query: new URLSearchParams(), headers: {}, ...overrides }
}

describe('resolveTemplate', () => {
  it('resolves body, path, and query placeholders in nested structures', () => {
    const c = ctx({
      body: { customerId: 'cus-1' },
      pathParams: { bookingId: 'bk-9' },
      query: new URLSearchParams('lang=en'),
    })
    const result = resolveTemplate(
      {
        customerId: '{{$.customerId}}',
        nested: { booking: 'id={{path:bookingId}}', lang: '{{query:lang}}' },
        list: ['{{$.customerId}}', 42, true, null],
        untouched: 7,
      },
      c,
      now,
    )
    expect(result).toEqual({
      customerId: 'cus-1',
      nested: { booking: 'id=bk-9', lang: 'en' },
      list: ['cus-1', 42, true, null],
      untouched: 7,
    })
  })

  it('echoes request headers into the body and response headers', () => {
    const c = ctx({ headers: { 'X-Request-Id': 'req-42', 'x-tenant': 'acme' } })
    expect(
      resolveTemplate(
        {
          correlationId: '{{header:x-request-id}}',
          tenant: 'tenant={{header:X-Tenant}}',
        },
        c,
        now,
      ),
    ).toEqual({ correlationId: 'req-42', tenant: 'tenant=acme' })
    expect(resolveTemplate({ 'x-request-id': '{{header:x-request-id}}' }, c, now)).toEqual({
      'x-request-id': 'req-42',
    })
  })

  it('fails loudly when an echoed header is absent from the request', () => {
    expect(() => resolveTemplate('{{header:x-request-id}}', ctx(), now)).toThrow(PlaceholderError)
  })

  it('resolves now formatters deterministically from the injected date', () => {
    expect(resolveTemplate('{{now:YYYYMMDD}}', ctx(), now)).toBe('20260702')
    expect(resolveTemplate('{{now:iso}}', ctx(), now)).toBe('2026-07-02T10:20:30.000Z')
  })

  it('resolves now offsets deterministically from the injected date', () => {
    expect(resolveTemplate('{{now+3d:iso}}', ctx(), now)).toBe('2026-07-05T10:20:30.000Z')
    expect(resolveTemplate('{{now-15m:iso}}', ctx(), now)).toBe('2026-07-02T10:05:30.000Z')
    expect(resolveTemplate('{{now+1h:iso}}', ctx(), now)).toBe('2026-07-02T11:20:30.000Z')
    expect(resolveTemplate('{{now+1d:YYYYMMDD}}', ctx(), now)).toBe('20260703')
    expect(resolveTemplate('{{now+0d:iso}}', ctx(), now)).toBe('2026-07-02T10:20:30.000Z')
  })

  it('throws PlaceholderError on malformed now offsets', () => {
    expect(() => resolveTemplate('{{now+3x:iso}}', ctx(), now)).toThrow(PlaceholderError)
    expect(() => resolveTemplate('{{now+:iso}}', ctx(), now)).toThrow(PlaceholderError)
  })

  it('stringifies numeric extracted values inside strings', () => {
    const c = ctx({ body: { n: 7 } })
    expect(resolveTemplate('n is {{$.n}}', c, now)).toBe('n is 7')
  })

  it('throws PlaceholderError naming the placeholder when unresolvable', () => {
    expect(() => resolveTemplate('{{$.missing}}', ctx({ body: {} }), now)).toThrow(
      PlaceholderError,
    )
    expect(() => resolveTemplate('{{$.missing}}', ctx({ body: {} }), now)).toThrow(
      /\{\{\$\.missing\}\}/,
    )
  })

  it('throws PlaceholderError on malformed placeholder expressions', () => {
    expect(() => resolveTemplate('{{now:nope}}', ctx(), now)).toThrow(PlaceholderError)
    expect(() => resolveTemplate('{{banana}}', ctx(), now)).toThrow(PlaceholderError)
  })

  it('emits a raw number when the whole string is a numeric selector (#12)', () => {
    const c = ctx({ body: { amount: 42 } })
    expect(resolveTemplate({ a: '{{$.amount}}' }, c, now)).toEqual({ a: 42 })
  })

  it('coerces to string when interpolated into surrounding text', () => {
    const c = ctx({ body: { amount: 42 } })
    expect(resolveTemplate({ a: 'total: {{$.amount}}' }, c, now)).toEqual({ a: 'total: 42' })
  })

  it('treats adjacent placeholders as interpolation, not a sole placeholder', () => {
    const c = ctx({ body: { first: 'Ada', last: 'Lovelace' } })
    expect(resolveTemplate({ n: '{{$.first}} {{$.last}}' }, c, now)).toEqual({ n: 'Ada Lovelace' })
  })

  it('keeps a whole-string placeholder a string under stringOnly (headers mode)', () => {
    const c = ctx({ body: { amount: 42 } })
    expect(resolveTemplate({ a: '{{$.amount}}' }, c, now, undefined, { stringOnly: true })).toEqual({
      a: '42',
    })
  })

  it('throws PlaceholderError for an unresolved selector', () => {
    expect(() => resolveTemplate({ a: '{{$.missing}}' }, ctx(), now)).toThrow(PlaceholderError)
  })

  it('emits a raw boolean when the whole string is a boolean selector', () => {
    const c = ctx({ body: { isActive: false } })
    expect(resolveTemplate({ a: '{{$.isActive}}' }, c, now)).toEqual({ a: false })
  })

  it('stringifies a boolean extracted value inside surrounding text', () => {
    const c = ctx({ body: { isActive: true } })
    expect(resolveTemplate('active: {{$.isActive}}', c, now)).toBe('active: true')
  })

  it('substitutes a body field that is literally JSON null (present, not missing)', () => {
    const c = ctx({ body: { middleName: null } })
    expect(resolveTemplate({ a: '{{$.middleName}}' }, c, now)).toEqual({ a: null })
    expect(resolveTemplate('mn: {{$.middleName}}', c, now)).toBe('mn: null')
  })

  it('still throws for an absent key, distinguishing it from a present null', () => {
    expect(() => resolveTemplate({ a: '{{$.middleName}}' }, ctx({ body: {} }), now)).toThrow(
      PlaceholderError,
    )
  })

  it('echoes a whole object/array subtree in whole-string position', () => {
    const c = ctx({ body: { user: { name: 'Ada', roles: ['admin'] }, tags: [1, 2] } })
    expect(resolveTemplate({ u: '{{$.user}}' }, c, now)).toEqual({
      u: { name: 'Ada', roles: ['admin'] },
    })
    expect(resolveTemplate({ t: '{{$.tags}}' }, c, now)).toEqual({ t: [1, 2] })
  })

  it('JSON-stringifies a subtree when interpolated into surrounding text', () => {
    const c = ctx({ body: { user: { name: 'Ada' } } })
    expect(resolveTemplate('user: {{$.user}}', c, now)).toBe('user: {"name":"Ada"}')
  })

  it('applies a built-in transform through a pipe', () => {
    const c = ctx({ body: { name: 'bilal' } })
    expect(resolveTemplate({ n: '{{$.name | upper}}' }, c, now)).toEqual({ n: 'BILAL' })
  })

  it('errors on an unknown function name at resolve time', () => {
    expect(() => resolveTemplate({ n: '{{$.name | bogus}}' }, ctx({ body: { name: 'x' } }), now))
      .toThrow(PlaceholderError)
  })
})

describe('listPlaceholders', () => {
  it('collects every placeholder expression in a structure', () => {
    const found = listPlaceholders({
      a: '{{$.x}}',
      b: ['{{now:iso}}', { c: 'pre {{path:p}} post' }],
      d: 12,
    })
    expect(found.sort()).toEqual(['$.x', 'now:iso', 'path:p'])
  })
})
