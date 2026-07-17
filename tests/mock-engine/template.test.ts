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
