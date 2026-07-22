import { describe, expect, it } from 'vitest'
import { NowFormatError, parseNow, renderNow } from '../../src/lib/mock-engine/now'

const now = new Date('2026-07-02T10:20:30.456Z')

describe('parseNow', () => {
  it('returns null for non-now expressions', () => {
    expect(parseNow('$.customerId')).toBeNull()
    expect(parseNow('path:bookingId')).toBeNull()
    expect(parseNow('nowhere:iso')).toBeNull()
  })

  it('parses the named formats with zero offset', () => {
    expect(parseNow('now:iso')).toEqual({ offsetMs: 0, format: 'iso' })
    expect(parseNow('now:epoch')).toEqual({ offsetMs: 0, format: 'epoch' })
    expect(parseNow('now:epochMillis')).toEqual({ offsetMs: 0, format: 'epochMillis' })
  })

  it('parses token patterns, including ones containing colons', () => {
    expect(parseNow('now:YYYY-MM-DD')).toEqual({ offsetMs: 0, format: 'YYYY-MM-DD' })
    expect(parseNow('now:HH:mm:ss')).toEqual({ offsetMs: 0, format: 'HH:mm:ss' })
    expect(parseNow('now:YYYYMMDD')).toEqual({ offsetMs: 0, format: 'YYYYMMDD' })
    expect(parseNow('now:YYYY-MM-DD[T]HH:mm:ss.SSS[Z]')).toEqual({
      offsetMs: 0,
      format: 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]',
    })
  })

  it('composes offsets with named formats and patterns', () => {
    expect(parseNow('now+1h:epoch')).toEqual({ offsetMs: 3_600_000, format: 'epoch' })
    expect(parseNow('now-37d:YYYY-MM-DD')).toEqual({
      offsetMs: -37 * 86_400_000,
      format: 'YYYY-MM-DD',
    })
  })

  it('parses positive and negative offsets for every unit', () => {
    expect(parseNow('now+30s:iso')).toEqual({ offsetMs: 30_000, format: 'iso' })
    expect(parseNow('now-15m:iso')).toEqual({ offsetMs: -15 * 60_000, format: 'iso' })
    expect(parseNow('now+1h:iso')).toEqual({ offsetMs: 3_600_000, format: 'iso' })
    expect(parseNow('now+3d:iso')).toEqual({ offsetMs: 3 * 86_400_000, format: 'iso' })
    expect(parseNow('now+0d:iso')).toEqual({ offsetMs: 0, format: 'iso' })
  })

  it('throws NowFormatError on malformed now-expressions', () => {
    expect(() => parseNow('now:')).toThrow(NowFormatError)
    expect(() => parseNow('now+3x:iso')).toThrow(NowFormatError)
    expect(() => parseNow('now+:iso')).toThrow(NowFormatError)
    expect(() => parseNow('now+1d')).toThrow(NowFormatError)
  })

  it('rejects unknown alphabetic characters in patterns (loud failure over garbage)', () => {
    // the removed named formats are now invalid patterns, not silent output
    expect(() => parseNow('now:date')).toThrow(NowFormatError)
    expect(() => parseNow('now:time')).toThrow(NowFormatError)
    expect(() => parseNow('now:YYYY-QQ')).toThrow(NowFormatError)
    // partial token: "MMM" tokenizes as MM + unknown "M"
    expect(() => parseNow('now:MMM')).toThrow(NowFormatError)
    // unescaped literal letter
    expect(() => parseNow('now:YYYY-MM-DDTHH:mm:ss')).toThrow(NowFormatError)
  })

  it('rejects an unterminated [literal] escape', () => {
    expect(() => parseNow('now:YYYY-[T')).toThrow(NowFormatError)
  })
})

describe('renderNow', () => {
  it('renders iso with the offset applied', () => {
    expect(renderNow({ offsetMs: 0, format: 'iso' }, now)).toBe('2026-07-02T10:20:30.456Z')
    expect(renderNow({ offsetMs: 3 * 86_400_000, format: 'iso' }, now)).toBe(
      '2026-07-05T10:20:30.456Z',
    )
    expect(renderNow({ offsetMs: -15 * 60_000, format: 'iso' }, now)).toBe(
      '2026-07-02T10:05:30.456Z',
    )
  })

  it('renders epoch as Unix seconds and epochMillis as milliseconds', () => {
    const seconds = Math.floor(now.getTime() / 1000)
    expect(renderNow({ offsetMs: 0, format: 'epoch' }, now)).toBe(String(seconds))
    expect(renderNow({ offsetMs: 0, format: 'epochMillis' }, now)).toBe(String(now.getTime()))
    expect(renderNow({ offsetMs: 1_000, format: 'epoch' }, now)).toBe(String(seconds + 1))
  })

  it('renders every token in UTC', () => {
    expect(renderNow({ offsetMs: 0, format: 'YYYY-MM-DD' }, now)).toBe('2026-07-02')
    expect(renderNow({ offsetMs: 0, format: 'HH:mm:ss' }, now)).toBe('10:20:30')
    expect(renderNow({ offsetMs: 0, format: 'YYYYMMDD' }, now)).toBe('20260702')
    expect(renderNow({ offsetMs: 0, format: 'SSS' }, now)).toBe('456')
  })

  it('renders [literal] escapes verbatim', () => {
    expect(renderNow({ offsetMs: 0, format: 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]' }, now)).toBe(
      '2026-07-02T10:20:30.456Z',
    )
    expect(renderNow({ offsetMs: 0, format: '[day] DD' }, now)).toBe('day 02')
  })

  it('pads single-digit fields to fixed width', () => {
    const early = new Date('2026-01-05T03:04:05.007Z')
    expect(renderNow({ offsetMs: 0, format: 'YYYY-MM-DD HH:mm:ss.SSS' }, early)).toBe(
      '2026-01-05 03:04:05.007',
    )
  })

  it('rolls across day boundaries with offsets applied', () => {
    // 2026-07-02T10:20 + 14h crosses into 2026-07-03 UTC
    expect(renderNow({ offsetMs: 14 * 3_600_000, format: 'YYYY-MM-DD' }, now)).toBe('2026-07-03')
    expect(renderNow({ offsetMs: 14 * 3_600_000, format: 'HH:mm:ss' }, now)).toBe('00:20:30')
    expect(renderNow({ offsetMs: 86_400_000, format: 'YYYYMMDD' }, now)).toBe('20260703')
  })
})
