# Function calling from fixture placeholders — design

**Status:** design approved, pending implementation plan
**Date:** 2026-07-18
**Issue:** [#20](https://github.com/bilal-fazlani/mock-server/issues/20)
**Re-scopes:** #13 (pipe filters), #14 (seeded randomness), #15 (Faker) — these
become built-in functions on the primitive defined here, not independent
placeholder mechanisms.
**Related:** #12 (type-preserving substitution) — co-lands with this.

## Problem

Fixture placeholders today are limited to a fixed built-in vocabulary — body
`$.…` selectors, `path:`, `query:`, `bearer:`, `profileKey:`, and `now`.
When that vocabulary can't express what a fixture needs (formatting, derived
values, combining request inputs, hashing, realistic fake data), the author has
no escape hatch: the value must be pre-baked into the fixture.

We want author-defined functions whose return value is substituted into the
response — the general escape hatch that the narrower proposals (#13/#14/#15)
are special cases of.

## The model — every placeholder is a function

The unifying decision: **a placeholder is an expression parsed into a
function-call AST, then evaluated once by a single evaluator.** Built-in and
user-defined functions share one grammar, one AST, one evaluation pipeline.

Two function namespaces, called identically:

- **Built-in functions** — trusted server code: `now`, `uuid`, `body`, `path`,
  `query`, `bearer`, `profileKey`, plus the transforms that absorb #13/#14/#15:
  `upper`, `lower`, `trim`, `base64`, `hash`, `random`, `faker`.
- **User functions** — named exports from `_functions.ts` / `_functions.mjs`
  files in the catalog (see **Scope** below).

Today's spellings (`now:iso`, `path:id`, `random:int:1:100`, `$.x`) already
*are* colon-delimited calls or body sugar, so they keep working — this is a
near-zero breaking change (see **Surface syntax**).

## Surface syntax — colon-primary + pipe

- **Call:** `name:arg:arg` — `now:iso`, `path:id`, `hash:sha256`,
  `random:int:1:100`
- **Nullary:** bare name — `uuid`, `bearer`
- **Body sugar:** `$.name` → the call `body:$.name`
- **Chains (composition):** `|` — `$.body.token | hash:sha256 | upper`

All spellings normalize into the **same function-call AST at parse time**, so
there is one evaluator underneath, not a legacy path plus a new path. Examples:

| Placeholder | Parsed AST |
| --- | --- |
| `now:iso` | `now('iso')` |
| `$.name` | `body('$.name')` |
| `random:int:1:100` | `random('int', 1, 100)` |
| `$.body.token \| hash:sha256 \| upper` | `upper(hash(body('$.body.token'), 'sha256'))` |

`x | f:a` desugars to `f(x, a)` — the pipe threads the previous value in as the
first argument.

### Deliberate limitation

Colon has no grouping, so a call cannot be **nested inside another call's
argument** except by threading the single value through `|`. Combining multiple
*request* inputs is handled inside the function via `context.request` (see
below), so this only bites for a function needing two independently-*computed*
non-request arguments (e.g. `max(discountA, discountB)`), or a non-body
secondary source (a header *alongside* the piped input). Those cases are rare;
the answer is a purpose-built user function. Paren-nesting
(`f(g(x), h(y))`) remains a possible **future, non-breaking** extension if real
demand appears.

## Function contract

```ts
type MockFn = (context: FnContext, ...args: FnValue[]) => FnValue

interface FnContext {
  request: {
    method: string
    path: string
    pathParams: Record<string, string>
    query: Record<string, string[]>
    headers: Record<string, string>
    body: unknown
  }
  now: Date
  seed: string // deterministic material derived from (profileId, endpoint)
}
```

- **Explicit params are the taught default.** Built-in examples and docs pass
  request data as arguments (`discount:$.price:0.2`); `context.request` is the
  escape hatch for the rare multi-source case, not the default. This keeps
  functions inspectable, testable, and reusable; the escape hatch stays
  available so headers/query remain reachable when genuinely needed.
- **`args` are pre-resolved** before the function runs: `$.x` selectors → their
  extracted values, literals → typed values (number/boolean/string), the piped
  value → first argument.
- Ships a `MockFn` (and `FnContext`) type export from the package so `.ts`
  authors get editor type-checking; runtime types are not checked.

## Execution — mirror the resolver

`_functions` files reuse the machinery already proven by the dynamic resolver
(`src/lib/mock-engine/resolver.ts`):

- **Transpile:** `esbuild.transformSync(source, { loader: 'ts', format: 'cjs',
  target: 'node18' })` for `.ts`; `.mjs` loaded natively. (`esbuild` is a
  production dependency; `tsx`/`typescript` are dev-only and not in the
  standalone bundle — the transpile path is the supported one.)
- **Sandbox:** evaluate in a `node:vm` context with an **empty sandbox** — no
  `require`/`process`/`fetch`/`console` leak from the host.
- **Timeout:** per-call timeout, reusing the `DEFAULT_DYNAMIC_TIMEOUT_MS = 100`
  pattern, with dedicated compile/runtime/timeout error classes.
- **Synchronous and I/O-free by construction** (no `fetch`/`require` in the
  sandbox) — `resolveTemplate` stays synchronous; no async render path; no
  external state to be non-deterministic.
- **Always-on, no opt-in gate.** The author already controls their catalog;
  loading a catalog already runs resolver code. The vm sandbox is the safety
  boundary, not a feature flag.
- Compiled **once at catalog load**, cached.

Named exports become callable functions; a `MockFn` shape is expected per
export. (Unlike the resolver's single default export, `_functions` uses named
exports — many functions per file.)

## Scope — catalog, system, endpoint (nearest wins)

`_functions.ts` / `.mjs` may live at three levels, mirroring the existing
per-level special files:

| Level | Location | Visible to |
| --- | --- | --- |
| Catalog | `catalog/_functions.ts` | every system/endpoint |
| System | `catalog/<system>/_functions.ts` (next to `_system.json`) | that system's endpoints |
| Endpoint | `catalog/<system>/<endpoint>/_functions.ts` (next to `_endpoint.json`) | that endpoint's fixtures |

Rules:

- **Resolution = nearest wins.** Resolving a name walks
  **endpoint → system → catalog → built-ins**; first match wins.
- **Built-in names are reserved.** A user function named `hash`/`now`/`body`/…
  is a **load error**, never a silent override — the built-in vocabulary stays
  stable and statically known.
- **User-vs-user across scopes = shadowing, allowed.** An endpoint `label`
  intentionally overrides a catalog-wide `label`. Duplicate names within one
  file are already impossible (JS forbids duplicate named exports).

## Static validation (`src/lib/catalog/validate.ts`)

- The whitelist for a given fixture is **built-ins ∪ the user functions visible
  from that fixture's location**.
- At load: parse every placeholder to its AST; reject **unknown function names**
  and **malformed expressions** (bad selectors, unbalanced syntax). A call to a
  function defined only in *another* system → unknown-function load error
  (genuine encapsulation).
- Argument *values/types* stay resolve-time (open-ended). Optional: check user
  function arity via `fn.length`.

## Type-preserving returns (co-lands with #12)

A function may return a typed value. Applying #12's rule to function returns:

- When the placeholder is the **entire string** and the return is non-string,
  emit the raw type: `"{{ discount:0.2 }}"` → `0.2` (number), an object, etc.
- When **interpolated** into surrounding text, coerce to string.

This is the same rule #12 defines for selectors, extended to function returns —
the two land together.

## Determinism

- Built-in `random`/`faker` are **seeded from `(profileId, endpoint)`** (the
  material already threaded through `resolveTemplate` for the resolver / #14 /
  #15), so a given caller sees stable values.
- User functions *can* still be non-deterministic (the vm exposes JS `Date` /
  `Math`). Docs steer authors to `context.now` and `context.seed`. Seed-shimming
  `Math.random` inside the sandbox is a possible nice-to-have, **not v1**.

## Error handling

A function that throws, exceeds its timeout, or returns something unusable →
**hard 500** naming the function and placeholder. This matches today's
unresolved-placeholder 500 and the resolver's runtime-error behavior. No silent
fallback.

## Implementation sketch

- `src/lib/mock-engine/functions.ts` (new) — compile `_functions` sources
  (transpile + vm), expose a resolved, scope-aware function table; generalizes
  the resolver's `compileResolver` (named exports vs default export).
- `src/lib/mock-engine/expr.ts` (new) — parse a placeholder string into the
  function-call AST (colon calls, `$` body sugar, `|` pipe desugaring, typed
  literals).
- `src/lib/mock-engine/template.ts` — `resolvePlaceholder` evaluates the AST
  against built-ins + the resolved user-function table; keep the `now`/`seed`
  threading.
- `src/lib/catalog/load.ts` — discover `_functions.{ts,mjs}` at the three
  levels; compile once; attach the resolved table per endpoint.
- `src/lib/catalog/validate.ts` — scope-aware whitelist validation over the AST.
- Package: export `MockFn` / `FnContext` types.

## Testing

- Parser: each spelling → expected AST; pipe desugaring; typed-literal
  inference; malformed inputs.
- Evaluator: built-ins; user functions; nearest-wins resolution; reserved-name
  clash; scope-encapsulation (cross-system call rejected).
- Execution: timeout, throw → 500; sandbox isolation (no host globals).
- Type preservation (whole-string vs interpolated) with #12.
- Determinism: seeded `random`/`faker` stable per `(profileId, endpoint)`.

## Docs impact (per AGENTS.md — ask before editing)

Guide-affecting: `building/fixtures.md` (placeholders/templating — the big one),
`reference/configuration.md` (validation rules), `reference/request-lifecycle.md`.
Ask before editing per the AGENTS.md workflow.

## Out of scope (v1)

- Paren-nesting of calls (`f(g(x))`).
- Async / I/O functions.
- Seed-shimming `Math.random` in the sandbox.
- Removing legacy colon/`$`/`|` spellings (they stay as parse-time forms).
