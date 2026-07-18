import { describe, expect, it } from 'vitest'
import { resolveTemplate } from '../../src/lib/mock-engine/template'
import { compileFunctions } from '../../src/lib/mock-engine/functions'

describe('resolveTemplate with a function table (request-path shape)', () => {
  it('renders a fixture body that calls a user function', () => {
    const functions = compileFunctions(`export function greet(ctx, who) { return 'hello ' + who }`, 'f', 'js')
    const ctx = { body: { name: 'bilal' }, pathParams: {}, query: new URLSearchParams(), headers: {} }
    const fnCtx = { request: { method: 'GET', path: '/', pathParams: {}, query: {}, headers: {}, body: { name: 'bilal' } }, now: new Date(0), seed: 's' }
    const out = resolveTemplate({ msg: '{{greet:$.name}}' }, ctx, new Date(0), undefined, { functions, fnCtx })
    expect(out).toEqual({ msg: 'hello bilal' })
  })
})
