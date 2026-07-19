import { describe, expect, it } from 'vitest'
import {
  compileFunctions, FunctionRuntimeError, FunctionTimeoutError, FunctionCompileError, FnContext,
} from '../../src/lib/mock-engine/functions'

const ctx: FnContext = {
  request: { method: 'GET', path: '/x', pathParams: {}, query: {}, headers: {}, body: { name: 'bilal' } },
  now: new Date('2026-07-18T00:00:00.000Z'),
  seed: 'p:end',
}

describe('compileFunctions', () => {
  it('compiles named exports into callable functions', () => {
    const fns = compileFunctions(
      `export function label(ctx, tier) { return tier + ':' + ctx.request.body.name }`,
      '_functions.mjs',
    )
    expect(fns.get('label')!.invoke(ctx, ['gold'], 100)).toBe('gold:bilal')
  })

  it('can return a typed non-string value', () => {
    const fns = compileFunctions(`export function two() { return 2 }`, 'f')
    expect(fns.get('two')!.invoke(ctx, [], 100)).toBe(2)
  })

  it('wraps a throwing function as FunctionRuntimeError', () => {
    const fns = compileFunctions(`export function boom() { throw new Error('nope') }`, 'f')
    expect(() => fns.get('boom')!.invoke(ctx, [], 100)).toThrow(FunctionRuntimeError)
  })

  it('enforces the timeout', () => {
    const fns = compileFunctions(`export function spin() { while (true) {} }`, 'f')
    expect(() => fns.get('spin')!.invoke(ctx, [], 20)).toThrow(FunctionTimeoutError)
  })

  it('has no host globals in the sandbox', () => {
    const fns = compileFunctions(`export function leak() { return typeof process }`, 'f')
    expect(fns.get('leak')!.invoke(ctx, [], 100)).toBe('undefined')
  })

  it('rejects a syntactically broken source', () => {
    expect(() => compileFunctions(`export function (`, 'f')).toThrow(FunctionCompileError)
  })

  // .mjs is the only authoring format (#26): TS syntax must fail transpile
  // loudly rather than be silently stripped.
  it('rejects TypeScript syntax', () => {
    expect(() =>
      compileFunctions(`export function label(ctx: any): string { return 'x' }`, 'f'),
    ).toThrow(FunctionCompileError)
  })
})
