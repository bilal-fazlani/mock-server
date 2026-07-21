import { describe, expect, it } from 'vitest'
import { parseExpr } from '../../src/lib/mock-engine/expr'
import { evaluate, OMIT } from '../../src/lib/mock-engine/evaluate'
import { compileFunctions } from '../../src/lib/mock-engine/functions'
import { PlaceholderError, resolveTemplate } from '../../src/lib/mock-engine/template'

const base = {
  ctx: { body: { name: 'bilal' }, pathParams: {}, query: new URLSearchParams(), headers: {} },
  now: new Date('2026-07-18T00:00:00.000Z'),
  fnCtx: { request: { method: 'GET', path: '/', pathParams: {}, query: {}, headers: {}, body: { name: 'bilal' } },
           now: new Date(0), seed: 's' },
  timeoutMs: 100,
}

describe('omit transform (#24)', () => {
  const at = (body: unknown) => ({ ...base, ctx: { ...base.ctx, body } })

  it('returns OMIT when the source is absent', () => {
    expect(evaluate(parseExpr('$.gone | omit'), at({}))).toBe(OMIT)
  })

  it('passes a present value or a JSON null through unchanged', () => {
    expect(evaluate(parseExpr('$.x | omit'), at({ x: 'v' }))).toBe('v')
    expect(evaluate(parseExpr('$.x | omit'), at({ x: null }))).toBeNull()
    expect(evaluate(parseExpr('$.x | omit'), at({ x: false }))).toBe(false)
  })

  it('absorbs a missing value that travelled through an earlier transform', () => {
    expect(evaluate(parseExpr('$.gone | trim | omit'), at({}))).toBe(OMIT)
  })
})

describe('string transforms (#13)', () => {
  const ctx = {
    body: {
      name: '  Bilal Fazlani  ',
      count: 42,
      flag: true,
      nothing: null,
      user: { id: 1 },
      tags: ['a'],
    },
    pathParams: {},
    query: new URLSearchParams(),
    headers: {},
  }
  const resolve = (tpl: string): unknown => resolveTemplate(tpl, ctx, base.now)

  it('upper, lower, and trim transform a string', () => {
    expect(resolve('{{$.name | upper}}')).toBe('  BILAL FAZLANI  ')
    expect(resolve('{{$.name | lower}}')).toBe('  bilal fazlani  ')
    expect(resolve('{{$.name | trim}}')).toBe('Bilal Fazlani')
  })

  it('chains left to right', () => {
    expect(resolve('{{$.name | trim | upper}}')).toBe('BILAL FAZLANI')
    expect(resolve('{{$.name | upper | trim}}')).toBe('BILAL FAZLANI')
  })

  it('stringifies a number or boolean input', () => {
    expect(resolve('{{$.count | upper}}')).toBe('42')
    expect(resolve('{{$.flag | upper}}')).toBe('TRUE')
    expect(resolve('{{$.count | trim}}')).toBe('42')
  })

  it.each([
    ['{{$.user | upper}}', /cannot transform an object/],
    ['{{$.tags | upper}}', /cannot transform an array/],
    ['{{$.tags | trim}}', /"trim" cannot transform an array/],
  ])('rejects a container input: %s', (tpl, message) => {
    expect(() => resolve(tpl)).toThrow(PlaceholderError)
    expect(() => resolve(tpl)).toThrow(message)
  })

  it('passes a JSON null through untransformed', () => {
    expect(resolve('{{$.nothing | upper}}')).toBe(null)
    expect(resolve('{{$.nothing | trim | upper}}')).toBe(null)
  })

  // The point of the null-skips-transforms rule: order stops mattering, and an
  // absent field and a null field give the same answer in every shape.
  it.each([
    ['{{SEL | default:Guest}}', 'Guest'],
    ['{{SEL | upper | default:Guest}}', 'Guest'],
    ['{{SEL | trim | upper | default:Guest}}', 'Guest'],
    ['{{SEL | default:Guest | upper}}', 'GUEST'],
  ])('treats absence and null identically in %s', (shape, expected) => {
    expect(resolve(shape.replace('SEL', '$.missing'))).toBe(expected)
    expect(resolve(shape.replace('SEL', '$.nothing'))).toBe(expected)
  })

  it('is arity-1, so an extra argument is rejected', () => {
    expect(() => resolve('{{$.name | lower:extra}}')).toThrow(/takes 1 argument/)
  })
})

describe('default transform (#11)', () => {
  const ctx = {
    body: { name: 'bilal', empty: '', nothing: null, flag: false, list: ['a'] },
    pathParams: {},
    query: new URLSearchParams(),
    headers: {},
  }
  const resolve = (tpl: string, over?: Partial<typeof ctx>): unknown =>
    resolveTemplate(tpl, { ...ctx, ...over }, base.now)

  it('returns the resolved value when the selector is present', () => {
    expect(resolve('{{$.name | default:Guest}}')).toBe('bilal')
  })

  it('falls back when the selector is absent', () => {
    expect(resolve('{{$.missing | default:Guest}}')).toBe('Guest')
  })

  it('falls back when the value is JSON null', () => {
    expect(resolve('{{$.nothing | default:Guest}}')).toBe('Guest')
  })

  it('passes an empty string and false through as real values', () => {
    expect(resolve('{{$.empty | default:Guest}}')).toBe('')
    expect(resolve('{{$.flag | default:Guest}}')).toBe(false)
  })

  it('keeps the fallback typed per the #20 grammar', () => {
    expect(resolve('{{$.missing | default:0}}')).toBe(0)
    expect(resolve('{{$.missing | default:true}}')).toBe(true)
    expect(resolve("{{$.missing | default:'N/A'}}")).toBe('N/A')
    expect(resolve("{{$.missing | default:''}}")).toBe('')
  })

  it('accepts another selector as the fallback, and chains', () => {
    expect(resolve('{{$.missing | default:$.name}}')).toBe('bilal')
    expect(resolve("{{$.missing | default:$.alsoMissing | default:'X'}}")).toBe('X')
  })

  it('absorbs a missing value that travelled through an earlier transform', () => {
    expect(resolve('{{$.missing | upper | default:Guest}}')).toBe('Guest')
    expect(resolve('{{$.name | upper | default:Guest}}')).toBe('BILAL')
  })

  it('works for path, query, and header selectors too', () => {
    expect(
      resolveTemplate('{{header:x-request-id | default:none}}', ctx, base.now),
    ).toBe('none')
    expect(resolveTemplate('{{query:q | default:none}}', ctx, base.now)).toBe('none')
  })

  it('interpolates the fallback into surrounding text', () => {
    expect(resolve('Hi {{$.missing | default:Guest}}!')).toBe('Hi Guest!')
  })

  it('resolves an out-of-range array index to the fallback', () => {
    expect(resolve('{{$.list[3] | default:none}}')).toBe('none')
  })

  it('leaves an absent selector without a default a hard failure', () => {
    expect(() => resolve('{{$.missing}}')).toThrow(PlaceholderError)
    expect(() => resolve('{{$.missing | upper}}')).toThrow(/did not resolve/)
    // The message still names the selector, not the whole chain.
    expect(() => resolve('{{$.missing | upper}}')).toThrow(/\{\{\$\.missing\}\}/)
  })

  it('rejects a wrong argument count at evaluation as a backstop', () => {
    expect(() => resolve('{{$.name | default}}')).toThrow(/takes 2 argument/)
    expect(() => resolve('{{$.name | default:a:b}}')).toThrow(/takes 2 argument/)
  })
})

describe('evaluate with user functions', () => {
  it('dispatches a user function with resolved args', () => {
    const functions = compileFunctions(`export function tag(ctx, who, n) { return who + '#' + n }`, 'f')
    const v = evaluate(parseExpr('tag:$.name:7'), { ...base, functions })
    expect(v).toBe('bilal#7')
  })

  it('lets a user function read context.request as the escape hatch', () => {
    const functions = compileFunctions(`export function m(ctx) { return ctx.request.method }`, 'f')
    expect(evaluate(parseExpr('m'), { ...base, functions })).toBe('GET')
  })

  it('prefers a built-in over a user function of the same name is impossible (reserved) — unknown name throws', () => {
    expect(() => evaluate(parseExpr('nope'), { ...base, functions: new Map() })).toThrow(PlaceholderError)
  })

  it('throws PlaceholderError when a call needs fnCtx but none is provided', () => {
    const functions = compileFunctions(`export function tag(ctx) { return 'x' }`, 'f')
    expect(() => evaluate(parseExpr('tag'), { ctx: base.ctx, now: base.now, functions })).toThrow(
      PlaceholderError,
    )
  })

  it('rejects an undefined return as an unusable function result', () => {
    const functions = compileFunctions(`export function noret() {}`, 'f')
    expect(() =>
      resolveTemplate('{{noret}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions }),
    ).toThrow(PlaceholderError)
    expect(() =>
      resolveTemplate('{{noret}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions }),
    ).toThrow(/noret/)
  })

  it.each(['NaN', 'Infinity', '-Infinity'])('rejects a %s return as unusable', (literal) => {
    const functions = compileFunctions(`export function n() { return ${literal} }`, 'f')
    expect(() =>
      resolveTemplate('{{n}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions }),
    ).toThrow(new RegExp(`returned ${literal}`))
  })

  it('tags a thrown user function with the function_error code', () => {
    const functions = compileFunctions(`export function boom() { throw new Error('nope') }`, 'f')
    try {
      resolveTemplate('{{boom}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PlaceholderError)
      expect((err as PlaceholderError).code).toBe('function_error')
    }
  })

  it('tags a timed-out user function with the function_timeout code', () => {
    const functions = compileFunctions(`export function spin() { while (true) {} }`, 'f')
    try {
      resolveTemplate('{{spin}}', base.ctx, base.now, undefined, {
        fnCtx: base.fnCtx,
        functions,
        timeoutMs: 20,
      })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as PlaceholderError).code).toBe('function_timeout')
    }
  })

  it('leaves a plain template failure on the template_error code', () => {
    try {
      resolveTemplate('{{$.missing}}', base.ctx, base.now)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as PlaceholderError).code).toBe('template_error')
    }
  })

  it('passes a JSON null to a user function, unlike absence', () => {
    const functions = compileFunctions(`export function kind(ctx, x) { return x === null ? 'null' : typeof x }`, 'f')
    const ctx = { ...base.ctx, body: { nothing: null } }
    expect(resolveTemplate('{{kind:$.nothing}}', ctx, base.now, undefined, { fnCtx: base.fnCtx, functions })).toBe('null')
    // Absence skips the call entirely, so the default is what renders.
    expect(
      resolveTemplate('{{kind:$.gone | default:skipped}}', ctx, base.now, undefined, {
        fnCtx: base.fnCtx,
        functions,
      }),
    ).toBe('skipped')
  })

  it('never invokes a user function whose argument is an absent selector', () => {
    const functions = compileFunctions(`export function boom(ctx, x) { throw new Error('invoked') }`, 'f')
    const result = resolveTemplate('{{boom:$.nope | default:fallback}}', base.ctx, base.now, undefined, {
      fnCtx: base.fnCtx,
      functions,
    })
    expect(result).toBe('fallback')
  })

  it('emits the raw object for a whole-string object return (#12 extended to function returns)', () => {
    const functions = compileFunctions(`export function obj() { return { a: 1, b: [2, 3] } }`, 'f')
    const result = resolveTemplate('{{obj}}', base.ctx, base.now, undefined, {
      fnCtx: base.fnCtx,
      functions,
    })
    expect(result).toEqual({ a: 1, b: [2, 3] })
  })

  it('JSON-stringifies an object return when interpolated into surrounding text', () => {
    const functions = compileFunctions(`export function obj() { return { a: 1 } }`, 'f')
    const result = resolveTemplate('value: {{obj}}', base.ctx, base.now, undefined, {
      fnCtx: base.fnCtx,
      functions,
    })
    expect(result).toBe('value: {"a":1}')
  })
})
