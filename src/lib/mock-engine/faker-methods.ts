import { Faker, en } from '@faker-js/faker'
import type { Expr } from './expr'

/**
 * A locale-seeded instance used *only* to answer "does this module/method
 * exist?" at catalog load — never to generate a value (that always goes
 * through the caller's own `deps.faker`, seeded per-request). Load-time
 * validation happens once per catalog load, well outside any request path, so
 * a dedicated instance here is cheap and keeps `validateFakerCall` pure with
 * respect to its arguments.
 */
const VALIDATION_FAKER = new Faker({ locale: [en] })

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
 * Splits `module.method`. Returns null when the path is malformed (no dot, or
 * a dot at either end).
 */
function splitPath(path: string): { moduleName: string; methodName: string } | null {
  const dot = path.indexOf('.')
  if (dot <= 0 || dot === path.length - 1) return null
  return { moduleName: path.slice(0, dot), methodName: path.slice(dot + 1) }
}

/**
 * Looks up `moduleName.methodName` on `fn`, returning the function or null
 * when the module isn't allowlisted, the property doesn't exist, isn't a
 * function, or — the case this guards against — resolves only via the
 * prototype chain rather than as the module's *own* property. Faker's
 * generated modules assign every real data method directly onto the module
 * instance (an own property), so `toString`, `constructor`, `valueOf`,
 * `hasOwnProperty`, etc. — inherited from `Object.prototype` and never
 * overridden — fail the `Object.hasOwn` check here and are treated as
 * "doesn't exist" rather than a callable method. Without this,
 * `{{faker:person.toString}}` would return junk and
 * `{{faker:person.constructor}}` would throw a raw `TypeError` that escapes
 * `PlaceholderError` wrapping into an unclassified 500.
 */
function ownFakerMethod(fn: Faker, moduleName: string, methodName: string): (() => unknown) | null {
  if (!EXPOSED_FAKER_MODULES.has(moduleName)) return null
  const mod = (fn as unknown as Record<string, unknown>)[moduleName]
  if (!mod || typeof mod !== 'object') return null
  if (!Object.hasOwn(mod, methodName)) return null
  const method = (mod as Record<string, unknown>)[methodName]
  if (typeof method !== 'function') return null
  return method as () => unknown
}

/**
 * Splits `path` (`module.method`) and returns a caller bound to `fn`, or null
 * when the module isn't allowlisted, the method doesn't exist, isn't a
 * function, or is only inherited from `Object.prototype` (see
 * `ownFakerMethod`). A zero-arg data method (the common case —
 * `person.firstName`) is called with no arguments; a curated method in
 * `FAKER_ARG_SPECS` goes through its `call` to marshal positional placeholder
 * args into Faker's options object.
 */
export function resolveFakerMethod(fn: Faker, path: string): ((args: (string | number | boolean)[]) => unknown) | null {
  const split = splitPath(path)
  if (!split) return null
  const { moduleName, methodName } = split
  const method = ownFakerMethod(fn, moduleName, methodName)
  if (!method) return null

  const mod = (fn as unknown as Record<string, unknown>)[moduleName]
  const spec = FAKER_ARG_SPECS[path]
  if (spec) {
    return (args) => spec.call(fn, moduleName, methodName, args)
  }
  return () => method.call(mod)
}

/**
 * Load-time validation for `{{faker:module.method[:arg...]}}` (Task 6, #15):
 * checks the method path names an exposed, existing method, and that any
 * params match its `FAKER_ARG_SPECS` entry (or that there are none, for the
 * common zero-arg case) — so a bad call fails at catalog load rather than
 * 500-ing on the first request that hits it.
 *
 * A missing or non-literal first argument is *not* flagged here: validate.ts
 * already runs the generic `atLeast(1)` arity check and `literalArgsOnly`
 * check for every built-in before this runs, and those already produce a
 * clearer message ("passes a non-literal argument…") for that case. Checking
 * again here would either duplicate it or, worse, try to treat a non-literal
 * `Expr` as a string path.
 */
export function validateFakerCall(args: Expr[]): string | null {
  const first = args[0]
  if (!first || first.kind !== 'lit' || typeof first.value !== 'string') return null
  const path = first.value

  const split = splitPath(path)
  if (!split) return `unknown faker method "${path}"; expected "module.method"`
  const { moduleName, methodName } = split

  if (!EXPOSED_FAKER_MODULES.has(moduleName)) {
    return `faker method "${path}" is not exposed (module "${moduleName}" is not in the allowlist)`
  }
  if (!ownFakerMethod(VALIDATION_FAKER, moduleName, methodName)) {
    return `unknown faker method "${path}"`
  }

  const params = args.slice(1)
  const spec = FAKER_ARG_SPECS[path]
  if (!spec) {
    return params.length > 0 ? `faker method "${path}" takes no arguments` : null
  }
  if (params.length !== spec.params) {
    return `faker method "${path}" expects ${spec.params} argument(s), got ${params.length}`
  }
  const err = spec.validate(params)
  return err ? `faker method "${path}" ${err}` : null
}
