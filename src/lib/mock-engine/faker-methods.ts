import type { Faker } from '@faker-js/faker'
import type { Expr } from './expr'

/**
 * Allowlisted data modules for `{{faker:module.method}}` (#15). Only modules
 * that generate fake *data* are exposed — `helpers` (arrayElement, slugify,
 * etc.) and `image` (network calls / placeholder URLs, not deterministic pure
 * data) are deliberately excluded, as are any internal/private members. Kept
 * as a set (rather than deriving it from the Faker instance's own keys) so the
 * allowlist is an explicit, reviewable decision independent of what a given
 * faker version happens to expose.
 */
export const EXPOSED_FAKER_MODULES: ReadonlySet<string> = new Set([
  'person',
  'internet',
  'location',
  'commerce',
  'company',
  'lorem',
  'number',
  'date',
  'string',
  'color',
  'animal',
  'music',
  'science',
  'vehicle',
  'word',
  'phone',
  'finance',
  'database',
  'git',
  'food',
  'book',
  'airline',
  'hacker',
])

/**
 * A curated method whose positional placeholder args (`{{faker:number.int:1:100}}`)
 * map onto the options object Faker's method actually expects, rather than the
 * bare positional call every other exposed method gets. `validate` inspects
 * the *unevaluated* call arguments at catalog load (Task 6 wires it in) — it is
 * defined here, next to the shape it validates, even though nothing calls it
 * yet.
 */
export interface FakerArgSpec {
  /** Exact number of placeholder arguments this method takes (beyond the path). */
  params: number
  /** Invoke the method with positional args marshalled into Faker's expected shape. */
  call: (fn: Faker, module: string, method: string, args: (string | number | boolean)[]) => unknown
  /** Returns an error message for an invalid literal argument list, or null if valid. */
  validate: (args: Expr[]) => string | null
}

function literalNumber(expr: Expr | undefined): number | null {
  if (!expr || expr.kind !== 'lit' || typeof expr.value !== 'number') return null
  return expr.value
}

function nonNegativeIntegerSpec(paramName = 'argument'): (args: Expr[]) => string | null {
  return (args) => {
    const n = literalNumber(args[0])
    if (n === null || !Number.isInteger(n) || n < 0) {
      return `expects a non-negative integer literal ${paramName}`
    }
    return null
  }
}

function positiveIntegerSpec(paramName = 'argument'): (args: Expr[]) => string | null {
  return (args) => {
    const n = literalNumber(args[0])
    if (n === null || !Number.isInteger(n) || n <= 0) {
      return `expects a positive integer literal ${paramName}`
    }
    return null
  }
}

function minMaxSpec(args: Expr[]): string | null {
  const min = literalNumber(args[0])
  const max = literalNumber(args[1])
  if (min === null || max === null) return 'expects two numeric literal arguments (min, max)'
  if (min > max) return 'expects min <= max'
  return null
}

/**
 * Keyed by `module.method` — the curated parameterized methods; everything
 * else exposed by an allowlisted module is called positionally with no
 * marshalling (see `resolveFakerMethod`).
 */
export const FAKER_ARG_SPECS: Record<string, FakerArgSpec> = {
  'number.int': {
    params: 2,
    call: (fn, _m, method, [min, max]) =>
      (fn.number as unknown as Record<string, (opts: { min: number; max: number }) => unknown>)[method]({
        min: Number(min),
        max: Number(max),
      }),
    validate: minMaxSpec,
  },
  'number.float': {
    params: 2,
    call: (fn, _m, method, [min, max]) =>
      (fn.number as unknown as Record<string, (opts: { min: number; max: number }) => unknown>)[method]({
        min: Number(min),
        max: Number(max),
      }),
    validate: minMaxSpec,
  },
  'string.alphanumeric': {
    params: 1,
    call: (fn, _m, method, [len]) =>
      (fn.string as unknown as Record<string, (n: number) => unknown>)[method](Number(len)),
    validate: nonNegativeIntegerSpec('length'),
  },
  'string.alpha': {
    params: 1,
    call: (fn, _m, method, [len]) =>
      (fn.string as unknown as Record<string, (n: number) => unknown>)[method](Number(len)),
    validate: nonNegativeIntegerSpec('length'),
  },
  'string.numeric': {
    params: 1,
    call: (fn, _m, method, [len]) =>
      (fn.string as unknown as Record<string, (n: number) => unknown>)[method](Number(len)),
    validate: nonNegativeIntegerSpec('length'),
  },
  'lorem.words': {
    params: 1,
    call: (fn, _m, method, [n]) => (fn.lorem as unknown as Record<string, (n: number) => unknown>)[method](Number(n)),
    validate: positiveIntegerSpec('count'),
  },
  'lorem.sentences': {
    params: 1,
    call: (fn, _m, method, [n]) => (fn.lorem as unknown as Record<string, (n: number) => unknown>)[method](Number(n)),
    validate: positiveIntegerSpec('count'),
  },
}

/**
 * Splits `path` (`module.method`) and returns a caller bound to `fn`, or null
 * when the module isn't allowlisted, the method doesn't exist, or it isn't a
 * function (guards against `helpers.*` and any non-method property). A
 * zero-arg data method (the common case — `person.firstName`) is called with
 * no arguments; a curated method in `FAKER_ARG_SPECS` goes through its `call`
 * to marshal positional placeholder args into Faker's options object.
 */
export function resolveFakerMethod(fn: Faker, path: string): ((args: (string | number | boolean)[]) => unknown) | null {
  const dot = path.indexOf('.')
  if (dot <= 0 || dot === path.length - 1) return null
  const moduleName = path.slice(0, dot)
  const methodName = path.slice(dot + 1)
  if (!EXPOSED_FAKER_MODULES.has(moduleName)) return null

  const mod = (fn as unknown as Record<string, unknown>)[moduleName]
  if (!mod || typeof mod !== 'object') return null
  const method = (mod as Record<string, unknown>)[methodName]
  if (typeof method !== 'function') return null

  const spec = FAKER_ARG_SPECS[path]
  if (spec) {
    return (args) => spec.call(fn, moduleName, methodName, args)
  }
  return () => (method as () => unknown).call(mod)
}
