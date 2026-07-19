import { describe, expect, it } from 'vitest'
import { parseExpr } from '../../src/lib/mock-engine/expr'
import { evaluate } from '../../src/lib/mock-engine/evaluate'
import { compileFunctions } from '../../src/lib/mock-engine/functions'
import { PlaceholderError, resolveTemplate } from '../../src/lib/mock-engine/template'

const base = {
  ctx: { body: { name: 'bilal' }, pathParams: {}, query: new URLSearchParams(), headers: {} },
  now: new Date('2026-07-18T00:00:00.000Z'),
  fnCtx: { request: { method: 'GET', path: '/', pathParams: {}, query: {}, headers: {}, body: { name: 'bilal' } },
           now: new Date(0), seed: 's' },
  timeoutMs: 100,
}

describe('evaluate with user functions', () => {
  it('dispatches a user function with resolved args', () => {
    const functions = compileFunctions(`export function tag(ctx, who, n) { return who + '#' + n }`, 'f', 'js')
    const v = evaluate(parseExpr('tag:$.name:7'), { ...base, functions })
    expect(v).toBe('bilal#7')
  })

  it('lets a user function read context.request as the escape hatch', () => {
    const functions = compileFunctions(`export function m(ctx) { return ctx.request.method }`, 'f', 'js')
    expect(evaluate(parseExpr('m'), { ...base, functions })).toBe('GET')
  })

  it('prefers a built-in over a user function of the same name is impossible (reserved) — unknown name throws', () => {
    expect(() => evaluate(parseExpr('nope'), { ...base, functions: new Map() })).toThrow(PlaceholderError)
  })

  it('throws PlaceholderError when a call needs fnCtx but none is provided', () => {
    const functions = compileFunctions(`export function tag(ctx) { return 'x' }`, 'f', 'js')
    expect(() => evaluate(parseExpr('tag'), { ctx: base.ctx, now: base.now, functions })).toThrow(
      PlaceholderError,
    )
  })

  it('rejects an undefined return as an unusable function result', () => {
    const functions = compileFunctions(`export function noret() {}`, 'f', 'js')
    expect(() =>
      resolveTemplate('{{noret}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions }),
    ).toThrow(PlaceholderError)
    expect(() =>
      resolveTemplate('{{noret}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions }),
    ).toThrow(/noret/)
  })

  it.each(['NaN', 'Infinity', '-Infinity'])('rejects a %s return as unusable', (literal) => {
    const functions = compileFunctions(`export function n() { return ${literal} }`, 'f', 'js')
    expect(() =>
      resolveTemplate('{{n}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions }),
    ).toThrow(new RegExp(`returned ${literal.replace('-', '-')}`))
  })

  it('tags a thrown user function with the function_error code', () => {
    const functions = compileFunctions(`export function boom() { throw new Error('nope') }`, 'f', 'js')
    try {
      resolveTemplate('{{boom}}', base.ctx, base.now, undefined, { fnCtx: base.fnCtx, functions })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PlaceholderError)
      expect((err as PlaceholderError).code).toBe('function_error')
    }
  })

  it('tags a timed-out user function with the function_timeout code', () => {
    const functions = compileFunctions(`export function spin() { while (true) {} }`, 'f', 'js')
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

  it('emits the raw object for a whole-string object return (#12 extended to function returns)', () => {
    const functions = compileFunctions(`export function obj() { return { a: 1, b: [2, 3] } }`, 'f', 'js')
    const result = resolveTemplate('{{obj}}', base.ctx, base.now, undefined, {
      fnCtx: base.fnCtx,
      functions,
    })
    expect(result).toEqual({ a: 1, b: [2, 3] })
  })

  it('JSON-stringifies an object return when interpolated into surrounding text', () => {
    const functions = compileFunctions(`export function obj() { return { a: 1 } }`, 'f', 'js')
    const result = resolveTemplate('value: {{obj}}', base.ctx, base.now, undefined, {
      fnCtx: base.fnCtx,
      functions,
    })
    expect(result).toBe('value: {"a":1}')
  })
})
