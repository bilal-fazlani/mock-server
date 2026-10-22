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

  it('parses a header selector as a source, not a function call', () => {
    expect(parseExpr('header:x-request-id')).toEqual({
      kind: 'selector',
      raw: 'header:x-request-id',
      selector: { source: 'header', name: 'x-request-id' },
    })
    expect(parseExpr('header:x-request-id | upper')).toEqual({
      kind: 'call',
      name: 'upper',
      args: [
        {
          kind: 'selector',
          raw: 'header:x-request-id',
          selector: { source: 'header', name: 'x-request-id' },
        },
      ],
    })
  })

  it('parses a bracket-key body selector as a source', () => {
    expect(parseExpr("$['assessment-request']['transaction-id']")).toEqual({
      kind: 'selector',
      raw: "$['assessment-request']['transaction-id']",
      selector: { source: 'body', segments: ['assessment-request', 'transaction-id'] },
    })
  })

  it('keeps ":" and "|" inside a bracket key out of the arg and stage split', () => {
    expect(parseExpr(`$['a|b'] | upper`)).toEqual({
      kind: 'call',
      name: 'upper',
      args: [{ kind: 'selector', raw: `$['a|b']`, selector: { source: 'body', segments: ['a|b'] } }],
    })
    expect(parseExpr(`$.x | default:$["urn:id"]`)).toEqual({
      kind: 'call',
      name: 'default',
      args: [
        { kind: 'selector', raw: '$.x', selector: { source: 'body', segments: ['x'] } },
        { kind: 'selector', raw: `$["urn:id"]`, selector: { source: 'body', segments: ['urn:id'] } },
      ],
    })
    expect(parseExpr(`profileKey:event-id:$['a:b|c']`)).toEqual({
      kind: 'selector',
      raw: `profileKey:event-id:$['a:b|c']`,
      selector: {
        source: 'profileKey',
        namespace: 'event-id',
        keySelector: { source: 'body', segments: ['a:b|c'] },
      },
    })
  })

  it('reports a malformed bracket key with the selector parser\'s reason', () => {
    expect(() => parseExpr("$['a | upper")).toThrow(/unterminated quoted key/)
    expect(() => parseExpr("$[''] | upper")).toThrow(/empty quoted key/)
    expect(() => parseExpr("$['a'b']")).toThrow(/expected "\]" after quoted key/)
  })

  it('rejects a blocked header selector at parse time', () => {
    expect(() => parseExpr('header:authorization')).toThrow(ExprParseError)
    expect(() => parseExpr('header:cookie')).toThrow(ExprParseError)
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

  it('rejects an unterminated single quote', () => {
    expect(() => parseExpr("pad:'oops")).toThrow(/unterminated single quote/)
    expect(() => parseExpr("$.a | pad:'oops")).toThrow(ExprParseError)
  })

  // A quote only opens a literal at the start of a token, so an apostrophe
  // inside a bare word is ordinary text, not an unterminated quote.
  it('keeps an apostrophe inside a bare token literal', () => {
    expect(parseExpr("label:it's")).toEqual({
      kind: 'call',
      name: 'label',
      args: [{ kind: 'lit', value: "it's" }],
    })
  })

  it('still suspends separators inside a quoted literal', () => {
    expect(parseExpr("pad:'a|b':'c:d'")).toEqual({
      kind: 'call',
      name: 'pad',
      args: [
        { kind: 'lit', value: 'a|b' },
        { kind: 'lit', value: 'c:d' },
      ],
    })
  })

  // "now" is only a syntactic form in source position; after a pipe it parses as
  // an ordinary call, which validation then rejects as an unknown function.
  it('parses now after a pipe as an ordinary call node', () => {
    expect(parseExpr('$.x | now:iso')).toEqual({
      kind: 'call',
      name: 'now',
      args: [
        { kind: 'selector', raw: '$.x', selector: { source: 'body', segments: ['x'] } },
        { kind: 'lit', value: 'iso' },
      ],
    })
    expect(callNames(parseExpr('$.x | now:iso'))).toEqual(['now'])
  })
})
