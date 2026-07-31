import type { Faker } from '@faker-js/faker'
import { RequestContext } from '../catalog/selector'
import { ExprParseError, parseExpr } from './expr'
import { evaluate, EvalValue, OMIT, Omit } from './evaluate'
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
  /** Generator behind `{{uuid}}`; defaults to `crypto.randomUUID` (#10). */
  uuid?: () => string
  /**
   * Per-response memo for grouped `{{uuid:X}}` (#36). Shared across the body
   * and header resolveTemplate calls of one request so a group named in both
   * agrees; route-request.ts creates it per request. See EvalDeps.uuidGroups.
   */
  uuidGroups?: Map<string, string>
  /**
   * Shared seeded generator behind `{{faker:module.method}}` (#15). Built once
   * per request in route-request.ts and passed to both the body and header
   * resolveTemplate calls, the same way `uuidGroups` is. See EvalDeps.faker.
   */
  faker?: Faker
  /**
   * Identifies the *caller* of this render — `${profileId ?? 'none'}:${endpoint.name}`
   * (route-request.ts already computes this as `fnCtx.seed`). Combined with
   * each placeholder's path by resolveTemplate to derive `EvalDeps.fakerSeed`
   * (#15). Absent means no path-based seed is computed — a bare evaluate()
   * call, or a resolveTemplate call that doesn't use `faker`.
   */
  seedMaterial?: string
  /**
   * Path segment this resolveTemplate call starts from — `'body'` for the
   * response body render, `'headers'` for the header render (#15), so the two
   * renders derive independent seeds even given the same seedMaterial and
   * relative structure. Defaults to `'body'`.
   */
  pathPrefix?: string
  fnCtx?: FnContext
  functions?: ReadonlyMap<string, CompiledFn>
  timeoutMs?: number
}

const PLACEHOLDER_RE = /\{\{(.+?)\}\}/g

/**
 * FNV-1a 32-bit hash. Stable across releases (documented) — used only to
 * derive a deterministic Faker seed from `seedMaterial + "|" + path` (#15), so
 * "the seed for this string" never depends on anything outside the algorithm
 * itself changing.
 */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function resolvePlaceholderTyped(
  expr: string,
  ctx: RequestContext,
  now: Date,
  path: string,
  options?: TemplateOptions,
): EvalValue | Omit {
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
    const fakerSeed = options?.seedMaterial !== undefined ? fnv1a32(`${options.seedMaterial}|${path}`) : undefined
    return evaluate(ast, { ctx, now, ...options, fakerSeed })
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

function resolvePlaceholder(
  expr: string,
  ctx: RequestContext,
  now: Date,
  path: string,
  options?: TemplateOptions,
): string {
  const value = resolvePlaceholderTyped(expr, ctx, now, path, options)
  // Reached only for interpolated placeholders (`"hi {{…}}"`), where `omit` has
  // no key to drop. validate.ts already rejects that at startup; this keeps a
  // gap there from emitting "Symbol(omit)" into the response instead of failing.
  if (value === OMIT) {
    throw new PlaceholderError(`"omit" is only valid as the whole value of a field, not inside "{{${expr}}}"`)
  }
  return stringifyForTrace(value)
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
  // Inner recursive walk carrying the JSON-path of `node` from the top-level
  // call, so each placeholder derives a per-(seedMaterial, path) `faker` seed
  // (#15) — object keys append `.key`, array indices `[i]`, and each
  // placeholder within a string node appends `#<occurrenceIndexInThatString>`
  // (0 for a whole-string placeholder). See fnv1a32 / resolvePlaceholderTyped.
  const walk = (n: unknown, path: string): unknown => {
    if (typeof n === 'string') {
      PLACEHOLDER_RE.lastIndex = 0
      const first = PLACEHOLDER_RE.exec(n)
      // exec() on a /g regex advances lastIndex; PLACEHOLDER_RE is module-global
      // and shared with listPlaceholders, so leaving it set would make a later
      // matchAll start mid-string and miss placeholders.
      PLACEHOLDER_RE.lastIndex = 0
      if (first && first[0] === n) {
        // A whole-string placeholder is evaluated typed in *both* modes so OMIT
        // can propagate to the parent container (#24). In stringOnly (headers)
        // mode a surviving value is then coerced to a string, matching #12's
        // "headers render as strings" — the only difference from the typed body
        // path is that final stringification.
        const value = resolvePlaceholderTyped(first[1], ctx, now, `${path}#0`, options)
        if (value === OMIT) {
          if (resolutions) resolutions[n] = '(omitted)'
          return OMIT
        }
        const out = options?.stringOnly ? stringifyForTrace(value) : value
        if (resolutions) resolutions[n] = stringifyForTrace(value)
        return out
      }
      let occurrence = 0
      return n.replace(PLACEHOLDER_RE, (_, expr: string) => {
        const value = resolvePlaceholder(expr, ctx, now, `${path}#${occurrence}`, options)
        occurrence++
        if (resolutions) resolutions[`{{${expr}}}`] = value
        return value
      })
    }
    if (Array.isArray(n)) {
      // OMIT cannot legally appear as an array element — validate.ts rejects
      // `omit` there at startup — so a filter would be dead code; map straight.
      return n.map((item, i) => walk(item, `${path}[${i}]`))
    }
    if (n !== null && typeof n === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(n)) {
        const resolved = walk(v, `${path}.${k}`)
        // An `omit` that fired drops its key from the object (or the headers map).
        if (resolved !== OMIT) out[k] = resolved
      }
      return out
    }
    return n
  }
  return walk(node, options?.pathPrefix ?? 'body')
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
