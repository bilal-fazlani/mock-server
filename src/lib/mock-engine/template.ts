import { RequestContext } from '../catalog/selector'
import { ExprParseError, parseExpr } from './expr'
import { evaluate, EvalValue } from './evaluate'
import { CompiledFn, FnContext } from './functions'

export class PlaceholderError extends Error {}

export interface TemplateOptions {
  /** Headers mode: whole-string placeholders coerce to string too (Task 8). */
  stringOnly?: boolean
  fnCtx?: FnContext
  functions?: Map<string, CompiledFn>
  timeoutMs?: number
}

const PLACEHOLDER_RE = /\{\{(.+?)\}\}/g

function resolvePlaceholderTyped(expr: string, ctx: RequestContext, now: Date, options?: TemplateOptions): EvalValue {
  let ast
  try {
    ast = parseExpr(expr)
  } catch (err) {
    if (err instanceof ExprParseError) {
      throw new PlaceholderError(`invalid placeholder "{{${expr}}}": ${err.message}`)
    }
    throw err
  }
  return evaluate(ast, { ctx, now, ...options })
}

function resolvePlaceholder(expr: string, ctx: RequestContext, now: Date, options?: TemplateOptions): string {
  return String(resolvePlaceholderTyped(expr, ctx, now, options))
}

// Trace values readable for objects/arrays, not "[object Object]".
function stringifyForTrace(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
}

export function resolveTemplate(
  node: unknown,
  ctx: RequestContext,
  now: Date,
  resolutions?: Record<string, string>,
  options?: TemplateOptions,
): unknown {
  if (typeof node === 'string') {
    PLACEHOLDER_RE.lastIndex = 0
    const first = PLACEHOLDER_RE.exec(node)
    PLACEHOLDER_RE.lastIndex = 0
    if (first && first[0] === node && !options?.stringOnly) {
      const value = resolvePlaceholderTyped(first[1], ctx, now, options)
      if (resolutions) resolutions[node] = stringifyForTrace(value)
      return value
    }
    return node.replace(PLACEHOLDER_RE, (_, expr: string) => {
      const value = resolvePlaceholder(expr, ctx, now, options)
      if (resolutions) resolutions[`{{${expr}}}`] = value
      return value
    })
  }
  if (Array.isArray(node)) {
    return node.map((item) => resolveTemplate(item, ctx, now, resolutions, options))
  }
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, resolveTemplate(v, ctx, now, resolutions, options)]),
    )
  }
  return node
}

export function listPlaceholders(node: unknown): string[] {
  const found: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      for (const m of n.matchAll(PLACEHOLDER_RE)) found.push(m[1])
    } else if (Array.isArray(n)) {
      n.forEach(walk)
    } else if (n !== null && typeof n === 'object') {
      Object.values(n).forEach(walk)
    }
  }
  walk(node)
  return found
}
