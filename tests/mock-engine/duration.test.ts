import { describe, expect, it } from 'vitest'
import { DurationError, parseDelayMs } from '../../src/lib/mock-engine/duration'

describe('parseDelayMs', () => {
  it('parses milliseconds', () => {
    expect(parseDelayMs('400ms')).toBe(400)
  })

  it('parses seconds', () => {
    expect(parseDelayMs('2s')).toBe(2000)
  })

  it('parses minutes', () => {
    expect(parseDelayMs('1m')).toBe(60000)
  })

  it('accepts a zero delay for each unit', () => {
    expect(parseDelayMs('0ms')).toBe(0)
    expect(parseDelayMs('0s')).toBe(0)
    expect(parseDelayMs('0m')).toBe(0)
  })

  it.each(['', '400', 'ms', '400 ms', '4.5s', '-1s', '1h', '1d', '1m30s', 'abc'])(
    'throws DurationError for %o',
    (raw) => {
      expect(() => parseDelayMs(raw)).toThrow(DurationError)
    },
  )
})
