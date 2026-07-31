# Faker + `pick` placeholders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two fixture-placeholder generators — `{{faker:module.method}}` (realistic fake data from a mandatory `@faker-js/faker`) and `{{pick:a:b:c}}` (choose among the author's inline values) — both **seeded deterministically per (profile, endpoint, position)** so mocked responses are reproducible for a given caller.

**Architecture:** `faker` and `pick` register as built-ins in the existing `BUILTIN_TRANSFORMS` registry (`evaluate.ts`), the same mechanism `uuid` uses (#10, #36). A single seeded `@faker-js/faker` instance is built once per request in `route-request.ts` and threaded `RouterDeps → TemplateOptions → EvalDeps`, exactly like the `uuid` generator and the `#36` group map. Determinism uses **Model B (path-based)**: `resolveTemplate` computes each placeholder's JSON path as it walks, derives a stable 32-bit seed from `hash(seedMaterial | path)`, and re-seeds the faker instance immediately before each `faker`/`pick` draw — so a value depends only on *who* (profile), *which* endpoint, and *where* it sits, and is immune to placeholders added or reordered elsewhere. `pick` is implemented internally over `faker.helpers.arrayElement` on that same instance (one RNG), but is surfaced as its own built-in because its inputs are author-supplied, not Faker datasets.

**Tech Stack:** TypeScript, Next.js runtime, `@faker-js/faker` (new production dependency, eager + pinned), Vitest.

## Global Constraints

- **Supersedes #14.** No standalone `random` engine. The only surviving capability — choosing among caller-supplied values — ships here as `pick`.
- **Faker is a mandatory, eager dependency.** No lazy/optional import. `import { Faker, en } from '@faker-js/faker'` (construct our own `new Faker({ locale: [en] })` instance so we control seeding), or `import { faker } from '@faker-js/faker'` for the shared default — the plan uses an explicitly constructed instance per request (Task 3).
- **npm 11 lockfile discipline (AGENTS.md).** Local npm is 11.x. After adding the dependency, `package-lock.json` must be written by npm 11 and `npx -y npm@11 ci --dry-run` must exit 0. Never regenerate the lock with any other npm major. Pin an exact version (no `^`).
- **Expose only Faker's data-generating modules, never `helpers`/utilities.** Enforced by an allowlist (Task 6). `{{faker:helpers.arrayElement:…}}` is a catalog error — `pick` is the surface for that.
- **Seeded/reproducible contract:** same `(profileId, endpoint)` + same fixture position ⇒ same value across requests; different callers/positions differ. `uuid` stays *unseeded* (unique per request) by design — do not change it. Documented as a deliberate split (Task 7).
- **Stability contract:** values are stable within a release; across upgrades (Faker's RNG or our hash may move) authors assert *shape*, not exact value — same contract `{{uuid}}` sets. The Faker version is pinned to make within-release values reproducible.
- **The grammar already parses.** `{{faker:number.int:1:100}}` → call node `name:'faker', args:[lit 'number.int', lit 1, lit 100]`; `{{pick:red:green:blue}}` → `name:'pick', args:[lit 'red', lit 'green', lit 'blue']`. `parseArg` already types numeric tokens. No `expr.ts` change.
- **Tests:** Vitest. Single file: `npx vitest run <path>`. Tests live under `tests/` mirroring `src/lib/` (see AGENTS.md — not colocated).
- **Commits:** Conventional Commits, `feat(templating): …` / `refactor(templating): …` / `test(templating): …`, each ending with the `Co-Authored-By` trailer from AGENTS.md and a `Refs #15` footer (non-closing — never `Closes`/`Fixes`).
- **Docs ship with the feature (AGENTS.md):** Task 7 updates `docs/site/docs/building/fixtures.md`; the strict docs build must pass.

## File Structure

- `package.json` / `package-lock.json` (modify) — add pinned `@faker-js/faker`.
- `src/lib/mock-engine/evaluate.ts` (modify) — extend `ArityRange` to allow an unbounded max; register `faker` and `pick` in `BUILTIN_TRANSFORMS`; add `faker`/`fakerSeed` to `EvalDeps`; export helpers `builtinRequiresLiteralArgs` (exists), `exposedFakerMethod`, `fakerArgSpec`.
- `src/lib/mock-engine/faker-methods.ts` (new) — the exposed-module **allowlist**, the parameterized **arg-spec table** (`module.method` → marshaller + validator), and a `resolveFakerMethod(faker, path)` helper. Pure data + small functions; no I/O. Keeps the method catalog out of `evaluate.ts`.
- `src/lib/mock-engine/template.ts` (modify) — thread a JSON `path` through `resolveTemplate`'s walk; compute the per-placeholder `fakerSeed` via a stable `fnv1a32` hash; pass `faker`/`fakerSeed` into `evaluate`. Add `faker`/`seedMaterial` to `TemplateOptions`.
- `src/lib/router/route-request.ts` (modify) — construct the per-request seeded `Faker` instance; pass it plus `seedMaterial` (the existing `${profileId ?? 'none'}:${endpoint.name}`) into the two `resolveTemplate` calls.
- `src/lib/catalog/validate.ts` (modify) — reflective `module.method` allowlist check; parameterized arg-shape validation; `pick` arity + literal-args.
- `docs/site/docs/building/fixtures.md` (modify) — Faker section, `pick`, seeding/determinism, built-in table rows.
- Tests mirror each source file under `tests/`.

---

### Task 1: Add the `@faker-js/faker` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Add the pinned dependency**

Run (local npm must be 11.x — verify with `npm --version`):
```bash
npm install --save-exact @faker-js/faker@9.9.0
```
(Use `9.9.0` unless a newer 9.x is current; the exact pin is what matters. `--save-exact` writes `"@faker-js/faker": "9.9.0"` with no caret.)

- [ ] **Step 2: Verify the lockfile is npm-11-clean**

Run: `npx -y npm@11 ci --dry-run`
Expected: exits 0, no `Missing: … from lock file`.

- [ ] **Step 3: Verify it imports and constructs**

Run:
```bash
node --input-type=module -e "import { Faker, en } from '@faker-js/faker'; const f = new Faker({ locale: [en] }); f.seed(1); console.log(f.person.firstName())"
```
Expected: prints a name, no error.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(templating): add @faker-js/faker as a pinned dependency

Refs #15
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extend `ArityRange` to allow an unbounded max

`#36` made `Builtin.arity` an inclusive `{ min, max }` range of numbers. `faker` and `pick` are variadic (no fixed upper bound), so `max` must be able to mean "unbounded". Represent that as `max: number | null` where `null` = unbounded.

**Files:**
- Modify: `src/lib/mock-engine/evaluate.ts`
- Test: `tests/mock-engine/evaluate.test.ts`, `tests/catalog/validate.test.ts` (existing arity tests must still pass)

**Interfaces:**
- Produces: `interface ArityRange { readonly min: number; readonly max: number | null }`; `describeArity(a: ArityRange): string` (now renders unbounded as `${min}+`); `const atLeast = (n: number): ArityRange => ({ min: n, max: null })`.

- [ ] **Step 1: Write the failing test** (`tests/mock-engine/evaluate.test.ts`)

```ts
import { describeArity } from '../../src/lib/mock-engine/evaluate'
// ...
it('renders an unbounded arity range as "N+"', () => {
  expect(describeArity({ min: 1, max: null })).toBe('1+')
  expect(describeArity({ min: 0, max: 1 })).toBe('0-1')
  expect(describeArity({ min: 2, max: 2 })).toBe('2')
})
```
(If `describeArity` is not yet exported, this also drives exporting it — it already is, per #36.)

- [ ] **Step 2: Run it — expect FAIL** (`describeArity` returns `1-null` or throws)

Run: `npx vitest run tests/mock-engine/evaluate.test.ts -t "unbounded arity"`

- [ ] **Step 3: Implement**

In `evaluate.ts`:
```ts
export interface ArityRange {
  readonly min: number
  readonly max: number | null // null = unbounded
}

const exact = (n: number): ArityRange => ({ min: n, max: n })
const atLeast = (n: number): ArityRange => ({ min: n, max: null })

export function describeArity(a: ArityRange): string {
  if (a.max === null) return `${a.min}+`
  return a.min === a.max ? `${a.min}` : `${a.min}-${a.max}`
}
```
Update the runtime backstop in `evalNode`:
```ts
if (args.length < builtin.arity.min || (builtin.arity.max !== null && args.length > builtin.arity.max)) {
  throw new PlaceholderError(
    `built-in "${expr.name}" takes ${describeArity(builtin.arity)} argument(s), got ${args.length}`,
  )
}
```

- [ ] **Step 4: Update the load-time check in `validate.ts`** to match:
```ts
const arity = builtinArity(call.name)
if (arity && (call.args.length < arity.min || (arity.max !== null && call.args.length > arity.max))) {
  errors.push(
    `${label}: fixture ${file} placeholder "{{${expr}}}" calls built-in "${call.name}" ` +
      `with ${call.args.length} argument(s), expected ${describeArity(arity)}`,
  )
}
```

- [ ] **Step 5: Run the full evaluate + validate suites — expect PASS** (existing `exact()` built-ins unaffected)

Run: `npx vitest run tests/mock-engine/evaluate.test.ts tests/catalog/validate.test.ts`

- [ ] **Step 6: Commit** (`refactor(templating): allow an unbounded max in Builtin arity ranges`, with `Refs #15` + trailer)

---

### Task 3: Per-request seeded Faker instance + path-based seeding

The heart of the feature. Build one seeded `Faker` per request; thread it plus a per-placeholder numeric seed into `evaluate`.

**Files:**
- Modify: `src/lib/mock-engine/evaluate.ts` (`EvalDeps`), `src/lib/mock-engine/template.ts` (path walk + hash + threading), `src/lib/router/route-request.ts` (build instance)
- Test: `tests/mock-engine/template.test.ts`

**Interfaces:**
- Produces on `EvalDeps` and `TemplateOptions`:
  - `faker?: Faker` — the shared seeded instance.
  - On `TemplateOptions` only: `seedMaterial?: string` — `${profileId ?? 'none'}:${endpoint.name}`.
  - On `EvalDeps` only: `fakerSeed?: number` — the 32-bit seed for the *current* placeholder, computed by `resolveTemplate` from `hash(seedMaterial | path)`. `faker`/`pick` call `deps.faker.seed(deps.fakerSeed)` before drawing.
- Produces (template.ts, exported for tests): `fnv1a32(s: string): number`.

**Path format:** `resolveTemplate` starts each top-level call at a prefix (`options.pathPrefix ?? 'body'`); object keys append `.key`, array indices append `[i]`. Each placeholder within a string node also appends `#<occurrenceIndexInThatString>` (0 for a whole-string placeholder). Example seed strings: `none:createBooking|body.legs[0].bookingId#0`, `p-7:getUser|headers.x-token#0`.

- [ ] **Step 1: Write the failing test** — reproducibility + path-stability

```ts
// tests/mock-engine/template.test.ts
import { Faker, en } from '@faker-js/faker'
// helper: fresh seeded instance per render, same seedMaterial => same values
const render = (node: unknown, seedMaterial: string, prefix = 'body') =>
  resolveTemplate(node, ctx(), now, undefined, {
    faker: new Faker({ locale: [en] }),
    seedMaterial,
    pathPrefix: prefix,
  })

it('is reproducible for the same (seedMaterial, path) and varies across callers (#15)', () => {
  const a1 = render({ name: '{{faker:person.fullName}}' }, 'p-1:getUser')
  const a2 = render({ name: '{{faker:person.fullName}}' }, 'p-1:getUser')
  const b  = render({ name: '{{faker:person.fullName}}' }, 'p-2:getUser')
  expect(a1).toEqual(a2)                 // same caller+endpoint+path => identical
  expect(a1).not.toEqual(b)              // different caller => different
})

it('keeps a value stable when an unrelated placeholder is added elsewhere (Model B)', () => {
  const before = render({ id: '{{faker:string.uuid}}' }, 's:e') as { id: string }
  const after  = render({ added: '{{faker:person.firstName}}', id: '{{faker:string.uuid}}' }, 's:e') as { id: string }
  expect(after.id).toBe(before.id)       // id depends on its path, not draw order
})
```

- [ ] **Step 2: Run — expect FAIL** (`faker` unknown built-in / no seeding)

- [ ] **Step 3: Implement the hash + path walk in `template.ts`**

Add:
```ts
// FNV-1a 32-bit. Stable across releases (documented); used only to derive a
// deterministic Faker seed from (seedMaterial | placeholder path).
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
```
Thread a `path` argument through the recursive walk (introduce an inner `walk(node, path)` seeded from `options?.pathPrefix ?? 'body'`), append `.key` / `[i]` on descent, and when resolving a string node pass `path` + the per-match occurrence index to `resolvePlaceholder`/`resolvePlaceholderTyped`. In those, compute and inject the seed:
```ts
const fakerSeed =
  options?.seedMaterial !== undefined ? fnv1a32(`${options.seedMaterial}|${path}`) : undefined
return evaluate(ast, { ctx, now, ...options, fakerSeed })
```
Add `faker?: Faker`, `seedMaterial?: string`, `pathPrefix?: string` to `TemplateOptions`. Add `faker?: Faker` and `fakerSeed?: number` to `EvalDeps` (evaluate.ts) with doc comments mirroring `uuid`/`uuidGroups`.

- [ ] **Step 4: Wire `route-request.ts`**

```ts
import { Faker, en } from '@faker-js/faker'
// ... inside routeRequest, alongside `now`/`uuidGroups`:
const faker = new Faker({ locale: [en] })
const seedMaterial = fnCtx.seed // already `${profileId ?? 'none'}:${endpoint.name}`
const opts = { fnCtx, functions, uuid: deps.uuid, uuidGroups, faker, seedMaterial }
const body = resolveTemplate(fixture.body, ctx, now, placeholders, opts)
// header render adds stringOnly + pathPrefix:'headers':
resolveTemplate(fixture.headers ?? {}, ctx, now, placeholders, { ...opts, stringOnly: true, pathPrefix: 'headers' })
```
(Task 4 registers the `faker` built-in that these tests exercise — implement Task 3 and Task 4 together if the test needs the built-in to pass; commit them separately.)

- [ ] **Step 5: Run — expect PASS.** Run `npx vitest run tests/mock-engine/template.test.ts`.

- [ ] **Step 6: Commit** (`feat(templating): seeded per-request faker instance with path-based placeholder seeding`)

---

### Task 4: The `faker` built-in (dispatch + arg marshalling)

**Files:**
- Create: `src/lib/mock-engine/faker-methods.ts`
- Modify: `src/lib/mock-engine/evaluate.ts`
- Test: `tests/mock-engine/faker-methods.test.ts`, `tests/mock-engine/evaluate.test.ts`

**Interfaces:**
- `faker-methods.ts` produces:
  - `EXPOSED_FAKER_MODULES: ReadonlySet<string>` — allowlisted data modules: `person, internet, location, commerce, company, lorem, number, date, string, color, animal, music, science, vehicle, word, phone, finance, database, git, food, book, airline, hacker`. (Explicitly excludes `helpers`, `image`, and internals.)
  - `interface FakerArgSpec { params: number; call: (fn: Faker, module: string, method: string, args: (string|number|boolean)[]) => unknown; validate: (args: Expr[]) => string | null }`
  - `FAKER_ARG_SPECS: Record<string, FakerArgSpec>` keyed by `module.method`:
    - `number.int` / `number.float`: `params: 2`, `call: (fn,m,me,[min,max]) => fn.number[me]({ min: Number(min), max: Number(max) })`, `validate`: both numeric literals and `min <= max`.
    - `string.alphanumeric` / `string.alpha` / `string.numeric`: `params: 1`, `call: (fn,m,me,[len]) => fn.string[me](Number(len))`, `validate`: one non-negative integer literal.
    - `lorem.words` / `lorem.sentences`: `params: 1`, `call: (fn,m,me,[n]) => fn.lorem[me](Number(n))`, `validate`: one positive integer literal.
  - `resolveFakerMethod(fn: Faker, path: string): ((args) => unknown) | null` — splits `module.method`, checks the allowlist + that it is a function, returns a caller (zero-arg → `fn[module][method]()`; parameterized → the spec's `call`).
- `evaluate.ts` `faker` built-in: `arity: atLeast(1)` (arg[0] = `module.method`, rest = params), `literalArgsOnly: true`, `apply`:
  ```ts
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
      return method(params) as EvalValue
    },
  },
  ```

- [ ] **Step 1: Write failing tests** for `faker-methods.ts`:

```ts
// tests/mock-engine/faker-methods.test.ts
import { Faker, en } from '@faker-js/faker'
import { resolveFakerMethod, EXPOSED_FAKER_MODULES } from '../../src/lib/mock-engine/faker-methods'
const fn = () => new Faker({ locale: [en] })

it('resolves a zero-arg data method', () => {
  const f = fn(); f.seed(1)
  const m = resolveFakerMethod(f, 'person.firstName')!
  expect(typeof m([])).toBe('string')
})
it('maps number.int positional args onto the options object', () => {
  const f = fn(); f.seed(1)
  const v = resolveFakerMethod(f, 'number.int')!([1, 100]) as number
  expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(100)
})
it('rejects a helpers/utility method (not a data module)', () => {
  expect(resolveFakerMethod(fn(), 'helpers.arrayElement')).toBeNull()
})
it('rejects an unknown method', () => {
  expect(resolveFakerMethod(fn(), 'person.noSuchThing')).toBeNull()
})
```
Plus an `evaluate.test.ts` test that `{{faker:number.int:1:100}}` returns a number in range given a seeded instance in `deps`.

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `faker-methods.ts` and register the built-in** (code above).
- [ ] **Step 4: Run — expect PASS.** `npx vitest run tests/mock-engine/faker-methods.test.ts tests/mock-engine/evaluate.test.ts`
- [ ] **Step 5: Commit** (`feat(templating): {{faker:module.method}} with a seeded instance and curated parameterized args`)

---

### Task 5: The `pick` built-in

**Files:**
- Modify: `src/lib/mock-engine/evaluate.ts`
- Test: `tests/mock-engine/evaluate.test.ts`, `tests/mock-engine/template.test.ts`

**Interfaces:**
- `pick` built-in: `arity: atLeast(1)`, `literalArgsOnly: true`, `apply`:
  ```ts
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
  ```
  Type-preserving: `{{pick:1:2:3}}` returns a number (parseArg typed the args).

- [ ] **Step 1: Write failing tests** — seeded pick is reproducible; distinct paths can differ; preserves numeric type:
```ts
it('picks a stable element for a given seed and preserves type (#15)', () => {
  const f = () => new Faker({ locale: [en] })
  const r1 = resolveTemplate('{{pick:1:2:3}}', ctx(), now, undefined, { faker: f(), seedMaterial: 's:e' })
  const r2 = resolveTemplate('{{pick:1:2:3}}', ctx(), now, undefined, { faker: f(), seedMaterial: 's:e' })
  expect(r1).toBe(r2)
  expect(typeof r1).toBe('number')
  expect([1, 2, 3]).toContain(r1)
})
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** (code above).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(templating): {{pick:a:b:c}} — choose among author-supplied values, seeded`)

---

### Task 6: Catalog-load validation

**Files:**
- Modify: `src/lib/catalog/validate.ts`
- Test: `tests/catalog/validate.test.ts`

**Interfaces:**
- Consumes from `faker-methods.ts`: `EXPOSED_FAKER_MODULES`, `FAKER_ARG_SPECS`, and a validation-time `Faker` instance (import `new Faker({ locale: [en] })` once at module scope in validate.ts, or a shared `isExposedFakerMethod(path): boolean`). Prefer a pure `validateFakerCall(name, args): string | null` helper exported from `faker-methods.ts` so validate.ts stays thin.

- [ ] **Step 1: Write failing tests** in `validate.test.ts`:
```ts
it('accepts an exposed zero-arg faker method and a parameterized one', () => {
  expect(validateCatalogWith({ body: { a: '{{faker:person.fullName}}', b: '{{faker:number.int:1:100}}' } })).toEqual([])
})
it('rejects a helpers/utility faker method', () => {
  expect(validateCatalogWith({ body: { a: '{{faker:helpers.arrayElement:x:y}}' } }).join('\n')).toMatch(/faker method .* is not exposed/)
})
it('rejects an unknown faker method', () => {
  expect(validateCatalogWith({ body: { a: '{{faker:person.nope}}' } }).join('\n')).toMatch(/unknown faker method/)
})
it('rejects args to a zero-arg faker method', () => {
  expect(validateCatalogWith({ body: { a: '{{faker:person.fullName:3}}' } }).join('\n')).toMatch(/takes no arguments/)
})
it('rejects number.int with a bad range', () => {
  expect(validateCatalogWith({ body: { a: '{{faker:number.int:100:1}}' } }).join('\n')).toMatch(/min .* max/)
})
it('rejects a non-literal faker method name or param', () => {
  expect(validateCatalogWith({ body: { a: '{{uuid | faker:person.fullName}}' } }).join('\n')).toMatch(/non-literal argument/)
})
it('accepts pick with >=1 literal and rejects a piped/selector arg', () => {
  expect(validateCatalogWith({ body: { a: '{{pick:red:green:blue}}' } })).toEqual([])
  expect(validateCatalogWith({ body: { a: '{{$.x | pick:red}}' } }).join('\n')).toMatch(/non-literal argument/)
})
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** In the per-call validation loop of `validate.ts` (where `builtinRequiresLiteralArgs` and the arity check already run), add: when `call.name === 'faker'`, call `validateFakerCall(call.args)` and push its message; `pick` needs no extra beyond arity + literal-args (already handled by `atLeast(1)` + `literalArgsOnly`). `validateFakerCall` checks: args[0] is a literal string; `module.method` is in the allowlist and exists on a faker instance; if a `FAKER_ARG_SPECS[path]` exists, the param count/types/`min<=max` match; else no params allowed.
- [ ] **Step 4: Run — expect PASS.** `npx vitest run tests/catalog/validate.test.ts`
- [ ] **Step 5: Commit** (`feat(templating): validate faker methods and pick at catalog load`)

---

### Task 7: Documentation

**Files:**
- Modify: `docs/site/docs/building/fixtures.md`
- Verify: strict docs build

- [ ] **Step 1:** Add a **Faker data** subsection under the placeholder docs: what `{{faker:module.method}}` is, the exposed-modules note (data only, not helpers), the parameterized-method table (from #15's decision), and a runnable example fixture.
- [ ] **Step 2:** Add a **`pick`** subsection: `{{pick:a:b:c}}`, author-supplied values, type preservation, literal-args-only.
- [ ] **Step 3:** Add a **Determinism & seeding** note: seeded per `(profile, endpoint, position)`, reproducible per caller, stable under unrelated edits; contrast with `{{uuid}}` (unseeded, unique per request); the within-release stability contract.
- [ ] **Step 4:** Add table rows to the placeholder table (line ~80) and the built-in transforms table (line ~236): `faker`, `pick`.
- [ ] **Step 5:** Build docs — `cd docs/site && uvx zensical==0.0.50 build -f zensical.toml --clean --strict` → `No issues found`.
- [ ] **Step 6: Commit** (`docs(templating): document faker and pick placeholders`)

---

### Task 8: End-to-end tests + full verification

**Files:**
- Modify: `tests/router/route-request.test.ts`
- Verify: full gate

- [ ] **Step 1:** Add a router e2e (mirroring the `uuid end-to-end (#10)` block): a global endpoint whose fixture uses `{{faker:person.fullName}}`, `{{faker:number.int:1:100}}`, `{{pick:a:b:c}}` in body + a header; assert two requests to the same fixture return **identical** values (seeded reproducibility across requests), and that a bounded int lands in range.
- [ ] **Step 2:** Run the full gate:
```bash
npm test
npm run lint
npm run build
npm run check:prerender
npm run validate:catalog
```
All must pass.
- [ ] **Step 3: Commit** (`test(templating): e2e for seeded faker and pick placeholders`)

---

## Self-Review

- **Spec coverage:** dependency (T1), arity extension for variadic (T2), seeding infra + Model B path-stability (T3), faker dispatch + curated params (T4), pick (T5), validation incl. allowlist/args/pick (T6), docs incl. determinism + uuid contrast (T7), e2e + gate (T8). All #15 checklist items map to a task.
- **Type consistency:** `ArityRange.max: number | null`, `atLeast`, `describeArity`, `resolveFakerMethod`, `FAKER_ARG_SPECS`, `validateFakerCall`, `EvalDeps.faker`/`fakerSeed`, `TemplateOptions.faker`/`seedMaterial`/`pathPrefix`, `fnv1a32` used consistently across tasks.
- **Determinism note:** re-seeding the shared instance before every `faker`/`pick` draw is what makes path-based seeding order-independent; both built-ins do it identically.
