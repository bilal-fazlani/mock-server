import { Expr } from './expr'
import { extractValue, RequestContext } from '../catalog/selector'
import { renderNow } from './now'
import { PlaceholderError } from './template'
import { CompiledFn, DEFAULT_FN_TIMEOUT_MS, FnContext, FnValue, FunctionRuntimeError } from './functions'

export interface EvalDeps {
  ctx: RequestContext
  now: Date
  fnCtx?: FnContext
  functions?: Map<string, CompiledFn>
  timeoutMs?: number
}

type BuiltinTransform = (input: EvalValue, args: EvalValue[]) => EvalValue
// Widened to match FnValue: user functions may (and whole-string placeholders
// are documented to) return objects/arrays, not just scalars. Keeping this as
// an alias of FnValue means the call branch below can return fn.invoke()'s
// result without an unchecked cast.
export type EvalValue = FnValue

const BUILTIN_TRANSFORMS: Record<string, BuiltinTransform> = {
  upper: (input) => String(input ?? '').toUpperCase(),
}

// The only call names evaluate() can dispatch besides user functions.
// Task 9 validates call names against this set ∪ the endpoint's user table —
// never against RESERVED_NAMES.
export const CALLABLE_BUILTINS = new Set(Object.keys(BUILTIN_TRANSFORMS))

// Names a user function may never export (Task 6 reads this): the syntactic
// forms (parsed into dedicated AST nodes, not callable) plus every callable
// built-in.
export const RESERVED_NAMES = new Set<string>([
  'now', 'body', 'path', 'query', 'profileKey',
  ...CALLABLE_BUILTINS,
])

export function evaluate(expr: Expr, deps: EvalDeps): EvalValue {
  switch (expr.kind) {
    case 'lit':
      return expr.value
    case 'now':
      return renderNow(expr.spec, deps.now)
    case 'selector': {
      const extraction = extractValue(expr.selector, deps.ctx)
      if (!extraction.found) {
        throw new PlaceholderError(`placeholder "{{${expr.raw}}}" did not resolve against the request`)
      }
      // A resolved selector carries any JSON value — booleans, JSON null, and
      // whole object/array subtrees all round-trip through the same typed
      // channel as #12's literals and function returns. The body is parsed
      // JSON, so its values are structurally FnValue.
      return extraction.value as EvalValue
    }
    case 'call': {
      const args = expr.args.map((a) => evaluate(a, deps))
      const builtin = BUILTIN_TRANSFORMS[expr.name]
      if (builtin) return builtin(args[0] ?? null, args.slice(1))
      const fn = deps.functions?.get(expr.name)
      if (fn) {
        if (!deps.fnCtx) throw new PlaceholderError(`function "${expr.name}" needs request context`)
        const result = fn.invoke(deps.fnCtx, args, deps.timeoutMs ?? DEFAULT_FN_TIMEOUT_MS)
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
  return null
}
