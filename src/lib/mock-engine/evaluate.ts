import { Expr } from './expr'
import { extractValue, RequestContext } from '../catalog/selector'
import { renderNow } from './now'
import { PlaceholderError } from './template'
import { CompiledFn, DEFAULT_FN_TIMEOUT_MS, FnContext, FnValue, FunctionRuntimeError } from './functions'

export interface EvalDeps {
  ctx: RequestContext
  now: Date
  fnCtx?: FnContext
  functions?: ReadonlyMap<string, CompiledFn>
  timeoutMs?: number
}

// Widened to match FnValue: user functions may (and whole-string placeholders
// are documented to) return objects/arrays, not just scalars. Keeping this as
// an alias of FnValue means the call branch below can return fn.invoke()'s
// result without an unchecked cast.
export type EvalValue = FnValue

/**
 * An unresolved selector, as a value rather than a throw (#11). It travels up
 * the expression: a call handed a Missing argument returns it *without being
 * invoked*, so `{{$.name | trim | myFn | default:Guest}}` still reaches
 * `default`. Only a missing-absorbing built-in consumes it; anything else that
 * lets it escape to the top of the expression gets it turned back into the
 * PlaceholderError the selector branch used to throw directly, carrying the
 * same message. It never leaves evaluate(), so no response body, header, or
 * trace value can contain it.
 */
class Missing {
  constructor(readonly raw: string) {}
}

type EvalInternal = EvalValue | Missing

interface Builtin {
  /** Total arguments including the piped value — checked at catalog load. */
  arity: number
  /** Whether a Missing argument reaches `apply` instead of short-circuiting. */
  absorbsMissing?: boolean
  apply: (args: EvalInternal[]) => EvalInternal
}

const BUILTIN_TRANSFORMS: Record<string, Builtin> = {
  upper: { arity: 1, apply: ([input]) => String(input ?? '').toUpperCase() },
  // The fallback fires for an absent path *and* for an explicit JSON null —
  // the one place in the pipeline that treats null as absence (#23 keeps it a
  // substitutable value everywhere else). An empty string is a real value and
  // passes through.
  default: {
    arity: 2,
    absorbsMissing: true,
    apply: ([input, fallback]) => (input instanceof Missing || input === null ? fallback : input),
  },
}

// The only call names evaluate() can dispatch besides user functions.
// Task 9 validates call names against this set ∪ the endpoint's user table —
// never against RESERVED_NAMES.
export const CALLABLE_BUILTINS = new Set(Object.keys(BUILTIN_TRANSFORMS))

/** Declared argument count of a built-in, for the load-time arity check. */
export function builtinArity(name: string): number | undefined {
  return BUILTIN_TRANSFORMS[name]?.arity
}

// Names a user function may never export (Task 6 reads this): the syntactic
// forms (parsed into dedicated AST nodes, not callable) plus every callable
// built-in.
export const RESERVED_NAMES = new Set<string>([
  'now', 'body', 'path', 'query', 'header', 'profileKey',
  ...CALLABLE_BUILTINS,
])

export function evaluate(expr: Expr, deps: EvalDeps): EvalValue {
  const value = evalNode(expr, deps)
  if (value instanceof Missing) {
    throw new PlaceholderError(`placeholder "{{${value.raw}}}" did not resolve against the request`)
  }
  return value
}

function evalNode(expr: Expr, deps: EvalDeps): EvalInternal {
  switch (expr.kind) {
    case 'lit':
      return expr.value
    case 'now':
      return renderNow(expr.spec, deps.now)
    case 'selector': {
      const extraction = extractValue(expr.selector, deps.ctx)
      if (!extraction.found) return new Missing(expr.raw)
      // A resolved selector carries any JSON value — booleans, JSON null, and
      // whole object/array subtrees all round-trip through the same typed
      // channel as #12's literals and function returns. The body is parsed
      // JSON, so its values are structurally FnValue.
      return extraction.value as EvalValue
    }
    case 'call': {
      const args = expr.args.map((a) => evalNode(a, deps))
      const builtin = BUILTIN_TRANSFORMS[expr.name]
      if (builtin) {
        // validate.ts rejects a wrong argument count at catalog load, so this
        // is a backstop for callers that bypass the catalog (tests, future
        // non-fixture templating) rather than the primary check.
        if (args.length !== builtin.arity) {
          throw new PlaceholderError(
            `built-in "${expr.name}" takes ${builtin.arity} argument(s), got ${args.length}`,
          )
        }
        if (!builtin.absorbsMissing) {
          const missing = args.find((a) => a instanceof Missing)
          if (missing) return missing
        }
        return builtin.apply(args)
      }
      const fn = deps.functions?.get(expr.name)
      if (fn) {
        // A user function never sees an unresolved selector: absence
        // short-circuits past it, exactly as it does past a built-in. Authors
        // who want to handle absence write "{{$.x | default:'' | myFn}}".
        const missing = args.find((a) => a instanceof Missing)
        if (missing) return missing
        if (!deps.fnCtx) throw new PlaceholderError(`function "${expr.name}" needs request context`)
        const result = fn.invoke(deps.fnCtx, args as EvalValue[], deps.timeoutMs ?? DEFAULT_FN_TIMEOUT_MS)
        const unusable = describeUnusable(result)
        if (unusable) {
          throw new FunctionRuntimeError(`function "${expr.name}" returned ${unusable}, which cannot be used as a response value`)
        }
        return result
      }
      throw new PlaceholderError(`unknown function "${expr.name}" in placeholder`)
    }
  }
}

// The FnValue type promises string | number | boolean | null | arrays/objects
// of those, but nothing enforces that at the vm sandbox boundary — a user
// function can hand back undefined, a function, a symbol, or a bigint at
// runtime. Thrown as FunctionRuntimeError so it flows through the same
// placeholder-text wrapping as a genuine throw/timeout (see
// resolvePlaceholderTyped in template.ts).
function describeUnusable(value: unknown): string | null {
  if (value === undefined) return 'undefined'
  const t = typeof value
  if (t === 'function' || t === 'symbol' || t === 'bigint') return `a ${t}`
  // NaN/±Infinity are typeof "number" but have no JSON representation —
  // JSON.stringify silently turns them into null, so the response would carry
  // a null the author never wrote. Rejected loudly instead.
  if (t === 'number' && !Number.isFinite(value)) return String(value)
  return null
}
