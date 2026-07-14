import { describe, expect, it } from 'vitest'
import {
  compileResolver,
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
      `export default (i: { history: string[] }) => i.history.length < 2 ? 'pending' : 'success'`,
      'x/y',
    )
    expect(r.invoke(input(), 100)).toBe('pending')
    expect(r.invoke(input({ history: ['a', 'b'] }), 100)).toBe('success')
  })

  it('branches on request content', () => {
    const r = compileResolver(
      `export default (i: any) => i.request.body?.amount > 10 ? 'flagged' : 'default'`,
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
