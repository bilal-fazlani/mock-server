export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * `YYYY-MM-DD HH:mm:ss.SSS` rendered in `timeZone`, defaulting to UTC.
 *
 * The output is deliberately locale-independent — the parts are reassembled by
 * hand rather than trusting a locale's ordering — so a server render (which has
 * no browser timezone and falls back to UTC) and the client render that replaces
 * it differ only by the zone, never by the shape of the string.
 */
export function formatTimestamp(date: Date, timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}.${part('fractionalSecond')}`
}

/** The IANA zone the browser resolves to, e.g. `Asia/Kolkata`. `UTC` when unknown. */
export function resolveTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Human label for a zone, e.g. `Asia/Kolkata (GMT+5:30)`. The offset is taken at
 * `at` rather than fixed, so a DST zone reads correctly either side of a shift.
 */
export function formatTimeZoneLabel(timeZone: string, at: Date): string {
  if (timeZone === 'UTC') return 'UTC'
  const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value
  return offset ? `${timeZone} (${offset})` : timeZone
}
