export class DurationError extends Error {}

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60000 }

/**
 * Parse a fixture `delay` string into milliseconds. Format:
 * `<non-negative-integer><unit>` where unit is `ms` | `s` | `m`
 * (e.g. "400ms", "2s", "1m"). Throws DurationError on anything else —
 * missing/unsupported unit, non-integer, negative, empty, or compound.
 */
export function parseDelayMs(raw: string): number {
  const match = /^(\d+)(ms|s|m)$/.exec(raw)
  if (!match) {
    throw new DurationError(
      `invalid delay "${raw}" (use a duration like "400ms", "2s", or "1m")`,
    )
  }
  return Number(match[1]) * UNIT_MS[match[2]]
}
