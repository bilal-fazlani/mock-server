import { RequestContext } from '../catalog/selector'
import { ExprParseError, parseExpr } from './expr'
import { evaluate, EvalValue } from './evaluate'
import { CompiledFn, FnContext, FunctionRuntimeError, FunctionTimeoutError } from './functions'

/**
 * Trace code for a placeholder failure. User-function failures get their own
 * codes — mirroring the resolver's `resolver_threw` / `resolver_timeout` — so
 * logs can tell an author's function apart from a bad template. The 500 body is
 * identical either way; this is log taxonomy only.
 */
export type PlaceholderErrorCode = 'template_error' | 'function_error' | 'function_timeout'

export class PlaceholderError extends Error {
  constructor(
    message: string,
    readonly code: PlaceholderErrorCode = 'template_error',
  ) {
    super(message)
  }
}

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
  try {
    return evaluate(ast, { ctx, now, ...options })
  } catch (err) {
    // A user function that threw, timed out, or returned something unusable
    // (see evaluate.ts) surfaces here without knowing which placeholder it
    // was evaluated from. This is the one spot that has both the placeholder
    // text and the underlying error, so it's where the two get stitched
    // together into the PlaceholderError that route-request's catch turns
    // into a structured 500 (design doc: "Error handling").
    if (err instanceof FunctionRuntimeError || err instanceof FunctionTimeoutError) {
      throw new PlaceholderError(
        `placeholder "{{${expr}}}" failed: ${err.message}`,
        err instanceof FunctionTimeoutError ? 'function_timeout' : 'function_error',
      )
    }
    throw err
  }
}

function resolvePlaceholder(expr: string, ctx: RequestContext, now: Date, options?: TemplateOptions): string {
  return stringifyForTrace(resolvePlaceholderTyped(expr, ctx, now, options))
}

// Trace/interpolation values readable for objects/arrays, not "[object Object]".
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
    // exec() on a /g regex advances lastIndex; PLACEHOLDER_RE is module-global
    // and shared with listPlaceholders, so leaving it set would make a later
    // matchAll start mid-string and miss placeholders.
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
