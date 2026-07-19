import { type NowSpec, parseNow, NowFormatError } from './now'
import { parseSelector, type Selector, SelectorParseError } from '../catalog/selector'

export type CallExpr = { kind: 'call'; name: string; args: Expr[] }

export type Expr =
  | { kind: 'lit'; value: string | number | boolean }
  | { kind: 'selector'; raw: string; selector: Selector }
  | { kind: 'now'; spec: NowSpec }
  | CallExpr

export class ExprParseError extends Error {}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function parseExpr(raw: string): Expr {
  // An opening quote that is never closed would otherwise be swallowed into a
  // literal ("{{pad:'oops}}" → the string "'oops"), so it fails here instead.
  const split = splitOutsideQuotes(raw, '|')
  if (split.unterminated) {
    throw new ExprParseError(`invalid placeholder "{{${raw}}}": unterminated single quote`)
  }
  const stages = split.parts.map((s) => s.trim())
  if (stages.some((s) => s.length === 0)) {
    throw new ExprParseError(`invalid placeholder "{{${raw}}}": empty stage`)
  }
  let expr: Expr = parseSource(stages[0], raw)
  for (let i = 1; i < stages.length; i++) {
    // Only a call may follow "|": parseCall rejects selector/now tokens as bad
    // function names, so the stage is a CallExpr by construction here.
    const call = parseCall(stages[i], raw)
    call.args.unshift(expr)
    expr = call
  }
  return expr
}

function parseSource(stage: string, raw: string): Expr {
  const now = tryNow(stage)
  if (now) return now
  if (isSelectorToken(stage)) return selectorNode(stage)
  return parseCall(stage, raw)
}

function tryNow(stage: string): Expr | null {
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

function selectorNode(token: string): Expr {
  try {
    return { kind: 'selector', raw: token, selector: parseSelector(token) }
  } catch (err) {
    if (err instanceof SelectorParseError) throw new ExprParseError(err.message)
    throw err
  }
}

function parseCall(stage: string, raw: string): CallExpr {
  const parts = splitArgs(stage)
  const name = parts[0]
  if (!NAME_RE.test(name)) {
    throw new ExprParseError(`invalid placeholder "{{${raw}}}": bad function name "${name}"`)
  }
  const args = parts.slice(1).map((p) => parseArg(p))
  return { kind: 'call', name, args }
}

// Split on a separator, except inside a single-quoted segment — quotes
// suspend both ':' (args) and '|' (stages). `unterminated` reports a quote that
// opened and never closed, which callers turn into a parse error.
function splitOutsideQuotes(input: string, sep: ':' | '|'): { parts: string[]; unterminated: boolean } {
  const parts: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of input) {
    if (ch === "'") {
      if (inQuote) inQuote = false
      else if (opensQuote(cur)) inQuote = true
    }
    if (ch === sep && !inQuote) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return { parts, unterminated: inQuote }
}

// A quote only delimits a literal when it *starts* a token — nothing but
// whitespace since the last separator, which is exactly what parseArg's
// startsWith/endsWith check assumes. Anywhere else it is an ordinary character,
// so an apostrophe in a bare token ("label:it's") stays literal text.
function opensQuote(cur: string): boolean {
  const seen = cur.trimEnd()
  return seen === '' || seen.endsWith(':') || seen.endsWith('|')
}

// Only reached after parseExpr's whole-expression scan has rejected an
// unterminated quote, so the flag is already known to be false here.
function splitArgs(stage: string): string[] {
  return splitOutsideQuotes(stage, ':').parts.map((s) => s.trim())
}

function parseArg(token: string): Expr {
  if (token.startsWith("'") && token.endsWith("'") && token.length >= 2) {
    return { kind: 'lit', value: token.slice(1, -1) }
  }
  if (token === 'true') return { kind: 'lit', value: true }
  if (token === 'false') return { kind: 'lit', value: false }
  if (/^-?\d+(\.\d+)?$/.test(token)) return { kind: 'lit', value: Number(token) }
  if (token.startsWith('$')) return selectorNode(token)
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
