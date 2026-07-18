# Function calling from fixture placeholders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every fixture placeholder into a call over a single function-call AST, so authors can invoke their own `_functions.ts`/`.mjs` functions (and built-in transforms) from placeholders, while today's `now`/`$.x`/`path:`/`query:`/`profileKey:` spellings keep working unchanged.

**Architecture:** A new expression parser (`expr.ts`) normalizes every placeholder — old spellings and new `name:arg:arg` calls with `|` pipes — into one `Expr` AST. A new evaluator (`evaluate.ts`) walks that AST against the request context, a small built-in registry, and a scope-resolved table of user functions. User functions are compiled once at catalog load by generalizing the existing dynamic-resolver machinery (`esbuild.transformSync` → `node:vm` empty sandbox → per-call timeout). Validation and `resolveTemplate` are rewired onto the AST; whole-string placeholders emit the raw typed value (co-lands #12).

**Tech Stack:** TypeScript, Next.js runtime, `esbuild` (production dep) for TS transpile, `node:vm` for sandboxing, Vitest for tests.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-18-function-calling-placeholders-design.md` — the authority for every decision below.
- **Near-zero breaking change:** all existing placeholder spellings (`now`, `now±<n><unit>:<format>`, `$.body.path`, `path:name`, `query:name`, `profileKey:ns:sel`) must keep resolving exactly as today. Existing tests in `tests/mock-engine/template.test.ts`, `tests/mock-engine/now.test.ts`, `tests/catalog/selector.test.ts`, `tests/catalog/validate.test.ts` must keep passing except where a task explicitly updates them for the #12 type-preservation change.
- **Reuse the resolver pattern verbatim** where possible: `src/lib/mock-engine/resolver.ts` is the reference for transpile + `vm` sandbox + timeout + realm-crossing error handling (`isTimeout`/`message` helpers). Do not invent a second sandbox style.
- **Sandbox is empty:** user functions get no `require`/`process`/`fetch`/`console`. Synchronous, I/O-free.
- **Built-in names are reserved:** `now`, `body`, `path`, `query`, `profileKey`, `upper` (the demonstrative transform) — a user function exporting any of these is a load error.
- **Tests:** Vitest. Run a single file with `npx vitest run <path>`. Test files live under `tests/` mirroring `src/lib/` paths.
- **Commits:** Conventional Commits. Use `feat(templating): …` for user-facing additions, `refactor(templating): …` for behavior-preserving internal changes, `test(templating): …` where a commit is tests-only. Never regenerate `package-lock.json` (no dependency changes in this plan).
- **Deferred to sibling issues (do NOT implement here):** the full #13 filter set (`lower`, `trim`, `base64`, `hash`), #14 `random`, #15 `faker`, #10 `uuid`, and paren-nesting. This plan ships only the primitive plus `upper` as the one demonstrative transform.

## File Structure

- `src/lib/mock-engine/expr.ts` (new) — the `Expr` AST, `parseExpr(raw)`, `callNames(expr)`. Pure; no evaluation, no I/O.
- `src/lib/mock-engine/functions.ts` (new) — `FnContext`, `FnValue`, `MockFn` types; `compileFunctions(source, label, loader)` → map of named `CompiledFn`; compile/runtime/timeout error classes. Generalizes `resolver.ts`.
- `src/lib/mock-engine/functions-load.ts` (new) — discover `_functions.{ts,mjs}` at catalog/system/endpoint levels, compile each, expose `resolveTable(systemSlug, endpointName)` with nearest-wins + reserved-name clash detection.
- `src/lib/mock-engine/evaluate.ts` (new) — `evaluate(expr, deps)`; the built-in transform registry (`upper`); user-function dispatch with timeout.
- `src/lib/mock-engine/template.ts` (modify) — `resolveTemplate`/`resolvePlaceholder` rewired onto `parseExpr` + `evaluate`; whole-string type preservation; keep `listPlaceholders`.
- `src/lib/catalog/validate.ts` (modify) — AST-based, scope-aware placeholder validation.
- `src/lib/catalog/load.ts` (modify) — invoke `functions-load` during load; surface its problems; attach the resolver-table accessor to the loaded catalog.
- `src/lib/router/route-request.ts` (modify) — build `FnContext` + seed, fetch the endpoint's function table, pass both into `resolveTemplate`.
- `catalog/hello-system/_functions.ts` (new, Task 10) — worked example.
- Tests mirror each new/modified source file under `tests/`.

---

### Task 1: Expression AST + parser (`expr.ts`)

**Files:**
- Create: `src/lib/mock-engine/expr.ts`
- Test: `tests/mock-engine/expr.test.ts`

**Interfaces:**
- Consumes: `parseNow`/`NowSpec` from `src/lib/mock-engine/now.ts`; `parseSelector`/`Selector`/`SelectorParseError` from `src/lib/catalog/selector.ts`.
- Produces:
  ```ts
  export type Expr =
    | { kind: 'lit'; value: string | number | boolean }
    | { kind: 'selector'; raw: string; selector: Selector }
    | { kind: 'now'; spec: NowSpec }
    | { kind: 'call'; name: string; args: Expr[] }
  export class ExprParseError extends Error {}
  export function parseExpr(raw: string): Expr           // throws ExprParseError
  export function callNames(expr: Expr): string[]        // dedup not required
  ```
  Grammar: a placeholder is `stage ('|' stage)*`. The leftmost stage is the source; each subsequent `| stage` desugars so the previous expression becomes the stage call's **first** argument (`x | f:a` → `call f [x, a]`). A stage is one of: a `now…` token → `now` node (via `parseNow`); a token starting with `$`, `path:`, `query:`, `profileKey:` → `selector` node (via `parseSelector`); otherwise a call `name(:arg)*` where `name` matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. A call arg is: a decimal number → `lit` number; `true`/`false` → `lit` boolean; a `'single-quoted'` string → `lit` string (quotes stripped); a `$…` token → `selector` node; any other bare token → `lit` string. Piped (non-leading) stages must be calls (a `now`/selector cannot appear after `|`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/mock-engine/expr.test.ts
import { describe, expect, it } from 'vitest'
import { parseExpr, callNames, ExprParseError } from '../../src/lib/mock-engine/expr'

describe('parseExpr', () => {
  it('parses a bare body selector', () => {
    expect(parseExpr('$.name')).toEqual({
      kind: 'selector',
      raw: '$.name',
      selector: { source: 'body', segments: ['name'] },
    })
  })

  it('parses now with offset+format', () => {
    expect(parseExpr('now+1d:iso')).toEqual({
      kind: 'now',
      spec: { offsetMs: 86_400_000, format: 'iso' },
    })
  })

  it('parses a colon call with typed literal args', () => {
    expect(parseExpr('random:int:1:100')).toEqual({
      kind: 'call',
      name: 'random',
      args: [
        { kind: 'lit', value: 'int' },
        { kind: 'lit', value: 1 },
        { kind: 'lit', value: 100 },
      ],
    })
  })

  it('desugars a pipe so the prior expr is the first arg', () => {
    expect(parseExpr('$.name | upper')).toEqual({
      kind: 'call',
      name: 'upper',
      args: [{ kind: 'selector', raw: '$.name', selector: { source: 'body', segments: ['name'] } }],
    })
  })

  it('chains multiple pipes left to right', () => {
    const e = parseExpr('$.tok | hash:sha256 | upper')
    expect(e).toEqual({
      kind: 'call',
      name: 'upper',
      args: [{
        kind: 'call',
        name: 'hash',
        args: [
          { kind: 'selector', raw: '$.tok', selector: { source: 'body', segments: ['tok'] } },
          { kind: 'lit', value: 'sha256' },
        ],
      }],
    })
  })

  it('strips single quotes for forced string literals', () => {
    expect(parseExpr("pad:'007'")).toEqual({
      kind: 'call',
      name: 'pad',
      args: [{ kind: 'lit', value: '007' }],
    })
  })

  it('collects call names across a chain', () => {
    expect(callNames(parseExpr('$.tok | hash:sha256 | upper')).sort()).toEqual(['hash', 'upper'])
  })

  it('rejects a now/selector after a pipe', () => {
    expect(() => parseExpr('$.a | $.b')).toThrow(ExprParseError)
  })

  it('rejects an empty stage', () => {
    expect(() => parseExpr('$.a |')).toThrow(ExprParseError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-engine/expr.test.ts`
Expected: FAIL — `Cannot find module '.../expr'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mock-engine/expr.ts
import { NowSpec, parseNow, NowFormatError } from './now'
import { parseSelector, Selector, SelectorParseError } from '../catalog/selector'

export type Expr =
  | { kind: 'lit'; value: string | number | boolean }
  | { kind: 'selector'; raw: string; selector: Selector }
  | { kind: 'now'; spec: NowSpec }
  | { kind: 'call'; name: string; args: Expr[] }

export class ExprParseError extends Error {}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function parseExpr(raw: string): Expr {
  const stages = raw.split('|').map((s) => s.trim())
  if (stages.some((s) => s.length === 0)) {
    throw new ExprParseError(`invalid placeholder "{{${raw}}}": empty stage`)
  }
  let expr = parseSource(stages[0], raw)
  for (let i = 1; i < stages.length; i++) {
    const call = parseCall(stages[i], raw)
    if (call.kind !== 'call') {
      throw new ExprParseError(`invalid placeholder "{{${raw}}}": only functions may follow "|"`)
    }
    call.args.unshift(expr)
    expr = call
  }
  return expr
}

function parseSource(stage: string, raw: string): Expr {
  const now = tryNow(stage, raw)
  if (now) return now
  if (isSelectorToken(stage)) return selectorNode(stage, raw)
  return parseCall(stage, raw)
}

function tryNow(stage: string, raw: string): Expr | null {
  try {
    const spec = parseNow(stage)
    return spec ? { kind: 'now', spec } : null
  } catch (err) {
    if (err instanceof NowFormatError) throw new ExprParseError(err.message)
    throw err
  }
}

function isSelectorToken(t: string): boolean {
  return (
    t.startsWith('$') ||
    t.startsWith('path:') ||
    t.startsWith('query:') ||
    t.startsWith('profileKey:')
  )
}

function selectorNode(token: string, raw: string): Expr {
  try {
    return { kind: 'selector', raw: token, selector: parseSelector(token) }
  } catch (err) {
    if (err instanceof SelectorParseError) throw new ExprParseError(err.message)
    throw err
  }
}

function parseCall(stage: string, raw: string): Expr {
  const parts = splitArgs(stage)
  const name = parts[0]
  if (!NAME_RE.test(name)) {
    throw new ExprParseError(`invalid placeholder "{{${raw}}}": bad function name "${name}"`)
  }
  const args = parts.slice(1).map((p) => parseArg(p, raw))
  return { kind: 'call', name, args }
}

// Colon-separated, but a single-quoted segment may itself contain colons.
function splitArgs(stage: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of stage) {
    if (ch === "'") inQuote = !inQuote
    if (ch === ':' && !inQuote) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function parseArg(token: string, raw: string): Expr {
  if (token.startsWith("'") && token.endsWith("'") && token.length >= 2) {
    return { kind: 'lit', value: token.slice(1, -1) }
  }
  if (token === 'true') return { kind: 'lit', value: true }
  if (token === 'false') return { kind: 'lit', value: false }
  if (/^-?\d+(\.\d+)?$/.test(token)) return { kind: 'lit', value: Number(token) }
  if (token.startsWith('$')) return selectorNode(token, raw)
  return { kind: 'lit', value: token }
}

export function callNames(expr: Expr): string[] {
  const out: string[] = []
  const walk = (e: Expr): void => {
    if (e.kind === 'call') {
      out.push(e.name)
      e.args.forEach(walk)
    }
  }
  walk(expr)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-engine/expr.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/expr.ts tests/mock-engine/expr.test.ts
git commit -m "feat(templating): add placeholder expression parser and AST"
```

---

### Task 2: Rewire `resolveTemplate` onto the AST (behavior-preserving)

**Files:**
- Modify: `src/lib/mock-engine/template.ts`
- Create: `src/lib/mock-engine/evaluate.ts`
- Test: `tests/mock-engine/template.test.ts` (existing — must keep passing)

**Interfaces:**
- Consumes: `Expr`, `parseExpr` from Task 1; `extractValue`, `RequestContext` from `selector.ts`; `renderNow` from `now.ts`.
- Produces:
  ```ts
  // evaluate.ts
  export interface EvalDeps {
    ctx: RequestContext
    now: Date
    // Task 8 adds: fnCtx, functions, timeoutMs
  }
  export function evaluate(expr: Expr, deps: EvalDeps): string | number | boolean | null
  // template.ts keeps: resolveTemplate(node, ctx, now, resolutions?), listPlaceholders, PlaceholderError
  ```
  This task does NOT change `resolveTemplate`'s signature or return-string behavior; it only swaps the internals (`parseNow`/`parseSelector` branches) for `parseExpr` + `evaluate`. The only built-in transform registered is `upper` (used in Task 3's tests; harmless here).

- [ ] **Step 1: Write the failing test** (new cases appended to the existing file; existing cases stay)

```ts
// tests/mock-engine/template.test.ts — add inside the existing describe('resolveTemplate', …)
  it('still stringifies a sole numeric selector (pre-#12 behavior preserved in this task)', () => {
    const c = ctx({ body: { amount: 42 } })
    expect(resolveTemplate({ a: '{{$.amount}}' }, c, now)).toEqual({ a: '42' })
  })

  it('throws PlaceholderError for an unresolved selector', () => {
    expect(() => resolveTemplate({ a: '{{$.missing}}' }, ctx(), now)).toThrow(PlaceholderError)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-engine/template.test.ts`
Expected: the two new cases FAIL only if internals are broken; the intent is that after Step 3 **all** cases (old + new) pass. Run now to capture the current baseline (old cases PASS, new cases may PASS already since behavior matches — that is fine; this task is a refactor guarded by the whole existing suite).

- [ ] **Step 3: Write minimal implementation**

Create `evaluate.ts`:

```ts
// src/lib/mock-engine/evaluate.ts
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

// Names that may never be used as a user function (Task 7 reads this).
export const RESERVED_NAMES = new Set<string>([
  'now', 'body', 'path', 'query', 'profileKey',
  ...Object.keys(BUILTIN_TRANSFORMS),
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
```

Rewrite `resolvePlaceholder` in `template.ts` to delegate (keep everything else, including `PlaceholderError`, `PLACEHOLDER_RE`, `resolveTemplate` signature, and `listPlaceholders`):

```ts
// src/lib/mock-engine/template.ts — replace resolvePlaceholder's body
import { parseExpr, ExprParseError } from './expr'
import { evaluate } from './evaluate'
// (remove the now/selector imports that are no longer used directly)

function resolvePlaceholder(expr: string, ctx: RequestContext, now: Date): string {
  let ast
  try {
    ast = parseExpr(expr)
  } catch (err) {
    if (err instanceof ExprParseError) {
      throw new PlaceholderError(`invalid placeholder "{{${expr}}}": ${err.message}`)
    }
    throw err
  }
  return String(evaluate(ast, { ctx, now }))
}
```

Note: `evaluate.ts` imports `PlaceholderError` from `template.ts` and `template.ts` imports `evaluate` from `evaluate.ts` — this cycle is safe because `PlaceholderError` is only referenced at call time, not at module top level. If the runtime complains, move `PlaceholderError` into `evaluate.ts` and re-export it from `template.ts`.

- [ ] **Step 4: Run the full mock-engine + catalog suites**

Run: `npx vitest run tests/mock-engine tests/catalog`
Expected: PASS — every existing case plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/template.ts src/lib/mock-engine/evaluate.ts tests/mock-engine/template.test.ts
git commit -m "refactor(templating): resolve placeholders through the expression AST"
```

---

### Task 3: Pipe composition with the `upper` built-in

**Files:**
- Test: `tests/mock-engine/template.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–2. No new production code — `upper` and pipe parsing already exist; this task proves them end-to-end through `resolveTemplate` and locks the behavior with tests.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mock-engine/template.test.ts — add
  it('applies a built-in transform through a pipe', () => {
    const c = ctx({ body: { name: 'bilal' } })
    expect(resolveTemplate({ n: '{{$.name | upper}}' }, c, now)).toEqual({ n: 'BILAL' })
  })

  it('errors on an unknown function name at resolve time', () => {
    expect(() => resolveTemplate({ n: '{{$.name | bogus}}' }, ctx({ body: { name: 'x' } }), now))
      .toThrow(PlaceholderError)
  })
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/mock-engine/template.test.ts`
Expected: PASS (implementation already present from Tasks 1–2). If FAIL, fix `evaluate`/`parseExpr` until green.

- [ ] **Step 3: (no implementation needed — proof task)**

- [ ] **Step 4: Commit**

```bash
git add tests/mock-engine/template.test.ts
git commit -m "test(templating): cover pipe composition with the upper built-in"
```

---

### Task 4: Type-preserving whole-string returns (co-lands #12)

**Files:**
- Modify: `src/lib/mock-engine/template.ts`
- Test: `tests/mock-engine/template.test.ts`

**Interfaces:**
- Produces: `resolveTemplate` now returns the **raw typed value** when a string is exactly one placeholder (`^{{…}}$`); interpolated placeholders still coerce to string. `evaluate` already returns typed values.

- [ ] **Step 1: Write the failing test** (and update the Task-2 preservation test to the new behavior)

```ts
// tests/mock-engine/template.test.ts
  it('emits a raw number when the whole string is a numeric selector (#12)', () => {
    const c = ctx({ body: { amount: 42 } })
    expect(resolveTemplate({ a: '{{$.amount}}' }, c, now)).toEqual({ a: 42 })
  })

  it('coerces to string when interpolated into surrounding text', () => {
    const c = ctx({ body: { amount: 42 } })
    expect(resolveTemplate({ a: 'total: {{$.amount}}' }, c, now)).toEqual({ a: 'total: 42' })
  })
```

Delete/replace the Task-2 case titled *"still stringifies a sole numeric selector"* — that behavior is intentionally superseded here.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-engine/template.test.ts`
Expected: FAIL — sole numeric selector currently yields `'42'`, not `42`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mock-engine/template.ts — replace the string branch of resolveTemplate
const SOLE_PLACEHOLDER_RE = /^\{\{(.+?)\}\}$/

// inside resolveTemplate, the `typeof node === 'string'` branch:
  if (typeof node === 'string') {
    const sole = SOLE_PLACEHOLDER_RE.exec(node)
    if (sole) {
      const value = resolvePlaceholderTyped(sole[1], ctx, now)
      if (resolutions) resolutions[`{{${sole[1]}}}`] = String(value)
      return value
    }
    return node.replace(PLACEHOLDER_RE, (_, expr: string) => {
      const value = resolvePlaceholder(expr, ctx, now) // string form
      if (resolutions) resolutions[`{{${expr}}}`] = value
      return value
    })
  }
```

Add a typed sibling that returns the raw value (and refactor `resolvePlaceholder` to reuse the parse):

```ts
// src/lib/mock-engine/template.ts
import { EvalValue } from './evaluate'

function resolvePlaceholderTyped(expr: string, ctx: RequestContext, now: Date): EvalValue {
  let ast
  try {
    ast = parseExpr(expr)
  } catch (err) {
    if (err instanceof ExprParseError) {
      throw new PlaceholderError(`invalid placeholder "{{${expr}}}": ${err.message}`)
    }
    throw err
  }
  return evaluate(ast, { ctx, now })
}

function resolvePlaceholder(expr: string, ctx: RequestContext, now: Date): string {
  return String(resolvePlaceholderTyped(expr, ctx, now))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-engine tests/catalog`
Expected: PASS — new #12 cases plus the whole suite. Fix any other test that assumed a whole-string numeric became a string (update to the typed value; that is the intended #12 change).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/template.ts tests/mock-engine/template.test.ts
git commit -m "feat(templating): emit raw typed value for whole-string placeholders (#12)"
```

---

### Task 5: Function contract + compilation (`functions.ts`)

**Files:**
- Create: `src/lib/mock-engine/functions.ts`
- Test: `tests/mock-engine/functions.test.ts`

**Interfaces:**
- Consumes: `esbuild` (`transformSync`), `node:vm` — mirror `resolver.ts` (copy its `isTimeout`/`message` realm-crossing helpers).
- Produces:
  ```ts
  export type FnValue = string | number | boolean | null | FnValue[] | { [k: string]: FnValue }
  export interface FnContext {
    request: { method: string; path: string; pathParams: Record<string, string>
               query: Record<string, string[]>; headers: Record<string, string>; body: unknown }
    now: Date
    seed: string
  }
  export type MockFn = (context: FnContext, ...args: FnValue[]) => FnValue
  export interface CompiledFn { invoke(ctx: FnContext, args: FnValue[], timeoutMs: number): FnValue }
  export const DEFAULT_FN_TIMEOUT_MS = 100
  export class FunctionCompileError extends Error {}
  export class FunctionRuntimeError extends Error {}
  export class FunctionTimeoutError extends Error {}
  export function compileFunctions(source: string, label: string, loader: 'ts' | 'js'): Map<string, CompiledFn>
  ```
  `compileFunctions` transpiles (`loader: 'ts'` uses `transformSync`; `'js'` skips transpile), evaluates in an empty `vm` sandbox, and returns one `CompiledFn` per **named function export** (ignore non-function exports). Each `invoke` runs `__exports[name](__ctx, ...__args)` in the sandbox with `{ timeout }`, mapping vm timeouts to `FunctionTimeoutError` and other throws to `FunctionRuntimeError`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mock-engine/functions.test.ts
import { describe, expect, it } from 'vitest'
import {
  compileFunctions, FunctionRuntimeError, FunctionTimeoutError, FunctionCompileError, FnContext,
} from '../../src/lib/mock-engine/functions'

const ctx: FnContext = {
  request: { method: 'GET', path: '/x', pathParams: {}, query: {}, headers: {}, body: { name: 'bilal' } },
  now: new Date('2026-07-18T00:00:00.000Z'),
  seed: 'p:end',
}

describe('compileFunctions', () => {
  it('compiles named TS exports into callable functions', () => {
    const fns = compileFunctions(
      `export function label(ctx: any, tier: string) { return tier + ':' + ctx.request.body.name }`,
      '_functions.ts', 'ts',
    )
    expect(fns.get('label')!.invoke(ctx, ['gold'], 100)).toBe('gold:bilal')
  })

  it('can return a typed non-string value', () => {
    const fns = compileFunctions(`export function two() { return 2 }`, 'f', 'js')
    expect(fns.get('two')!.invoke(ctx, [], 100)).toBe(2)
  })

  it('wraps a throwing function as FunctionRuntimeError', () => {
    const fns = compileFunctions(`export function boom() { throw new Error('nope') }`, 'f', 'js')
    expect(() => fns.get('boom')!.invoke(ctx, [], 100)).toThrow(FunctionRuntimeError)
  })

  it('enforces the timeout', () => {
    const fns = compileFunctions(`export function spin() { while (true) {} }`, 'f', 'js')
    expect(() => fns.get('spin')!.invoke(ctx, [], 20)).toThrow(FunctionTimeoutError)
  })

  it('has no host globals in the sandbox', () => {
    const fns = compileFunctions(`export function leak() { return typeof process }`, 'f', 'js')
    expect(fns.get('leak')!.invoke(ctx, [], 100)).toBe('undefined')
  })

  it('rejects a syntactically broken source', () => {
    expect(() => compileFunctions(`export function (`, 'f', 'ts')).toThrow(FunctionCompileError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-engine/functions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (adapt `resolver.ts`)

```ts
// src/lib/mock-engine/functions.ts
import vm from 'node:vm'
import { transformSync } from 'esbuild'

export type FnValue = string | number | boolean | null | FnValue[] | { [k: string]: FnValue }
export interface FnContext {
  request: {
    method: string; path: string; pathParams: Record<string, string>
    query: Record<string, string[]>; headers: Record<string, string>; body: unknown
  }
  now: Date
  seed: string
}
export type MockFn = (context: FnContext, ...args: FnValue[]) => FnValue
export interface CompiledFn { invoke(ctx: FnContext, args: FnValue[], timeoutMs: number): FnValue }

export const DEFAULT_FN_TIMEOUT_MS = 100
export class FunctionCompileError extends Error {}
export class FunctionRuntimeError extends Error {}
export class FunctionTimeoutError extends Error {}

export function compileFunctions(source: string, label: string, loader: 'ts' | 'js'): Map<string, CompiledFn> {
  let code = source
  if (loader === 'ts') {
    try {
      code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node18' }).code
    } catch (err) {
      throw new FunctionCompileError(`${label}: failed to transpile: ${message(err)}`)
    }
  } else {
    try {
      code = transformSync(source, { loader: 'js', format: 'cjs', target: 'node18' }).code
    } catch (err) {
      throw new FunctionCompileError(`${label}: failed to load: ${message(err)}`)
    }
  }

  const sandbox: Record<string, unknown> = { module: { exports: {} } }
  sandbox.exports = (sandbox.module as { exports: unknown }).exports
  const context = vm.createContext(sandbox)
  try {
    new vm.Script(code, { filename: label }).runInContext(context, { timeout: 1000 })
  } catch (err) {
    throw new FunctionCompileError(`${label}: failed to evaluate: ${message(err)}`)
  }

  const mod = (sandbox.module as { exports: Record<string, unknown> }).exports
  sandbox.__exports = mod
  const out = new Map<string, CompiledFn>()
  for (const [name, val] of Object.entries(mod)) {
    if (typeof val !== 'function') continue
    const script = new vm.Script(`__exports[${JSON.stringify(name)}].apply(null, [__ctx].concat(__args))`, {
      filename: `${label}#${name}`,
    })
    out.set(name, {
      invoke(ctx: FnContext, args: FnValue[], timeoutMs: number): FnValue {
        sandbox.__ctx = ctx
        sandbox.__args = args
        try {
          return script.runInContext(context, { timeout: timeoutMs }) as FnValue
        } catch (err) {
          if (isTimeout(err)) throw new FunctionTimeoutError(`${label}#${name}: exceeded ${timeoutMs}ms`)
          throw new FunctionRuntimeError(`${label}#${name}: threw: ${message(err)}`)
        }
      },
    })
  }
  return out
}

function isTimeout(err: unknown): boolean {
  return err !== null && typeof err === 'object' &&
    (err as { code?: unknown }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
}
function message(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-engine/functions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/functions.ts tests/mock-engine/functions.test.ts
git commit -m "feat(templating): compile user _functions in a sandboxed vm with a timeout"
```

---

### Task 6: Scope discovery + nearest-wins resolution (`functions-load.ts`)

**Files:**
- Create: `src/lib/mock-engine/functions-load.ts`
- Test: `tests/mock-engine/functions-load.test.ts`

**Interfaces:**
- Consumes: `compileFunctions`, `CompiledFn` (Task 5); `RESERVED_NAMES` (Task 2); `node:fs`, `node:path`.
- Produces:
  ```ts
  export interface LoadedFunctions {
    problems: string[]
    resolveTable(systemSlug: string, endpointName: string): Map<string, CompiledFn>
  }
  export function loadFunctions(catalogDir: string): LoadedFunctions
  ```
  Discovers `_functions.ts` (loader `'ts'`) or `_functions.mjs` (loader `'js'`) at `catalogDir/`, `catalogDir/<system>/`, `catalogDir/<system>/<endpoint>/`. Compiles each once. `resolveTable` merges catalog → system → endpoint with **endpoint winning**. Any user export whose name is in `RESERVED_NAMES`, or a compile error, is pushed to `problems` (the offending function is skipped). If both `.ts` and `.mjs` exist at one level, prefer `.ts` and record a problem noting the ignored `.mjs`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mock-engine/functions-load.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFunctions } from '../../src/lib/mock-engine/functions-load'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fns-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const CTX = { request: { method: 'GET', path: '/', pathParams: {}, query: {}, headers: {}, body: {} }, now: new Date(0), seed: 's' }

describe('loadFunctions', () => {
  it('resolves catalog-level functions everywhere', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function hi() { return 'hi' }`)
    mkdirSync(join(dir, 'sys', 'ep'), { recursive: true })
    const loaded = loadFunctions(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.resolveTable('sys', 'ep').get('hi')!.invoke(CTX, [], 100)).toBe('hi')
  })

  it('endpoint shadows catalog (nearest wins)', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function label() { return 'catalog' }`)
    mkdirSync(join(dir, 'sys', 'ep'), { recursive: true })
    writeFileSync(join(dir, 'sys', 'ep', '_functions.ts'), `export function label() { return 'endpoint' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.resolveTable('sys', 'ep').get('label')!.invoke(CTX, [], 100)).toBe('endpoint')
  })

  it('reports a reserved-name clash and skips the function', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function upper() { return 'x' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.problems.join('\n')).toMatch(/reserved.*upper/i)
    expect(loaded.resolveTable('sys', 'ep').has('upper')).toBe(false)
  })

  it('is empty when no _functions files exist', () => {
    const loaded = loadFunctions(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.resolveTable('sys', 'ep').size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-engine/functions-load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mock-engine/functions-load.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compileFunctions, CompiledFn } from './functions'
import { RESERVED_NAMES } from './evaluate'

export interface LoadedFunctions {
  problems: string[]
  resolveTable(systemSlug: string, endpointName: string): Map<string, CompiledFn>
}

type Level = Map<string, CompiledFn>

export function loadFunctions(catalogDir: string): LoadedFunctions {
  const problems: string[] = []
  const compileAt = (dir: string, label: string): Level => {
    const ts = join(dir, '_functions.ts')
    const mjs = join(dir, '_functions.mjs')
    const hasTs = existsSync(ts)
    const hasMjs = existsSync(mjs)
    if (!hasTs && !hasMjs) return new Map()
    if (hasTs && hasMjs) problems.push(`${label}: both _functions.ts and _functions.mjs present; using .ts`)
    const file = hasTs ? ts : mjs
    const loader = hasTs ? 'ts' : 'js'
    let compiled: Map<string, CompiledFn>
    try {
      compiled = compileFunctions(readFileSync(file, 'utf8'), `${label}/_functions.${hasTs ? 'ts' : 'mjs'}`, loader)
    } catch (err) {
      problems.push(`${label}: ${(err as Error).message}`)
      return new Map()
    }
    for (const name of [...compiled.keys()]) {
      if (RESERVED_NAMES.has(name)) {
        problems.push(`${label}: function "${name}" uses a reserved built-in name and is ignored`)
        compiled.delete(name)
      }
    }
    return compiled
  }

  const catalogLevel = compileAt(catalogDir, '<catalog>')
  const systemLevels = new Map<string, Level>()
  const endpointLevels = new Map<string, Level>() // key `${system}/${endpoint}`

  for (const sys of dirsOf(catalogDir)) {
    systemLevels.set(sys, compileAt(join(catalogDir, sys), sys))
    for (const ep of dirsOf(join(catalogDir, sys))) {
      endpointLevels.set(`${sys}/${ep}`, compileAt(join(catalogDir, sys, ep), `${sys}/${ep}`))
    }
  }

  return {
    problems,
    resolveTable(systemSlug, endpointName) {
      const merged = new Map(catalogLevel)
      for (const [k, v] of systemLevels.get(systemSlug) ?? []) merged.set(k, v)
      for (const [k, v] of endpointLevels.get(`${systemSlug}/${endpointName}`) ?? []) merged.set(k, v)
      return merged
    },
  }
}

function dirsOf(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-engine/functions-load.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/functions-load.ts tests/mock-engine/functions-load.test.ts
git commit -m "feat(templating): discover and scope-resolve user _functions (nearest wins)"
```

---

### Task 7: Dispatch user functions from the evaluator

**Files:**
- Modify: `src/lib/mock-engine/evaluate.ts`
- Modify: `src/lib/mock-engine/template.ts`
- Test: `tests/mock-engine/evaluate.test.ts` (new)

**Interfaces:**
- Consumes: `CompiledFn` (Task 5), `FnContext` (Task 5).
- Produces: `EvalDeps` gains optional `fnCtx`, `functions`, `timeoutMs`. `resolveTemplate`/`resolvePlaceholderTyped` gain an optional final `options` param carrying them, default empty (so all existing call sites and tests keep working). Built-in transforms resolve first; then the user `functions` table; else `PlaceholderError`.

  ```ts
  export interface EvalDeps {
    ctx: RequestContext
    now: Date
    fnCtx?: FnContext
    functions?: Map<string, CompiledFn>
    timeoutMs?: number
  }
  // template.ts:
  export interface TemplateOptions { fnCtx?: FnContext; functions?: Map<string, CompiledFn>; timeoutMs?: number }
  export function resolveTemplate(node, ctx, now, resolutions?, options?: TemplateOptions): unknown
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/mock-engine/evaluate.test.ts
import { describe, expect, it } from 'vitest'
import { parseExpr } from '../../src/lib/mock-engine/expr'
import { evaluate } from '../../src/lib/mock-engine/evaluate'
import { compileFunctions } from '../../src/lib/mock-engine/functions'
import { PlaceholderError } from '../../src/lib/mock-engine/template'

const base = {
  ctx: { body: { name: 'bilal' }, pathParams: {}, query: new URLSearchParams(), headers: {} },
  now: new Date('2026-07-18T00:00:00.000Z'),
  fnCtx: { request: { method: 'GET', path: '/', pathParams: {}, query: {}, headers: {}, body: { name: 'bilal' } },
           now: new Date(0), seed: 's' },
  timeoutMs: 100,
}

describe('evaluate with user functions', () => {
  it('dispatches a user function with resolved args', () => {
    const functions = compileFunctions(`export function tag(ctx, who, n) { return who + '#' + n }`, 'f', 'js')
    const v = evaluate(parseExpr('tag:$.name:7'), { ...base, functions })
    expect(v).toBe('bilal#7')
  })

  it('lets a user function read context.request as the escape hatch', () => {
    const functions = compileFunctions(`export function m(ctx) { return ctx.request.method }`, 'f', 'js')
    expect(evaluate(parseExpr('m'), { ...base, functions })).toBe('GET')
  })

  it('prefers a built-in over a user function of the same name is impossible (reserved) — unknown name throws', () => {
    expect(() => evaluate(parseExpr('nope'), { ...base, functions: new Map() })).toThrow(PlaceholderError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-engine/evaluate.test.ts`
Expected: FAIL — `evaluate` ignores `functions`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/mock-engine/evaluate.ts — extend EvalDeps and the 'call' branch
import { CompiledFn, FnContext, FnValue, DEFAULT_FN_TIMEOUT_MS } from './functions'

export interface EvalDeps {
  ctx: RequestContext
  now: Date
  fnCtx?: FnContext
  functions?: Map<string, CompiledFn>
  timeoutMs?: number
}

// replace the 'call' case body:
    case 'call': {
      const args = expr.args.map((a) => evaluate(a, deps))
      const builtin = BUILTIN_TRANSFORMS[expr.name]
      if (builtin) return builtin(args[0] ?? null, args.slice(1))
      const fn = deps.functions?.get(expr.name)
      if (fn) {
        if (!deps.fnCtx) throw new PlaceholderError(`function "${expr.name}" needs request context`)
        return fn.invoke(deps.fnCtx, args as FnValue[], deps.timeoutMs ?? DEFAULT_FN_TIMEOUT_MS) as EvalValue
      }
      throw new PlaceholderError(`unknown function "${expr.name}" in placeholder`)
    }
```

Thread the options through `template.ts`:

```ts
// src/lib/mock-engine/template.ts
import { CompiledFn } from './functions'
import { FnContext } from './functions'

export interface TemplateOptions {
  fnCtx?: FnContext
  functions?: Map<string, CompiledFn>
  timeoutMs?: number
}

export function resolveTemplate(
  node: unknown, ctx: RequestContext, now: Date,
  resolutions?: Record<string, string>, options?: TemplateOptions,
): unknown {
  // ... recurse passing options through both array and object branches ...
}

function resolvePlaceholderTyped(expr: string, ctx: RequestContext, now: Date, options?: TemplateOptions): EvalValue {
  // parse as before, then:
  return evaluate(ast, { ctx, now, ...options })
}
```

(Every recursive `resolveTemplate(...)` and `resolvePlaceholder*` call must forward `options`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-engine`
Expected: PASS — new evaluate cases plus the whole suite.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/evaluate.ts src/lib/mock-engine/template.ts tests/mock-engine/evaluate.test.ts
git commit -m "feat(templating): dispatch user functions from placeholder evaluation"
```

---

### Task 8: Load-time integration + request-path wiring

**Files:**
- Modify: `src/lib/catalog/load.ts`
- Modify: `src/lib/router/route-request.ts`
- Test: `tests/catalog/load.test.ts` (extend if present; else add `tests/mock-engine/functions-integration.test.ts`)

**Interfaces:**
- Consumes: `loadFunctions` (Task 6), `TemplateOptions` (Task 7).
- Produces: the loaded catalog exposes a `resolveFunctions(systemSlug, endpointName)` accessor (backed by `loadFunctions(catalogDir).resolveTable`), and `loadFunctions().problems` are merged into the catalog's existing load-`problems`/validation output. `route-request.ts` builds `FnContext` and passes `{ fnCtx, functions }` into both `resolveTemplate` calls.

- [ ] **Step 1: Write the failing test**

```ts
// tests/mock-engine/functions-integration.test.ts
import { describe, expect, it } from 'vitest'
import { resolveTemplate } from '../../src/lib/mock-engine/template'
import { compileFunctions } from '../../src/lib/mock-engine/functions'

describe('resolveTemplate with a function table (request-path shape)', () => {
  it('renders a fixture body that calls a user function', () => {
    const functions = compileFunctions(`export function greet(ctx, who) { return 'hello ' + who }`, 'f', 'js')
    const ctx = { body: { name: 'bilal' }, pathParams: {}, query: new URLSearchParams(), headers: {} }
    const fnCtx = { request: { method: 'GET', path: '/', pathParams: {}, query: {}, headers: {}, body: { name: 'bilal' } }, now: new Date(0), seed: 's' }
    const out = resolveTemplate({ msg: '{{greet:$.name}}' }, ctx, new Date(0), undefined, { functions, fnCtx })
    expect(out).toEqual({ msg: 'hello bilal' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/mock-engine/functions-integration.test.ts`
Expected: PASS if Task 7 wired options correctly. Then extend to the real load/route wiring below and re-run the full suite.

- [ ] **Step 3: Write minimal implementation**

In `load.ts`: after the catalog tree is read, call `const fns = loadFunctions(catalogDir)`, push `fns.problems` into the same array the loader already returns for other problems (grep for how `_schema` problems are surfaced around `load.ts:70`), and attach `fns.resolveTable` to the returned catalog object as `resolveFunctions`. Add the field to the catalog type in `src/lib/catalog/types.ts`.

In `route-request.ts`, at the fixture render block (around `route-request.ts:240`):

```ts
    const fnCtx = {
      request: {
        method: req.method, path: req.path,
        pathParams: ctx.pathParams,
        query: Object.fromEntries([...ctx.query.keys()].map((k) => [k, ctx.query.getAll(k)])),
        headers: ctx.headers, body: ctx.body,
      },
      now,
      seed: `${profileId ?? 'none'}:${endpoint.name}`,
    }
    const functions = deps.catalog.resolveFunctions
      ? deps.catalog.resolveFunctions(system.slug, endpoint.name)
      : new Map()
    const opts = { fnCtx, functions }
    const body = resolveTemplate(fixture.body, ctx, now, placeholders, opts)
    // ...
    ...(resolveTemplate(fixture.headers ?? {}, ctx, now, placeholders, opts) as Record<string, string>),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run` (full suite)
Expected: PASS. Fix any type errors in `types.ts`/route deps.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/load.ts src/lib/catalog/types.ts src/lib/router/route-request.ts tests/mock-engine/functions-integration.test.ts
git commit -m "feat(templating): load user functions at catalog load and pass them through the request path"
```

---

### Task 9: Scope-aware placeholder validation

**Files:**
- Modify: `src/lib/catalog/validate.ts`
- Test: `tests/catalog/validate.test.ts`

**Interfaces:**
- Consumes: `parseExpr`, `callNames`, `ExprParseError` (Task 1); `RESERVED_NAMES` (Task 2); the endpoint's resolved function table (from Task 8's `resolveFunctions`, threaded into `validate`).
- Produces: for each fixture placeholder, replace the `parseNow`/`parseSelector` loop (`validate.ts` ~185–210) with: `parseExpr(expr)`; on `ExprParseError` → existing "invalid placeholder" error; for each name in `callNames`, error unless it is a `RESERVED_NAMES` built-in **or** present in the endpoint's function table; preserve the undeclared-path-param check by walking the AST for `selector` nodes with `source === 'path'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/catalog/validate.test.ts — add cases (match the file's existing harness for building a catalog dir)
  it('rejects a placeholder calling an unknown function', () => {
    // fixture body: { "x": "{{bogusFn:$.a}}" } in an endpoint with no _functions
    const errors = validateCatalogWith({ body: { x: '{{bogusFn:$.a}}' } })
    expect(errors.join('\n')).toMatch(/unknown function "bogusFn"/)
  })

  it('accepts a placeholder calling a function defined in that endpoint scope', () => {
    const errors = validateCatalogWith(
      { body: { x: '{{mine:$.a}}' } },
      { endpointFunctions: `export function mine(c, a) { return a }` },
    )
    expect(errors).toEqual([])
  })

  it('still flags an undeclared path param', () => {
    const errors = validateCatalogWith({ body: { x: '{{path:missing}}' } })
    expect(errors.join('\n')).toMatch(/undeclared path param/)
  })
```

(Implement `validateCatalogWith` as a thin helper in the test that writes a temp catalog with one system/endpoint/fixture and optional `_functions.ts`, then runs the catalog validator — follow the existing temp-dir pattern already used in `tests/catalog/validate.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/catalog/validate.test.ts`
Expected: FAIL — unknown-function names are not yet rejected.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/catalog/validate.ts — replace the placeholder loop (~185–210)
import { parseExpr, callNames, ExprParseError, Expr } from '../mock-engine/expr'
import { RESERVED_NAMES } from '../mock-engine/evaluate'

// `fnTable` = names visible for this endpoint (Set<string>), derived from the
// resolveFunctions table for (systemSlug, endpoint.name); pass it into this scope.
for (const expr of placeholders) {
  let ast: Expr
  try {
    ast = parseExpr(expr)
  } catch (err) {
    if (err instanceof ExprParseError) {
      errors.push(`${label}: fixture ${file} has invalid placeholder "{{${expr}}}"`)
      continue
    }
    throw err
  }
  for (const name of callNames(ast)) {
    if (!RESERVED_NAMES.has(name) && !fnTable.has(name)) {
      errors.push(`${label}: fixture ${file} placeholder "{{${expr}}}" calls unknown function "${name}"`)
    }
  }
  for (const sel of selectorNodes(ast)) {
    if (sel.selector.source === 'path' && !declaredParams.has(sel.selector.name)) {
      errors.push(`${label}: fixture ${file} placeholder "{{${expr}}}" references undeclared path param`)
    }
  }
}

// helper in validate.ts:
function selectorNodes(expr: Expr): Array<Extract<Expr, { kind: 'selector' }>> {
  const out: Array<Extract<Expr, { kind: 'selector' }>> = []
  const walk = (e: Expr): void => {
    if (e.kind === 'selector') out.push(e)
    else if (e.kind === 'call') e.args.forEach(walk)
  }
  walk(expr)
  return out
}
```

Thread the per-endpoint `fnTable` (a `Set` of `resolveFunctions(system.slug, endpoint.name).keys()`) into the loop from wherever `validate` receives the loaded catalog. Remove the now-unused `parseNow`/`parseSelector` imports if nothing else uses them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/catalog/validate.test.ts tests/mock-engine`
Expected: PASS — new cases plus the whole suite.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/validate.ts tests/catalog/validate.test.ts
git commit -m "feat(templating): scope-aware validation of placeholder function calls"
```

---

### Task 10: `MockFn` type export + worked example + end-to-end proof

**Files:**
- Modify: package entry that re-exports public types (grep for an existing `index.ts`/`src/lib/index.ts`; if none, export from `src/lib/mock-engine/functions.ts` and document the import path).
- Create: `catalog/hello-system/_functions.ts`
- Modify: one fixture under `catalog/hello-system/…` to call the example function.
- Test: `tests/router/route-request.test.ts` (extend if present; else add a focused integration test that boots the router against the example catalog).

**Interfaces:**
- Consumes: `MockFn`, `FnContext` (Task 5).
- Produces: `MockFn`/`FnContext` importable by catalog authors; a real `_functions.ts` in the shipped example catalog; an end-to-end test proving a request renders a function-computed value.

- [ ] **Step 1: Write the failing test**

```ts
// tests/router/route-request.test.ts — add (match the file's existing router-boot harness)
  it('renders a fixture value computed by a user function', async () => {
    // Uses catalog/hello-system with the new _functions.ts + fixture placeholder.
    const res = await callEndpoint('GET', '/hello-system/customer_status', { /* headers/profile as the harness requires */ })
    const json = await res.json()
    expect(json.label).toBe('CUSTOMER: <expected>') // assert against the example function's output
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/router/route-request.test.ts`
Expected: FAIL — `_functions.ts`/fixture placeholder not present yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// catalog/hello-system/_functions.ts
import type { MockFn } from '../../src/lib/mock-engine/functions' // authors installing the pkg use the published path

// Prefer explicit params (the taught default); context is the escape hatch.
export const label: MockFn = (_ctx, status) => `CUSTOMER: ${String(status).toUpperCase()}`
```

Add a placeholder to the chosen fixture, e.g. `"label": "{{label:$.status}}"` (pick a fixture/field that matches the endpoint's body selectors). Export `MockFn`/`FnContext` from the package entry so the published import path resolves.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/router/route-request.test.ts && npx vitest run`
Expected: PASS — the whole suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib catalog/hello-system tests/router/route-request.test.ts
git commit -m "feat(templating): export MockFn type and ship a worked _functions example"
```

---

### Task 11: Full verification + type/lint gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint + full tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: all green. Fix any type errors surfaced by the new `TemplateOptions`/`resolveFunctions` fields.

- [ ] **Step 2: Lockfile sanity (per AGENTS.md — no deps changed, but verify)**

Run: `npx -y npm@11 ci --dry-run`
Expected: exit 0.

- [ ] **Step 3: Manual smoke via the running server (per `/verify` discipline)**

Boot the dev server (Browser pane `preview_start`), hit an endpoint whose fixture uses `{{label:$.status}}`, and confirm the rendered value matches the function output. Capture proof.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test(templating): verify function-calling end to end"
```

---

## Docs impact (per AGENTS.md — ask before editing)

This feature changes the placeholder/templating surface. Per AGENTS.md, after implementation, **ask the user** before touching the guide. Affected pages: `docs/site/docs/building/fixtures.md` (placeholders/templating — primary), `docs/site/docs/reference/configuration.md` (validation rules), `docs/site/docs/reference/request-lifecycle.md`. Do not edit them as part of these tasks.

## Self-review notes

- **Spec coverage:** unified AST (Task 1), colon+pipe syntax (Tasks 1,3), `(context,…args)` with `context.request` escape hatch (Tasks 5,7), esbuild+vm+timeout execution mirroring the resolver (Task 5), 3-scope nearest-wins + reserved built-ins (Task 6), scope-aware validation (Task 9), type-preserving returns/#12 (Task 4), hard-error on unknown/throw/timeout (Tasks 5,7,9), `MockFn` type + example (Task 10). Determinism `seed` is threaded (Task 8); the seeded `random`/`faker` built-ins themselves are deferred to #14/#15 as designed.
- **Deferred (matches spec Out-of-scope):** full #13 filter set beyond `upper`, #14 `random`, #15 `faker`, #10 `uuid`, paren-nesting, `Math.random` seed-shim.
- **Type consistency:** `Expr`, `EvalValue`/`FnValue`, `FnContext`, `CompiledFn`, `TemplateOptions`, `resolveFunctions` names are used identically across tasks.
