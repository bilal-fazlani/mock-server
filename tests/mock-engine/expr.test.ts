import { describe, expect, it } from 'vitest'
import { parseExpr, callNames, ExprParseError } from '../../src/lib/mock-engine/expr'

describe('parseExpr', () => {
  it('parses a bare body selector', () => {
    expect(parseExpr('$.name')).toEqual({
      kind: 'selector',
      raw: '$.name',
      selector: { source: 'body', segments: ['name'] },
    })
  })

  it('parses now with offset+format', () => {
    expect(parseExpr('now+1d:iso')).toEqual({
      kind: 'now',
      spec: { offsetMs: 86_400_000, format: 'iso' },
    })
  })

  it('parses a colon call with typed literal args', () => {
    expect(parseExpr('random:int:1:100')).toEqual({
      kind: 'call',
      name: 'random',
      args: [
        { kind: 'lit', value: 'int' },
        { kind: 'lit', value: 1 },
        { kind: 'lit', value: 100 },
      ],
    })
  })

  it('desugars a pipe so the prior expr is the first arg', () => {
    expect(parseExpr('$.name | upper')).toEqual({
      kind: 'call',
      name: 'upper',
      args: [{ kind: 'selector', raw: '$.name', selector: { source: 'body', segments: ['name'] } }],
    })
  })

  it('chains multiple pipes left to right', () => {
    const e = parseExpr('$.tok | hash:sha256 | upper')
    expect(e).toEqual({
      kind: 'call',
      name: 'upper',
      args: [{
        kind: 'call',
        name: 'hash',
        args: [
          { kind: 'selector', raw: '$.tok', selector: { source: 'body', segments: ['tok'] } },
          { kind: 'lit', value: 'sha256' },
        ],
      }],
    })
  })

  it('strips single quotes for forced string literals', () => {
    expect(parseExpr("pad:'007'")).toEqual({
      kind: 'call',
      name: 'pad',
      args: [{ kind: 'lit', value: '007' }],
    })
  })

  it('keeps : and | inside single quotes literal', () => {
    expect(parseExpr("pad:'a|b:c'")).toEqual({
      kind: 'call',
      name: 'pad',
      args: [{ kind: 'lit', value: 'a|b:c' }],
    })
  })

  it('collects call names across a chain', () => {
    expect(callNames(parseExpr('$.tok | hash:sha256 | upper')).sort()).toEqual(['hash', 'upper'])
  })

  it('rejects a now/selector after a pipe', () => {
    expect(() => parseExpr('$.a | $.b')).toThrow(ExprParseError)
  })

  it('rejects an empty stage', () => {
    expect(() => parseExpr('$.a |')).toThrow(ExprParseError)
  })
})
