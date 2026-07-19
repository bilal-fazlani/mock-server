import { describe, expect, it } from 'vitest'
import {
  compileResolver,
  resolverFilePath,
  ResolverCompileError,
  ResolverRuntimeError,
  ResolverTimeoutError,
  type ResolverInput,
} from '../../src/lib/mock-engine/resolver'

const input = (over: Partial<ResolverInput> = {}): ResolverInput => ({
  request: { method: 'POST', path: '/x', pathParams: {}, query: {}, headers: {}, body: null },
  history: [],
  profileId: null,
  ...over,
})

describe('compileResolver', () => {
  it('runs a default-exported function and returns its value', () => {
    const r = compileResolver(
      `export default (i) => i.history.length < 2 ? 'pending' : 'success'`,
      'x/y',
    )
    expect(r.invoke(input(), 100)).toBe('pending')
    expect(r.invoke(input({ history: ['a', 'b'] }), 100)).toBe('success')
  })

  it('branches on request content', () => {
    const r = compileResolver(
      `export default (i) => i.request.body?.amount > 10 ? 'flagged' : 'default'`,
      'x/y',
    )
    expect(r.invoke(input({ request: { ...input().request, body: { amount: 99 } } }), 100)).toBe('flagged')
  })

  it('throws ResolverCompileError on a syntax error', () => {
    expect(() => compileResolver('export default (=>', 'x/y')).toThrow(ResolverCompileError)
  })

  it('throws ResolverCompileError when there is no function export', () => {
    expect(() => compileResolver('export const foo = 1', 'x/y')).toThrow(ResolverCompileError)
  })

  it('wraps a thrown error as ResolverRuntimeError', () => {
    const r = compileResolver(`export default () => { throw new Error('boom') }`, 'x/y')
    expect(() => r.invoke(input(), 100)).toThrow(ResolverRuntimeError)
  })

  it('classifies a throw whose message contains "timed out" as ResolverRuntimeError', () => {
    const r = compileResolver(
      `export default () => { throw new Error('operation timed out while calling upstream') }`,
      'x/y',
    )
    expect(() => r.invoke(input(), 100)).toThrow(ResolverRuntimeError)
    expect(() => r.invoke(input(), 100)).not.toThrow(ResolverTimeoutError)
    expect(() => r.invoke(input(), 100)).toThrow(/operation timed out while calling upstream/)
  })

  it('interrupts an infinite loop as ResolverTimeoutError', () => {
    const r = compileResolver(`export default () => { while (true) {} }`, 'x/y')
    expect(() => r.invoke(input(), 50)).toThrow(ResolverTimeoutError)
  })

  it('has no access to require, process, or fetch', () => {
    const r = compileResolver(
      `export default () => (typeof require) + ',' + (typeof process) + ',' + (typeof fetch)`,
      'x/y',
    )
    expect(r.invoke(input(), 100)).toBe('undefined,undefined,undefined')
  })
})

describe('resolverFilePath', () => {
  it('points at <catalogDir>/<system>/<endpoint>/<slug>.mjs', () => {
    expect(resolverFilePath('/cat', 'sys', 'ep', 'by-amount')).toBe('/cat/sys/ep/by-amount.mjs')
  })
})

describe('compileResolver description export', () => {
  it('exposes export const description', () => {
    const compiled = compileResolver(
      `export const description = 'Routes by amount'\nexport default () => 'success'`,
      'sys/ep/by-amount.mjs',
    )
    expect(compiled.description).toBe('Routes by amount')
  })

  it('leaves description undefined when absent or not a string', () => {
    expect(compileResolver(`export default () => 'x'`, 'l').description).toBeUndefined()
    expect(
      compileResolver(`export const description = 42\nexport default () => 'x'`, 'l').description,
    ).toBeUndefined()
  })
})

describe('compileResolver summary export', () => {
  it('exposes export const summary', () => {
    const compiled = compileResolver(
      `export const summary = 'Flags amounts over 10'\nexport default () => 'success'`,
      'l',
    )
    expect(compiled.summary).toBe('Flags amounts over 10')
  })

  it('leaves summary undefined when absent or not a string', () => {
    expect(compileResolver(`export default () => 'x'`, 'l').summary).toBeUndefined()
    expect(
      compileResolver(`export const summary = 42\nexport default () => 'x'`, 'l').summary,
    ).toBeUndefined()
  })

  it('names the resolver generically in compile errors', () => {
    expect(() => compileResolver('const nope =', 'sys/ep/broken.mjs')).toThrowError(
      /sys\/ep\/broken\.mjs: failed to transpile resolver/,
    )
  })

  // .mjs is the only authoring format (#26): TS syntax must fail transpile
  // loudly rather than be silently stripped.
  it('rejects TypeScript syntax', () => {
    expect(() =>
      compileResolver(`export default (i: { history: string[] }): string => 'x'`, 'l'),
    ).toThrow(ResolverCompileError)
  })
})
