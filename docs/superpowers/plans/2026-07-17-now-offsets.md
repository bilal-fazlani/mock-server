# `now` Relative-Time Offsets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support relative time offsets on the `now` placeholder (`{{now+3d:iso}}`, `{{now-15m:iso}}`) that stay statically validatable and deterministic.

**Architecture:** A new `now.ts` module owns all `now` parsing/rendering. `parseNow` splits a now-expression into `{ offsetMs, format }` (or returns `null` for non-now expressions, or throws for malformed ones). `renderNow` applies the offset to the injected `now: Date` and renders the format in UTC. `template.ts` (resolution) and `validate.ts` (static validation) both call `parseNow`, keeping resolver and validator in lockstep. Offset parsing is decoupled from the format whitelist so issue #8 can add formats without touching offset code.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- Scope is **offset grammar only**. Do not add `epoch`, `epochMillis`, `date`, or `time` formats — those belong to issue #8. `NOW_FORMATS` stays `['iso', 'YYYYMMDD']`.
- Rendering is **UTC** (via `toISOString()`), matching the existing formatters. No local-time or timezone logic.
- `now` is injected into resolution — never call `new Date()` / `Date.now()` in resolution or rendering code; use the passed `now: Date`.
- Existing behavior must not regress: `now:iso` and `now:YYYYMMDD` (no offset) keep working exactly as today.
- Follow existing code style: 2-space indent, no semicolons, single quotes (see `template.ts`).

---

### Task 1: `now.ts` module — parse + render

**Files:**
- Create: `src/lib/mock-engine/now.ts`
- Test: `tests/mock-engine/now.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `class NowFormatError extends Error {}`
  - `const NOW_FORMATS = ['iso', 'YYYYMMDD'] as const`
  - `type NowFormat = (typeof NOW_FORMATS)[number]`
  - `interface NowSpec { offsetMs: number; format: NowFormat }`
  - `function parseNow(expr: string): NowSpec | null` — `null` when `expr` is not a now-expression; a `NowSpec` when valid; throws `NowFormatError` when now-shaped but malformed.
  - `function renderNow(spec: NowSpec, now: Date): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/mock-engine/now.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NowFormatError, parseNow, renderNow } from '../../src/lib/mock-engine/now'

const now = new Date('2026-07-02T10:20:30.000Z')

describe('parseNow', () => {
  it('returns null for non-now expressions', () => {
    expect(parseNow('$.customerId')).toBeNull()
    expect(parseNow('path:bookingId')).toBeNull()
    expect(parseNow('nowhere:iso')).toBeNull()
  })

  it('parses a bare format with zero offset', () => {
    expect(parseNow('now:iso')).toEqual({ offsetMs: 0, format: 'iso' })
    expect(parseNow('now:YYYYMMDD')).toEqual({ offsetMs: 0, format: 'YYYYMMDD' })
  })

  it('parses positive and negative offsets for every unit', () => {
    expect(parseNow('now+30s:iso')).toEqual({ offsetMs: 30_000, format: 'iso' })
    expect(parseNow('now-15m:iso')).toEqual({ offsetMs: -15 * 60_000, format: 'iso' })
    expect(parseNow('now+1h:iso')).toEqual({ offsetMs: 3_600_000, format: 'iso' })
    expect(parseNow('now+3d:iso')).toEqual({ offsetMs: 3 * 86_400_000, format: 'iso' })
    expect(parseNow('now+0d:iso')).toEqual({ offsetMs: 0, format: 'iso' })
  })

  it('throws NowFormatError on malformed now-expressions', () => {
    expect(() => parseNow('now:nope')).toThrow(NowFormatError)
    expect(() => parseNow('now:')).toThrow(NowFormatError)
    expect(() => parseNow('now+3x:iso')).toThrow(NowFormatError)
    expect(() => parseNow('now+:iso')).toThrow(NowFormatError)
    expect(() => parseNow('now+1d')).toThrow(NowFormatError)
  })
})

describe('renderNow', () => {
  it('renders iso with the offset applied', () => {
    expect(renderNow({ offsetMs: 0, format: 'iso' }, now)).toBe('2026-07-02T10:20:30.000Z')
    expect(renderNow({ offsetMs: 3 * 86_400_000, format: 'iso' }, now)).toBe(
      '2026-07-05T10:20:30.000Z',
    )
    expect(renderNow({ offsetMs: -15 * 60_000, format: 'iso' }, now)).toBe(
      '2026-07-02T10:05:30.000Z',
    )
  })

  it('renders YYYYMMDD in UTC and rolls across day boundaries', () => {
    expect(renderNow({ offsetMs: 0, format: 'YYYYMMDD' }, now)).toBe('20260702')
    expect(renderNow({ offsetMs: 86_400_000, format: 'YYYYMMDD' }, now)).toBe('20260703')
    // 2026-07-02T10:20 + 14h crosses into 2026-07-03 UTC
    expect(renderNow({ offsetMs: 14 * 3_600_000, format: 'YYYYMMDD' }, now)).toBe('20260703')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mock-engine/now.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/mock-engine/now`.

- [ ] **Step 3: Write the module**

Create `src/lib/mock-engine/now.ts`:

```ts
export class NowFormatError extends Error {}

export const NOW_FORMATS = ['iso', 'YYYYMMDD'] as const
export type NowFormat = (typeof NOW_FORMATS)[number]

export interface NowSpec {
  offsetMs: number
  format: NowFormat
}

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

const NOW_RE = /^now(?:([+-])(\d+)([smhd]))?:(.+)$/

function isNowFormat(value: string): value is NowFormat {
  return (NOW_FORMATS as readonly string[]).includes(value)
}

export function parseNow(expr: string): NowSpec | null {
  if (!/^now[+\-:]/.test(expr)) return null
  const m = NOW_RE.exec(expr)
  if (!m) {
    throw new NowFormatError(
      `invalid now offset in "{{${expr}}}" (use now[±<n><s|m|h|d>]:<format>)`,
    )
  }
  const [, sign, num, unit, format] = m
  if (!isNowFormat(format)) {
    throw new NowFormatError(
      `unknown now format "${format}" in "{{${expr}}}" (use ${NOW_FORMATS.join(' or ')})`,
    )
  }
  const offsetMs = sign ? (sign === '-' ? -1 : 1) * Number(num) * UNIT_MS[unit] : 0
  return { offsetMs, format }
}

export function renderNow(spec: NowSpec, now: Date): string {
  const d = new Date(now.getTime() + spec.offsetMs)
  switch (spec.format) {
    case 'iso':
      return d.toISOString()
    case 'YYYYMMDD':
      return d.toISOString().slice(0, 10).replace(/-/g, '')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mock-engine/now.test.ts`
Expected: PASS (2 `parseNow` + `renderNow` suites, all green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/now.ts tests/mock-engine/now.test.ts
git commit -m "feat(template): now offset parser and renderer module"
```

---

### Task 2: Wire offsets into template resolution

**Files:**
- Modify: `src/lib/mock-engine/template.ts:12-17` (the `resolvePlaceholder` now-branch)
- Test: `tests/mock-engine/template.test.ts`

**Interfaces:**
- Consumes: `parseNow`, `renderNow`, `NowFormatError` from `./now` (Task 1).
- Produces: no new exports; `resolveTemplate` now resolves offset expressions.

- [ ] **Step 1: Write the failing tests**

In `tests/mock-engine/template.test.ts`, add inside the `resolveTemplate` describe block (after the existing "resolves now formatters" test at line 43):

```ts
  it('resolves now offsets deterministically from the injected date', () => {
    expect(resolveTemplate('{{now+3d:iso}}', ctx(), now)).toBe('2026-07-05T10:20:30.000Z')
    expect(resolveTemplate('{{now-15m:iso}}', ctx(), now)).toBe('2026-07-02T10:05:30.000Z')
    expect(resolveTemplate('{{now+1h:iso}}', ctx(), now)).toBe('2026-07-02T11:20:30.000Z')
    expect(resolveTemplate('{{now+1d:YYYYMMDD}}', ctx(), now)).toBe('20260703')
    expect(resolveTemplate('{{now+0d:iso}}', ctx(), now)).toBe('2026-07-02T10:20:30.000Z')
  })

  it('throws PlaceholderError on malformed now offsets', () => {
    expect(() => resolveTemplate('{{now+3x:iso}}', ctx(), now)).toThrow(PlaceholderError)
    expect(() => resolveTemplate('{{now+:iso}}', ctx(), now)).toThrow(PlaceholderError)
  })
```

Note: the existing test at line 60 (`'{{now:nope}}'` throws `PlaceholderError`) must still pass — do not remove it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mock-engine/template.test.ts`
Expected: FAIL — `{{now+3d:iso}}` currently falls through to `parseSelector` and throws with the wrong path / message, and `now+3x:iso` is not yet routed through `NowFormatError`.

- [ ] **Step 3: Update `resolvePlaceholder`**

In `src/lib/mock-engine/template.ts`, add the import at the top (after the existing import block, lines 1-6):

```ts
import { NowFormatError, parseNow, renderNow } from './now'
```

Replace the current now-branch (lines 12-17):

```ts
function resolvePlaceholder(expr: string, ctx: RequestContext, now: Date): string {
  if (expr === 'now:iso') return now.toISOString()
  if (expr === 'now:YYYYMMDD') return now.toISOString().slice(0, 10).replace(/-/g, '')
  if (expr.startsWith('now:')) {
    throw new PlaceholderError(`unknown now formatter in "{{${expr}}}" (use now:iso or now:YYYYMMDD)`)
  }
```

with:

```ts
function resolvePlaceholder(expr: string, ctx: RequestContext, now: Date): string {
  try {
    const spec = parseNow(expr)
    if (spec) return renderNow(spec, now)
  } catch (err) {
    if (err instanceof NowFormatError) throw new PlaceholderError(err.message)
    throw err
  }
```

(The rest of the function — the `parseSelector` block from line 18 onward — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mock-engine/template.test.ts`
Expected: PASS — new offset tests green, and the existing `now:iso` / `now:YYYYMMDD` / `now:nope` / `banana` tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/template.ts tests/mock-engine/template.test.ts
git commit -m "feat(template): resolve now relative-time offsets"
```

---

### Task 3: Widen catalog validation to accept offsets

**Files:**
- Modify: `src/lib/catalog/validate.ts:172-188` (the placeholder validation loop)
- Test: `tests/catalog/validate.test.ts`

**Interfaces:**
- Consumes: `parseNow` from `../mock-engine/now` (Task 1).
- Produces: no new exports; the validator accepts valid offsets and rejects malformed now-expressions.

- [ ] **Step 1: Inspect the current validation loop and test patterns**

Read `src/lib/catalog/validate.ts:172-188` and skim `tests/catalog/validate.test.ts` to match its fixture-building helpers and assertion style (how it constructs a catalog on disk / in a temp dir and asserts on `errors`). Reuse an existing test's setup for the two new cases rather than inventing a new harness.

- [ ] **Step 2: Write the failing tests**

In `tests/catalog/validate.test.ts`, add two cases following the file's existing pattern for placeholder validation:

- A fixture whose body contains `{{now+3d:iso}}` produces **no** validation error.
- A fixture whose body contains `{{now+3x:iso}}` produces an error whose message contains `invalid placeholder "{{now+3x:iso}}"`.

Match the surrounding tests' exact catalog-construction helper and `expect(errors)` assertions (e.g. `expect(errors).not.toContain(...)` / `expect(errors.some(e => e.includes(...))).toBe(true)`). Do not hand-roll a new fixture harness.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/catalog/validate.test.ts`
Expected: FAIL — `{{now+3d:iso}}` currently reaches `parseSelector`, fails, and is wrongly reported as an invalid placeholder.

- [ ] **Step 4: Update the validation loop**

In `src/lib/catalog/validate.ts`, add to the imports (the block importing `listPlaceholders` at lines 3-4):

```ts
import { parseNow } from '../mock-engine/now'
```

Replace the placeholder loop body (lines 176-187):

```ts
        for (const expr of placeholders) {
          if (expr === 'now:iso' || expr === 'now:YYYYMMDD') continue
          try {
            const sel = parseSelector(expr)
            if (sel.source === 'path' && !declaredParams.has(sel.name)) {
              errors.push(
                `${label}: fixture ${file} placeholder "{{${expr}}}" references undeclared path param`,
              )
            }
          } catch {
            errors.push(`${label}: fixture ${file} has invalid placeholder "{{${expr}}}"`)
          }
        }
```

with:

```ts
        for (const expr of placeholders) {
          try {
            if (parseNow(expr)) continue
          } catch {
            errors.push(`${label}: fixture ${file} has invalid placeholder "{{${expr}}}"`)
            continue
          }
          try {
            const sel = parseSelector(expr)
            if (sel.source === 'path' && !declaredParams.has(sel.name)) {
              errors.push(
                `${label}: fixture ${file} placeholder "{{${expr}}}" references undeclared path param`,
              )
            }
          } catch {
            errors.push(`${label}: fixture ${file} has invalid placeholder "{{${expr}}}"`)
          }
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/validate.test.ts`
Expected: PASS — the new offset cases plus all pre-existing validation tests.

- [ ] **Step 6: Run the full suite and lint**

Run: `npm test` then `npm run lint`
Expected: all tests pass; no lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog/validate.ts tests/catalog/validate.test.ts
git commit -m "feat(catalog): accept now offsets in placeholder validation"
```

---

### Task 4: Document the offset grammar

**Files:**
- Modify: `docs/site/docs/building/fixtures.md:44-61` (the `now` placeholder table + note)
- Modify (only where `now` formats are enumerated): `docs/site/docs/reference/gotchas.md`, `docs/site/docs/reference/configuration.md`, `docs/site/docs/get-started/first-mock.md`

**Interfaces:**
- Consumes: nothing.
- Produces: user-facing docs for the offset grammar.

- [ ] **Step 1: Update the fixtures reference table**

In `docs/site/docs/building/fixtures.md`, after the `{{now:YYYYMMDD}}` row (line 46), add:

```markdown
| `{{now+3d:iso}}` | ISO-8601 timestamp offset by `+3` days from request time |
| `{{now-15m:iso}}` | ISO-8601 timestamp offset by `-15` minutes from request time |
```

Then, near the existing note (around lines 47-61), add a short paragraph documenting the grammar:

```markdown
The `now` placeholder accepts an optional relative offset:
`now[±<n><unit>]:<format>`, where `unit` is `s` (seconds), `m` (minutes),
`h` (hours), or `d` (days) — for example `{{now+1h:iso}}` or
`{{now-7d:YYYYMMDD}}`. Offsets are computed from request time in UTC and are
statically validated, so an invalid offset is a catalog error, not a runtime
surprise.
```

- [ ] **Step 2: Update the other three docs where formats are listed**

For each of `docs/site/docs/reference/gotchas.md`, `docs/site/docs/reference/configuration.md`, `docs/site/docs/get-started/first-mock.md`: grep for `now:` and, only where the file enumerates the available `now` formats or shows a `now:` example, add a one-line mention that offsets like `{{now+3d:iso}}` are supported. Do not restructure these pages.

Run: `grep -n "now:" docs/site/docs/reference/gotchas.md docs/site/docs/reference/configuration.md docs/site/docs/get-started/first-mock.md`

- [ ] **Step 3: Build the docs to verify no breakage**

Run: `cd docs/site && uvx zensical build`
Expected: build succeeds with no errors. (See memory: docs build with zensical.)

- [ ] **Step 4: Commit**

```bash
git add docs/site/docs
git commit -m "docs: document now relative-time offsets"
```

---

## Self-Review Notes

- **Spec coverage:** grammar (Task 1), resolution (Task 2), validation widening (Task 3), docs (Task 4). Determinism/UTC enforced via Global Constraints + Task 1 tests. Offset-only scope guarded by the `NOW_FORMATS` constraint. ✅
- **Type consistency:** `parseNow` / `renderNow` / `NowSpec` / `NowFormatError` / `NOW_FORMATS` names match across Tasks 1–3. ✅
- **No placeholders:** all code steps show full code; Task 3 Step 2 and Task 4 Step 2 intentionally defer to existing file patterns (documented why) rather than guessing a harness that isn't in context. ✅
