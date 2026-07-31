import { describe, expect, it } from 'vitest'
import { Faker, en } from '@faker-js/faker'
import type { RequestContext } from '../../src/lib/catalog/selector'
import {
  fnv1a32,
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

  describe('omit (#24)', () => {
    it('drops an object key whose source is absent, keeps present and null values', () => {
      const c = ctx({ body: { id: 'x', nick: 'Q', middle: null } })
      expect(
        resolveTemplate(
          {
            id: '{{$.id | omit}}',
            nick: '{{$.nick | omit}}',
            middle: '{{$.middle | omit}}',
            absent: '{{$.gone | omit}}',
          },
          c,
          now,
        ),
      ).toEqual({ id: 'x', nick: 'Q', middle: null })
    })

    it('mirrors an absent field as a dropped key but a null field as null (merge-patch shape)', () => {
      const drop = resolveTemplate({ a: '{{$.a | omit}}' }, ctx({ body: {} }), now)
      const keep = resolveTemplate({ a: '{{$.a | omit}}' }, ctx({ body: { a: null } }), now)
      expect(drop).toEqual({})
      expect('a' in (keep as object)).toBe(true)
      expect((keep as { a: unknown }).a).toBeNull()
    })

    it('drops a response header when its source is absent (stringOnly path)', () => {
      const c = ctx({ headers: { 'x-tenant': 'acme' } })
      expect(
        resolveTemplate(
          { 'x-tenant': '{{header:x-tenant | omit}}', 'x-trace': '{{header:x-trace | omit}}' },
          c,
          now,
          undefined,
          { stringOnly: true },
        ),
      ).toEqual({ 'x-tenant': 'acme' })
    })

    it('composes with an upstream transform: present value transformed, absent dropped', () => {
      const c = ctx({ body: { name: '  bo  ' } })
      expect(
        resolveTemplate({ name: '{{$.name | trim | omit}}', mid: '{{$.mid | trim | omit}}' }, c, now),
      ).toEqual({ name: 'bo' })
    })

    it('records a dropped placeholder in the resolutions trace', () => {
      const res: Record<string, string> = {}
      resolveTemplate({ a: '{{$.gone | omit}}' }, ctx({ body: {} }), now, res)
      expect(res['{{$.gone | omit}}']).toBe('(omitted)')
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

  it('resolves {{uuid}} from the injected generator', () => {
    const uuid = (): string => '11111111-2222-4333-8444-555555555555'
    expect(resolveTemplate('{{uuid}}', ctx(), now, undefined, { uuid })).toBe(
      '11111111-2222-4333-8444-555555555555',
    )
    expect(resolveTemplate('id: {{uuid}}', ctx(), now, undefined, { uuid })).toBe(
      'id: 11111111-2222-4333-8444-555555555555',
    )
    expect(resolveTemplate({ id: '{{uuid | upper}}' }, ctx(), now, undefined, { uuid })).toEqual({
      id: '11111111-2222-4333-8444-555555555555'.toUpperCase(),
    })
  })

  it('draws a fresh {{uuid}} for every occurrence', () => {
    let n = 0
    const uuid = (): string => `uuid-${++n}`
    expect(
      resolveTemplate({ items: [{ id: '{{uuid}}' }, { id: '{{uuid}}' }] }, ctx(), now, undefined, {
        uuid,
      }),
    ).toEqual({ items: [{ id: 'uuid-1' }, { id: 'uuid-2' }] })
  })

  it('defaults {{uuid}} to crypto.randomUUID when no generator is injected', () => {
    const value = resolveTemplate('{{uuid}}', ctx(), now)
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(resolveTemplate('{{uuid}}', ctx(), now)).not.toBe(value)
  })

  it('makes every {{uuid:group}} sharing a name render one value, keeping others distinct (#36)', () => {
    let n = 0
    const uuid = (): string => `uuid-${++n}`
    const uuidGroups = new Map<string, string>()
    expect(
      resolveTemplate(
        {
          bookingId: '{{uuid:booking}}',
          auditId: '{{uuid}}',
          legs: [
            { id: '{{uuid}}', bookingId: '{{uuid:booking}}' },
            { id: '{{uuid}}', bookingId: '{{uuid:booking}}' },
          ],
        },
        ctx(),
        now,
        undefined,
        { uuid, uuidGroups },
      ),
    ).toEqual({
      bookingId: 'uuid-1',
      auditId: 'uuid-2',
      legs: [
        { id: 'uuid-3', bookingId: 'uuid-1' },
        { id: 'uuid-4', bookingId: 'uuid-1' },
      ],
    })
  })

  it('shares a group across separate body and header renders via one uuidGroups map (#36)', () => {
    let n = 0
    const uuid = (): string => `uuid-${++n}`
    const uuidGroups = new Map<string, string>()
    const body = resolveTemplate({ bookingId: '{{uuid:booking}}' }, ctx(), now, undefined, {
      uuid,
      uuidGroups,
    })
    const location = resolveTemplate('/bookings/{{uuid:booking}}', ctx(), now, undefined, {
      uuid,
      uuidGroups,
      stringOnly: true,
    })
    expect(body).toEqual({ bookingId: 'uuid-1' })
    expect(location).toBe('/bookings/uuid-1')
  })

  it('keys a group by String(value): {{uuid:1}} and {{uuid:\'1\'}} agree; {{uuid:}} is its own group (#36)', () => {
    let n = 0
    const uuid = (): string => `uuid-${++n}`
    const uuidGroups = new Map<string, string>()
    expect(
      resolveTemplate(
        { numeric: '{{uuid:1}}', quoted: "{{uuid:'1'}}", empty: '{{uuid:}}', bare: '{{uuid}}' },
        ctx(),
        now,
        undefined,
        { uuid, uuidGroups },
      ),
    ).toEqual({ numeric: 'uuid-1', quoted: 'uuid-1', empty: 'uuid-2', bare: 'uuid-3' })
  })

  it('gives each request a fresh group value when the uuidGroups map is not shared (#36)', () => {
    let n = 0
    const uuid = (): string => `uuid-${++n}`
    const render = (): unknown =>
      resolveTemplate({ id: '{{uuid:booking}}' }, ctx(), now, undefined, {
        uuid,
        uuidGroups: new Map<string, string>(),
      })
    expect(render()).toEqual({ id: 'uuid-1' })
    expect(render()).toEqual({ id: 'uuid-2' })
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

describe('fnv1a32 (#15)', () => {
  it('is deterministic for the same input', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'))
  })

  it('differs for different inputs', () => {
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'))
  })

  it('always returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('some fairly long string used to derive a seed')
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('seeded faker built-in (#15)', () => {
  const render = (node: unknown, seedMaterial: string, prefix = 'body') =>
    resolveTemplate(node, ctx(), now, undefined, {
      faker: new Faker({ locale: [en] }),
      seedMaterial,
      pathPrefix: prefix,
    })

  it('is reproducible for the same (seedMaterial, path) and varies across callers', () => {
    const a1 = render({ name: '{{faker:person.fullName}}' }, 'p-1:getUser')
    const a2 = render({ name: '{{faker:person.fullName}}' }, 'p-1:getUser')
    const b = render({ name: '{{faker:person.fullName}}' }, 'p-2:getUser')
    expect(a1).toEqual(a2)
    expect(a1).not.toEqual(b)
  })

  it('keeps a value stable when an unrelated placeholder is added elsewhere (Model B)', () => {
    const before = render({ id: '{{faker:string.uuid}}' }, 's:e') as { id: string }
    const after = render(
      { added: '{{faker:person.firstName}}', id: '{{faker:string.uuid}}' },
      's:e',
    ) as { id: string }
    expect(after.id).toBe(before.id)
  })

  it('derives distinct seeds for array elements and object keys by path', () => {
    const result = render(
      { legs: ['{{faker:string.uuid}}', '{{faker:string.uuid}}'] },
      'p:e',
    ) as { legs: string[] }
    expect(result.legs[0]).not.toBe(result.legs[1])
  })

  it('threads pathPrefix so headers and body seed independently even with the same seedMaterial', () => {
    const bodyResult = render({ id: '{{faker:string.uuid}}' }, 'p:e', 'body') as { id: string }
    const headerResult = render({ id: '{{faker:string.uuid}}' }, 'p:e', 'headers') as { id: string }
    expect(headerResult.id).not.toBe(bodyResult.id)
  })
})
