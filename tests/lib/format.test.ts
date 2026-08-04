import { describe, expect, it } from 'vitest'
import { formatTimeZoneLabel, formatTimestamp, formatUtc } from '../../src/lib/format'

describe('formatUtc', () => {
  it('formats as YYYY-MM-DD HH:mm UTC', () => {
    expect(formatUtc(new Date('2026-07-03T14:05:33.123Z'))).toBe('2026-07-03 14:05 UTC')
  })
})

describe('formatTimestamp', () => {
  it('defaults to UTC and keeps the date and milliseconds', () => {
    expect(formatTimestamp(new Date('2026-07-03T14:05:33.123Z'))).toBe('2026-07-03 14:05:33.123')
  })

  it('renders in the given zone, rolling the date when the offset crosses midnight', () => {
    // 20:14 UTC is already the next day in Tokyo (UTC+9) — the date must follow.
    expect(formatTimestamp(new Date('2026-08-04T20:14:30.421Z'), 'Asia/Tokyo')).toBe(
      '2026-08-05 05:14:30.421',
    )
    expect(formatTimestamp(new Date('2026-08-04T20:14:30.421Z'), 'Asia/Kolkata')).toBe(
      '2026-08-05 01:44:30.421',
    )
    // ...and backwards over midnight for a negative offset.
    expect(formatTimestamp(new Date('2026-08-04T02:30:00.000Z'), 'America/New_York')).toBe(
      '2026-08-03 22:30:00.000',
    )
  })

  it('uses a 24-hour clock, so midnight is 00 rather than 24', () => {
    expect(formatTimestamp(new Date('2026-08-04T00:00:00.000Z'))).toBe('2026-08-04 00:00:00.000')
  })

  it('pads every field to a fixed width so rows stay column-aligned', () => {
    expect(formatTimestamp(new Date('2026-01-02T03:04:05.006Z'))).toBe('2026-01-02 03:04:05.006')
  })
})

describe('formatTimeZoneLabel', () => {
  it('labels UTC without a redundant offset', () => {
    expect(formatTimeZoneLabel('UTC', new Date('2026-08-04T20:14:30.421Z'))).toBe('UTC')
  })

  it('appends the offset for a named zone', () => {
    expect(formatTimeZoneLabel('Asia/Kolkata', new Date('2026-08-04T20:14:30.421Z'))).toBe(
      'Asia/Kolkata (GMT+5:30)',
    )
  })

  it('takes the offset at the given instant, so DST reads correctly on both sides', () => {
    const summer = formatTimeZoneLabel('America/New_York', new Date('2026-08-04T12:00:00.000Z'))
    const winter = formatTimeZoneLabel('America/New_York', new Date('2026-01-04T12:00:00.000Z'))
    expect(summer).toBe('America/New_York (GMT-4)')
    expect(winter).toBe('America/New_York (GMT-5)')
  })
})
