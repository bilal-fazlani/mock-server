import type { Faker } from '@faker-js/faker'
import { Expr } from './expr'
import { extractValue, RequestContext } from '../catalog/selector'
import { renderNow } from './now'
import { PlaceholderError } from './template'
import { CompiledFn, DEFAULT_FN_TIMEOUT_MS, FnContext, FnValue, FunctionRuntimeError } from './functions'
import { resolveFakerMethod } from './faker-methods'

export interface EvalDeps {
  ctx: RequestContext
  now: Date
  /**
   * Generator behind `{{uuid}}` (#10). Injected the same way `now` is, so a
   * test can pin the value instead of asserting against a random one; the
   * request path leaves it unset and gets `crypto.randomUUID`.
   */
  uuid?: () => string
  /**
   * Per-response memo for grouped `{{uuid:X}}` (#36): group key → the single
   * UUID every placeholder sharing that key renders. Created once per request
   * in route-request.ts and shared across the body and header resolveTemplate
   * calls, so a group named in a header and in the body agree. Bare `{{uuid}}`
   * never touches it. When absent (a bare evaluate() call), a grouped `uuid`
   * falls back to a fresh value — grouping needs the shared map to have any
   * effect, since each placeholder is a separate evaluate().
   */
  uuidGroups?: Map<string, string>
  /**
   * Shared seeded generator behind `{{faker:module.method}}` (#15). One
   * instance per request, built in route-request.ts and threaded through both
   * the body and header `resolveTemplate` calls the same way `uuidGroups` is —
   * but unlike `uuidGroups` (a memo the built-in reads/writes), this is
   * re-seeded via `fakerSeed` immediately before every draw, so callers never
   * observe cross-placeholder draw order.
   */
  faker?: Faker
  /**
   * The 32-bit seed for *this* placeholder, derived by resolveTemplate from
   * `fnv1a32(seedMaterial + "|" + path)` (#15). `faker`/`pick` call
   * `deps.faker.seed(deps.fakerSeed)` immediately before drawing, so the same
   * (seedMaterial, path) always produces the same value regardless of what
   * else was rendered first (Model B) — undefined only for a bare evaluate()
   * call with no seedMaterial (e.g. some direct test calls).
   */
  fakerSeed?: number
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

/**
 * "Drop the field this placeholder is the value of" (#24), produced only by the
 * `omit` transform from a Missing input. Unlike Missing — which evaluate() turns
 * back into a 500 — OMIT is a *legal* result: evaluate() returns it and
 * resolveTemplate's container walk filters it out of the parent object/headers.
 * validate.ts rejects `omit` in any position where OMIT could not be filtered
 * (interpolation, array element, top-level body), so at runtime it only ever
 * surfaces as the whole value of an object property or header, and never
 * survives into a response body, header, or trace value.
 */
export const OMIT = Symbol('omit')
export type Omit = typeof OMIT

type EvalInternal = EvalValue | Missing | Omit

/**
 * Inclusive argument-count range (including the piped value), checked at
 * catalog load. A fixed-arity built-in has `min === max`; the range exists for
 * built-ins that accept an optional argument — `uuid` takes 0 or 1 (#36) — and
 * is the general mechanism the variadic generators to come (#14 `random`, #15
 * `faker`) inherit rather than each special-casing its own count. `max: null`
 * means unbounded — the variadic `faker`/`pick` built-ins (#15) have no upper
 * bound on argument count.
 */
export interface ArityRange {
  readonly min: number
  readonly max: number | null // null = unbounded
}

/** A built-in that takes a fixed number of arguments. */
const exact = (n: number): ArityRange => ({ min: n, max: n })

/** A built-in that takes at least `n` arguments, with no upper bound. */
const atLeast = (n: number): ArityRange => ({ min: n, max: null })

/** Render an arity range for an error message: `1`, `0-1`, or `1+` for unbounded. */
export function describeArity(a: ArityRange): string {
  if (a.max === null) return `${a.min}+`
  return a.min === a.max ? `${a.min}` : `${a.min}-${a.max}`
}

interface Builtin {
  /** Argument-count range including the piped value — checked at catalog load. */
  arity: ArityRange
  /** Whether a Missing argument reaches `apply` instead of short-circuiting. */
  absorbsMissing?: boolean
  /**
   * When set, every argument must be a *literal* — validate.ts rejects a
   * selector or a piped value at catalog load (#36 decision 2). `uuid`'s group
   * name is an opaque literal key; `{{uuid:$.orderId}}` and `{{$.x | uuid}}`
   * are undesigned and blocked at startup rather than half-working at runtime.
   */
  literalArgsOnly?: boolean
  /**
   * `deps` is here for the *source* built-ins — `uuid` and the seeded
   * generators that will follow it (#14, #15) — which produce a value out of
   * injected machinery rather than transforming a piped one. The transforms
   * ignore it.
   */
  apply: (args: EvalInternal[], deps: EvalDeps) => EvalInternal
}

// A string transform takes whatever the pipe carries, so it has to say what it
// does with a non-string. Scalars stringify — "{{$.count | upper}}" against a
// numeric field is a reasonable thing to write — but an object or an array has
// no meaningful string form: String() would quietly emit "[object Object]"
// into the response, which is never what the fixture author meant. That fails
// loudly instead (#13). JSON null never reaches here; see skipsTransform.
function asText(name: string, input: EvalInternal): string {
  if (typeof input === 'string') return input
  if (typeof input === 'number' || typeof input === 'boolean') return String(input)
  throw new PlaceholderError(
    `built-in "${name}" cannot transform ${Array.isArray(input) ? 'an array' : 'an object'}`,
  )
}

const BUILTIN_TRANSFORMS: Record<string, Builtin> = {
  upper: { arity: exact(1), apply: ([input]) => asText('upper', input).toUpperCase() },
  lower: { arity: exact(1), apply: ([input]) => asText('lower', input).toLowerCase() },
  trim: { arity: exact(1), apply: ([input]) => asText('trim', input).trim() },
  // The fallback fires for an absent path *and* for an explicit JSON null —
  // the one place in the pipeline that treats null as absence (#23 keeps it a
  // substitutable value everywhere else). An empty string is a real value and
  // passes through.
  default: {
    arity: exact(2),
    absorbsMissing: true,
    apply: ([input, fallback]) => (input instanceof Missing || input === null ? fallback : input),
  },
  // Drops the field when the source is *absent*. A present value — JSON null
  // included — passes through unchanged: null is a value the caller sent, so an
  // echo fixture mirrors it (this is where omit and default deliberately part —
  // default fills null, omit keeps it, #24). absorbsMissing so it sees the
  // marker directly rather than short-circuiting on it.
  omit: {
    arity: exact(1),
    absorbsMissing: true,
    apply: ([input]) => (input instanceof Missing ? OMIT : input),
  },
  // A *source*, not a transform: it takes no piped value, so "{{$.x | uuid}}"
  // (a piped value, 1 arg that is a selector) and "{{uuid:$.orderId}}" (a
  // selector argument) are catalog errors — the `literalArgsOnly` check in
  // validate.ts rejects the non-literal at load rather than half-working at
  // runtime (#36 decision 2). Registering it here (instead of as its own AST
  // node, the way `now` is) is what gives it name validation, the arity check,
  // reservation against user-function names, and pipe composition —
  // "{{uuid | upper}}" — with no further wiring.
  //
  // Bare "{{uuid}}" draws a fresh value per occurrence, so a fixture returning
  // a list gives every element a distinct id (#10). An optional argument names
  // a *group* (#36): every "{{uuid:X}}" sharing the key `String(X)` renders the
  // same value within one response, memoised in `deps.uuidGroups` — the map
  // route-request.ts creates per request and shares across the body and header
  // renders, so a "Location" header and a body field can carry one id. The name
  // is an opaque key, not a seed: it decides *which* placeholders agree, not
  // *what* value they produce.
  uuid: {
    arity: { min: 0, max: 1 },
    literalArgsOnly: true,
    apply: (args, deps) => {
      const gen = deps.uuid ?? crypto.randomUUID.bind(crypto)
      if (args.length === 0) return gen()
      const key = String(args[0])
      const groups = deps.uuidGroups
      if (!groups) return gen()
      const existing = groups.get(key)
      if (existing !== undefined) return existing
      const value = gen()
      groups.set(key, value)
      return value
    },
  },
  // Another *source*, like `uuid`: no piped value, so its first argument is the
  // `module.method` path and the rest are positional params for the curated
  // arg specs in faker-methods.ts (#15). `literalArgsOnly` for the same reason
  // as `uuid` — a selector or piped value as the method path/params is
  // undesigned and rejected at catalog load rather than half-working at
  // runtime. `atLeast(1)` because a bare path with no params ("person.firstName")
  // is the common case, but parameterized methods need more.
  //
  // Re-seeds `deps.faker` from `deps.fakerSeed` immediately before drawing
  // (Model B): determinism comes from re-seeding right before the call, not
  // from draw order, so a placeholder added elsewhere in the same response
  // never shifts this one's value.
  faker: {
    arity: atLeast(1),
    literalArgsOnly: true,
    apply: (args, deps) => {
      const [path, ...params] = args
      const fn = deps.faker
      if (!fn) throw new PlaceholderError('faker placeholder needs a faker instance')
      if (deps.fakerSeed !== undefined) fn.seed(deps.fakerSeed)
      const method = resolveFakerMethod(fn, String(path))
      if (!method) throw new PlaceholderError(`unknown faker method "${String(path)}"`)
      return method(params as (string | number | boolean)[]) as EvalValue
    },
  },
  // A third *source*: choose among the fixture author's own inline values
  // rather than a faker-generated one (#15). `literalArgsOnly` and `atLeast(1)`
  // for the same reasons as `faker` above; unlike `faker`, the args here are
  // themselves the candidate values, not a method path plus params, so they
  // pass through untouched — parseArg already typed them (#12), so
  // "{{pick:1:2:3}}" returns the number 2, not the string "2".
  //
  // Shares `faker`'s re-seed-immediately-before-drawing pattern (Model B): the
  // same faker instance backs both built-ins, so re-seeding right before this
  // draw is what keeps "{{pick:...}}" reproducible per (seedMaterial, path)
  // regardless of what else drew from `deps.faker` first.
  pick: {
    arity: atLeast(1),
    literalArgsOnly: true,
    apply: (args, deps) => {
      const fn = deps.faker
      if (!fn) throw new PlaceholderError('pick placeholder needs a faker instance')
      if (deps.fakerSeed !== undefined) fn.seed(deps.fakerSeed)
      return fn.helpers.arrayElement(args as EvalValue[])
    },
  },
}

// The only call names evaluate() can dispatch besides user functions.
// Task 9 validates call names against this set ∪ the endpoint's user table —
// never against RESERVED_NAMES.
export const CALLABLE_BUILTINS = new Set(Object.keys(BUILTIN_TRANSFORMS))

/** Declared argument-count range of a built-in, for the load-time arity check. */
export function builtinArity(name: string): ArityRange | undefined {
  return BUILTIN_TRANSFORMS[name]?.arity
}

/**
 * Whether every argument to this built-in must be a literal — `uuid`'s group
 * name (#36). validate.ts reads this to reject a selector or piped value at
 * catalog load; unknown/other built-ins return false.
 */
export function builtinRequiresLiteralArgs(name: string): boolean {
  return BUILTIN_TRANSFORMS[name]?.literalArgsOnly ?? false
}

// Names a user function may never export (Task 6 reads this): the syntactic
// forms (parsed into dedicated AST nodes, not callable) plus every callable
// built-in.
export const RESERVED_NAMES = new Set<string>([
  'now', 'body', 'path', 'query', 'header', 'profileKey',
  ...CALLABLE_BUILTINS,
])

// Returns EvalValue, or OMIT when the whole expression is an `omit` that fired
// on an absent source (#24). resolveTemplate is the only caller equipped to act
// on OMIT — it drops the containing key — and validate.ts guarantees `omit`
// appears only where that is possible.
export function evaluate(expr: Expr, deps: EvalDeps): EvalValue | Omit {
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
        if (args.length < builtin.arity.min || (builtin.arity.max !== null && args.length > builtin.arity.max)) {
          throw new PlaceholderError(
            `built-in "${expr.name}" takes ${describeArity(builtin.arity)} argument(s), got ${args.length}`,
          )
        }
        if (!builtin.absorbsMissing) {
          const missing = args.find((a) => a instanceof Missing)
          if (missing) return missing
          // A JSON null skips the transform the same way absence does, so
          // "{{$.x | upper | default:Guest}}" and "{{$.x | default:Guest}}"
          // agree, and the two kinds of empty behave identically wherever a
          // `default` is in the chain (#13). Unabsorbed, the null renders as
          // itself — it is a real value, unlike absence, which stays a 500.
          // Same shape as SQL: UPPER(NULL) is NULL, COALESCE absorbs it.
          if (args[0] === null) return null
        }
        return builtin.apply(args, deps)
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
