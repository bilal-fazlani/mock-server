import { describe, expect, it } from 'vitest'
import { formatExpiresIn, formatTimeZoneLabel, formatTimestamp, formatUtc } from '../../src/lib/format'

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

describe('formatExpiresIn', () => {
  const now = new Date('2026-10-22T12:00:00Z')
  const after = (ms: number) => new Date(now.getTime() + ms)

  it('names the time left in its largest unit, rounded to the nearest', () => {
    expect(formatExpiresIn(after(30_000), now)).toBe('Expires in under a minute')
    expect(formatExpiresIn(after(59 * 60_000), now)).toBe('Expires in 59m')
    expect(formatExpiresIn(after(2 * 3600_000 - 5_000), now)).toBe('Expires in 2h')
    expect(formatExpiresIn(after(3.4 * 3600_000), now)).toBe('Expires in 3h')
    expect(formatExpiresIn(after(23.6 * 3600_000), now)).toBe('Expires in 1d')
    expect(formatExpiresIn(after(7 * 24 * 3600_000 - 5_000), now)).toBe('Expires in 7d')
  })
})
