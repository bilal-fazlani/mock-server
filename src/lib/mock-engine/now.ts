export class NowFormatError extends Error {}

// Formats that keep a name because no readable token pattern can express them.
export const NAMED_NOW_FORMATS = ['iso', 'epoch', 'epochMillis'] as const

// Date/time tokens for free-form patterns, longest-first so the tokenizer can
// match greedily ("SSS" before "ss" is irrelevant, but "YYYY" must never be
// consumed as two unknown "YY" runs).
const PATTERN_TOKENS = ['YYYY', 'SSS', 'MM', 'DD', 'HH', 'mm', 'ss'] as const
type PatternToken = (typeof PATTERN_TOKENS)[number]

export interface NowSpec {
  offsetMs: number
  /** A named format (iso/epoch/epochMillis) or a validated token pattern. */
  format: string
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

const NOW_RE = /^now(?:([+-])(\d+)([smhd]))?:(.+)$/

function isNamedFormat(value: string): boolean {
  return (NAMED_NOW_FORMATS as readonly string[]).includes(value)
}

type PatternPart = { kind: 'token'; token: PatternToken } | { kind: 'literal'; text: string }

// Shared by parse-time validation and render, so the two can never disagree
// about what a pattern means. Throws NowFormatError on anything not covered:
// an alphabetic character outside the token set (loud failure over silently
// rendering a typo like "date" into a response) or an unclosed "[" escape.
function tokenizePattern(pattern: string, expr: string): PatternPart[] {
  const parts: PatternPart[] = []
  let i = 0
  outer: while (i < pattern.length) {
    // [literal] escapes text that would otherwise be (invalid) tokens, e.g.
    // the "T" in YYYY-MM-DD[T]HH:mm:ss.
    if (pattern[i] === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        throw new NowFormatError(`unterminated "[" in now format "{{${expr}}}"`)
      }
      parts.push({ kind: 'literal', text: pattern.slice(i + 1, close) })
      i = close + 1
      continue
    }
    for (const token of PATTERN_TOKENS) {
      if (pattern.startsWith(token, i)) {
        parts.push({ kind: 'token', token })
        i += token.length
        continue outer
      }
    }
    if (/[a-zA-Z]/.test(pattern[i])) {
      throw new NowFormatError(
        `unknown now format "${pattern}" in "{{${expr}}}" — "${pattern[i]}" is not a format token ` +
          `(use ${NAMED_NOW_FORMATS.join(' or ')}, or a pattern of ${PATTERN_TOKENS.join(' ')} ` +
          `with [literal] escapes, e.g. YYYY-MM-DD)`,
      )
    }
    parts.push({ kind: 'literal', text: pattern[i] })
    i += 1
  }
  return parts
}

export function parseNow(expr: string): NowSpec | null {
  if (!/^now[+\-:]/.test(expr)) return null
  const m = NOW_RE.exec(expr)
  if (!m) {
    throw new NowFormatError(
      `invalid now offset in "{{${expr}}}" (use now[±<n><s|m|h|d>]:<format>)`,
    )
  }
  const [, sign, num, unit, format] = m
  // Validate token patterns at parse time so a bad format fails at the catalog
  // gate, never mid-response.
  if (!isNamedFormat(format)) tokenizePattern(format, expr)
  const offsetMs = sign ? (sign === '-' ? -1 : 1) * Number(num) * UNIT_MS[unit] : 0
  return { offsetMs, format }
}

function renderToken(token: PatternToken, d: Date): string {
  switch (token) {
    case 'YYYY':
      return String(d.getUTCFullYear()).padStart(4, '0')
    case 'MM':
      return String(d.getUTCMonth() + 1).padStart(2, '0')
    case 'DD':
      return String(d.getUTCDate()).padStart(2, '0')
    case 'HH':
      return String(d.getUTCHours()).padStart(2, '0')
    case 'mm':
      return String(d.getUTCMinutes()).padStart(2, '0')
    case 'ss':
      return String(d.getUTCSeconds()).padStart(2, '0')
    case 'SSS':
      return String(d.getUTCMilliseconds()).padStart(3, '0')
  }
}

export function renderNow(spec: NowSpec, now: Date): string {
  const d = new Date(now.getTime() + spec.offsetMs)
  switch (spec.format) {
    case 'iso':
      return d.toISOString()
    case 'epoch':
      return String(Math.floor(d.getTime() / 1000))
    case 'epochMillis':
      return String(d.getTime())
  }
  // parseNow validated the pattern, so tokenizePattern cannot throw here.
  return tokenizePattern(spec.format, `now:${spec.format}`)
    .map((part) => (part.kind === 'token' ? renderToken(part.token, d) : part.text))
    .join('')
}
