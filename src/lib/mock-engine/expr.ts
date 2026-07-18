import { NowSpec, parseNow, NowFormatError } from './now'
import { parseSelector, Selector, SelectorParseError } from '../catalog/selector'

export type Expr =
  | { kind: 'lit'; value: string | number | boolean }
  | { kind: 'selector'; raw: string; selector: Selector }
  | { kind: 'now'; spec: NowSpec }
  | { kind: 'call'; name: string; args: Expr[] }

export class ExprParseError extends Error {}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function parseExpr(raw: string): Expr {
  const stages = splitOutsideQuotes(raw, '|').map((s) => s.trim())
  if (stages.some((s) => s.length === 0)) {
    throw new ExprParseError(`invalid placeholder "{{${raw}}}": empty stage`)
  }
  let expr = parseSource(stages[0], raw)
  for (let i = 1; i < stages.length; i++) {
    const call = parseCall(stages[i], raw)
    if (call.kind !== 'call') {
      throw new ExprParseError(`invalid placeholder "{{${raw}}}": only functions may follow "|"`)
    }
    call.args.unshift(expr)
    expr = call
  }
  return expr
}

function parseSource(stage: string, raw: string): Expr {
  const now = tryNow(stage, raw)
  if (now) return now
  if (isSelectorToken(stage)) return selectorNode(stage, raw)
  return parseCall(stage, raw)
}

function tryNow(stage: string, raw: string): Expr | null {
  try {
    const spec = parseNow(stage)
    return spec ? { kind: 'now', spec } : null
  } catch (err) {
    if (err instanceof NowFormatError) throw new ExprParseError(err.message)
    throw err
  }
}

function isSelectorToken(t: string): boolean {
  return (
    t.startsWith('$') ||
    t.startsWith('path:') ||
    t.startsWith('query:') ||
    t.startsWith('profileKey:')
  )
}

function selectorNode(token: string, raw: string): Expr {
  try {
    return { kind: 'selector', raw: token, selector: parseSelector(token) }
  } catch (err) {
    if (err instanceof SelectorParseError) throw new ExprParseError(err.message)
    throw err
  }
}

function parseCall(stage: string, raw: string): Expr {
  const parts = splitArgs(stage)
  const name = parts[0]
  if (!NAME_RE.test(name)) {
    throw new ExprParseError(`invalid placeholder "{{${raw}}}": bad function name "${name}"`)
  }
  const args = parts.slice(1).map((p) => parseArg(p, raw))
  return { kind: 'call', name, args }
}

// Split on a separator, except inside a single-quoted segment — quotes
// suspend both ':' (args) and '|' (stages).
function splitOutsideQuotes(input: string, sep: ':' | '|'): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of input) {
    if (ch === "'") inQuote = !inQuote
    if (ch === sep && !inQuote) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function splitArgs(stage: string): string[] {
  return splitOutsideQuotes(stage, ':').map((s) => s.trim())
}

function parseArg(token: string, raw: string): Expr {
  if (token.startsWith("'") && token.endsWith("'") && token.length >= 2) {
    return { kind: 'lit', value: token.slice(1, -1) }
  }
  if (token === 'true') return { kind: 'lit', value: true }
  if (token === 'false') return { kind: 'lit', value: false }
  if (/^-?\d+(\.\d+)?$/.test(token)) return { kind: 'lit', value: Number(token) }
  if (token.startsWith('$')) return selectorNode(token, raw)
  return { kind: 'lit', value: token }
}

export function callNames(expr: Expr): string[] {
  const out: string[] = []
  const walk = (e: Expr): void => {
    if (e.kind === 'call') {
      out.push(e.name)
      e.args.forEach(walk)
    }
  }
  walk(expr)
  return out
}
