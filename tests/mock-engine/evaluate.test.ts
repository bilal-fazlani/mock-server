import { describe, expect, it } from 'vitest'
import { parseExpr } from '../../src/lib/mock-engine/expr'
import { evaluate } from '../../src/lib/mock-engine/evaluate'
import { compileFunctions } from '../../src/lib/mock-engine/functions'
import { PlaceholderError } from '../../src/lib/mock-engine/template'

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
})
