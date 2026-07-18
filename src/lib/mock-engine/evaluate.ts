import { Expr } from './expr'
import { extractValue, RequestContext } from '../catalog/selector'
import { renderNow } from './now'
import { PlaceholderError } from './template'

export interface EvalDeps {
  ctx: RequestContext
  now: Date
}

type BuiltinTransform = (input: EvalValue, args: EvalValue[]) => EvalValue
export type EvalValue = string | number | boolean | null

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
      const v = extractValue(expr.selector, deps.ctx)
      if (v === null) {
        throw new PlaceholderError(`placeholder "{{${expr.raw}}}" did not resolve against the request`)
      }
      return v
    }
    case 'call': {
      const args = expr.args.map((a) => evaluate(a, deps))
      const builtin = BUILTIN_TRANSFORMS[expr.name]
      if (builtin) return builtin(args[0] ?? null, args.slice(1))
      throw new PlaceholderError(`unknown function "${expr.name}" in placeholder`)
    }
  }
}
