export class NowFormatError extends Error {}

export const NOW_FORMATS = [
  'iso',
  'YYYYMMDD',
  'epoch',
  'epochMillis',
  'date',
  'time',
] as const
export type NowFormat = (typeof NOW_FORMATS)[number]

export interface NowSpec {
  offsetMs: number
  format: NowFormat
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

const NOW_RE = /^now(?:([+-])(\d+)([smhd]))?:(.+)$/

function isNowFormat(value: string): value is NowFormat {
  return (NOW_FORMATS as readonly string[]).includes(value)
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
  if (!isNowFormat(format)) {
    throw new NowFormatError(
      `unknown now format "${format}" in "{{${expr}}}" (use ${NOW_FORMATS.join(' or ')})`,
    )
  }
  const offsetMs = sign ? (sign === '-' ? -1 : 1) * Number(num) * UNIT_MS[unit] : 0
  return { offsetMs, format }
}

export function renderNow(spec: NowSpec, now: Date): string {
  const d = new Date(now.getTime() + spec.offsetMs)
  switch (spec.format) {
    case 'iso':
      return d.toISOString()
    case 'YYYYMMDD':
      return d.toISOString().slice(0, 10).replace(/-/g, '')
    case 'epoch':
      return String(Math.floor(d.getTime() / 1000))
    case 'epochMillis':
      return String(d.getTime())
    case 'date':
      return d.toISOString().slice(0, 10)
    case 'time':
      return d.toISOString().slice(11, 19)
  }
}
