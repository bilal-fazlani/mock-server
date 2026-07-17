import { describe, expect, it } from 'vitest'
import { NowFormatError, parseNow, renderNow } from '../../src/lib/mock-engine/now'

const now = new Date('2026-07-02T10:20:30.000Z')

describe('parseNow', () => {
  it('returns null for non-now expressions', () => {
    expect(parseNow('$.customerId')).toBeNull()
    expect(parseNow('path:bookingId')).toBeNull()
    expect(parseNow('nowhere:iso')).toBeNull()
  })

  it('parses a bare format with zero offset', () => {
    expect(parseNow('now:iso')).toEqual({ offsetMs: 0, format: 'iso' })
    expect(parseNow('now:YYYYMMDD')).toEqual({ offsetMs: 0, format: 'YYYYMMDD' })
  })

  it('parses positive and negative offsets for every unit', () => {
    expect(parseNow('now+30s:iso')).toEqual({ offsetMs: 30_000, format: 'iso' })
    expect(parseNow('now-15m:iso')).toEqual({ offsetMs: -15 * 60_000, format: 'iso' })
    expect(parseNow('now+1h:iso')).toEqual({ offsetMs: 3_600_000, format: 'iso' })
    expect(parseNow('now+3d:iso')).toEqual({ offsetMs: 3 * 86_400_000, format: 'iso' })
    expect(parseNow('now+0d:iso')).toEqual({ offsetMs: 0, format: 'iso' })
  })

  it('throws NowFormatError on malformed now-expressions', () => {
    expect(() => parseNow('now:nope')).toThrow(NowFormatError)
    expect(() => parseNow('now:')).toThrow(NowFormatError)
    expect(() => parseNow('now+3x:iso')).toThrow(NowFormatError)
    expect(() => parseNow('now+:iso')).toThrow(NowFormatError)
    expect(() => parseNow('now+1d')).toThrow(NowFormatError)
  })
})

describe('renderNow', () => {
  it('renders iso with the offset applied', () => {
    expect(renderNow({ offsetMs: 0, format: 'iso' }, now)).toBe('2026-07-02T10:20:30.000Z')
    expect(renderNow({ offsetMs: 3 * 86_400_000, format: 'iso' }, now)).toBe(
      '2026-07-05T10:20:30.000Z',
    )
    expect(renderNow({ offsetMs: -15 * 60_000, format: 'iso' }, now)).toBe(
      '2026-07-02T10:05:30.000Z',
    )
  })

  it('renders YYYYMMDD in UTC and rolls across day boundaries', () => {
    expect(renderNow({ offsetMs: 0, format: 'YYYYMMDD' }, now)).toBe('20260702')
    expect(renderNow({ offsetMs: 86_400_000, format: 'YYYYMMDD' }, now)).toBe('20260703')
    // 2026-07-02T10:20 + 14h crosses into 2026-07-03 UTC
    expect(renderNow({ offsetMs: 14 * 3_600_000, format: 'YYYYMMDD' }, now)).toBe('20260703')
  })
})
