import { describe, expect, it } from 'vitest'
import {
  matchPath,
  parsePathTemplate,
  PathTemplateError,
  templatesOverlap,
} from '../../src/lib/catalog/path-template'

describe('parsePathTemplate', () => {
  it('parses literal and param segments', () => {
    const t = parsePathTemplate('/customers/{customerId}/bookings')
    expect(t.segments).toEqual([
      { type: 'literal', value: 'customers' },
      { type: 'param', name: 'customerId' },
      { type: 'literal', value: 'bookings' },
    ])
  })

  it('rejects templates that do not start with /', () => {
    expect(() => parsePathTemplate('hello/world')).toThrow(PathTemplateError)
  })

  it('rejects malformed param segments and empty segments', () => {
    expect(() => parsePathTemplate('/a/{bad')).toThrow(PathTemplateError)
    expect(() => parsePathTemplate('/a/b{c}')).toThrow(PathTemplateError)
    expect(() => parsePathTemplate('/a//b')).toThrow(PathTemplateError)
  })
})

describe('matchPath', () => {
  const t = parsePathTemplate('/customers/{customerId}/bookings')

  it('matches and captures params (URL-decoded)', () => {
    expect(matchPath(t, '/customers/cus%2D42/bookings')).toEqual({ customerId: 'cus-42' })
  })

  it('returns null on literal mismatch or segment-count mismatch', () => {
    expect(matchPath(t, '/customers/cus-42/orders')).toBeNull()
    expect(matchPath(t, '/customers/cus-42')).toBeNull()
    expect(matchPath(t, '/customers/cus-42/bookings/extra')).toBeNull()
  })

  it('matches literal-only templates with no params', () => {
    const hello = parsePathTemplate('/hello/world')
    expect(matchPath(hello, '/hello/world')).toEqual({})
    expect(matchPath(hello, '/hello/mars')).toBeNull()
  })
})

describe('templatesOverlap', () => {
  it('detects overlap between a param and a literal in the same position', () => {
    const a = parsePathTemplate('/customers/{id}')
    const b = parsePathTemplate('/customers/recent')
    expect(templatesOverlap(a, b)).toBe(true)
  })

  it('no overlap when literals differ or lengths differ', () => {
    expect(
      templatesOverlap(parsePathTemplate('/a/b'), parsePathTemplate('/a/c')),
    ).toBe(false)
    expect(
      templatesOverlap(parsePathTemplate('/a/{x}'), parsePathTemplate('/a/{x}/y')),
    ).toBe(false)
  })
})
