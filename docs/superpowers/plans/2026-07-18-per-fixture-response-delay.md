# Per-Fixture Response Delay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a fixture declare a `delay` (e.g. `"400ms"`) so the mock waits that long before returning its response.

**Architecture:** A new duration parser turns a `<int><unit>` string into milliseconds. The `delay` field is validated at catalog-load time (fail-fast) and applied at request time on the successful fixture path only, via a `sleep` function injected through `RouterDeps` (defaulting to a real `setTimeout` sleep) so tests never actually wait. The injected delay is recorded as `trace.delayMs`, folds into the reported total `durationMs`, and surfaces on the console log line as `delay=<ms>ms`.

**Tech Stack:** TypeScript, Next.js, Vitest. Tests live under `tests/`, mirroring `src/lib/` paths.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-17-per-fixture-response-delay-design.md` (issue #16).
- `delay` format: `^(\d+)(ms|s|m)$`. Unit multipliers `ms→1`, `s→1000`, `m→60000`. Non-negative integer count. `"0ms"`/`"0s"` are valid no-ops.
- Fixed delay only — **no** jitter (`delay:{minMs,maxMs}`) and **no** server-level global default this ticket.
- Delay applies on the **successful fixture path only** — never on error, passthrough (`real`), or resolver-failure responses.
- Tests must not actually sleep — inject a fake `sleep` in tests that exercise a delay.
- Conventional Commits (per `AGENTS.md`): commit each task with a `Refs #16` footer. Run the full suite with `npm test` (`vitest run`); a single file with `npx vitest run <path>`.
- Do **not** touch the docs guide (`docs/site/`) in this plan — that is a separate, consent-gated step at the finish stage.

---

### Task 1: Duration parser

**Files:**
- Create: `src/lib/mock-engine/duration.ts`
- Test: `tests/mock-engine/duration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class DurationError extends Error {}`
  - `function parseDelayMs(raw: string): number` — returns milliseconds; throws `DurationError` on malformed input.

- [ ] **Step 1: Write the failing test**

Create `tests/mock-engine/duration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DurationError, parseDelayMs } from '../../src/lib/mock-engine/duration'

describe('parseDelayMs', () => {
  it('parses milliseconds', () => {
    expect(parseDelayMs('400ms')).toBe(400)
  })

  it('parses seconds', () => {
    expect(parseDelayMs('2s')).toBe(2000)
  })

  it('parses minutes', () => {
    expect(parseDelayMs('1m')).toBe(60000)
  })

  it('accepts a zero delay for each unit', () => {
    expect(parseDelayMs('0ms')).toBe(0)
    expect(parseDelayMs('0s')).toBe(0)
    expect(parseDelayMs('0m')).toBe(0)
  })

  it.each(['', '400', 'ms', '400 ms', '4.5s', '-1s', '1h', '1d', '1m30s', 'abc'])(
    'throws DurationError for %o',
    (raw) => {
      expect(() => parseDelayMs(raw)).toThrow(DurationError)
    },
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-engine/duration.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/mock-engine/duration`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/mock-engine/duration.ts`:

```ts
export class DurationError extends Error {}

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60000 }

/**
 * Parse a fixture `delay` string into milliseconds. Format:
 * `<non-negative-integer><unit>` where unit is `ms` | `s` | `m`
 * (e.g. "400ms", "2s", "1m"). Throws DurationError on anything else —
 * missing/unsupported unit, non-integer, negative, empty, or compound.
 */
export function parseDelayMs(raw: string): number {
  const match = /^(\d+)(ms|s|m)$/.exec(raw)
  if (!match) {
    throw new DurationError(
      `invalid delay "${raw}" (use a duration like "400ms", "2s", or "1m")`,
    )
  }
  return Number(match[1]) * UNIT_MS[match[2]]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-engine/duration.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mock-engine/duration.ts tests/mock-engine/duration.test.ts
git commit -m "feat(fault-sim): add delay duration parser

Refs #16"
```

---

### Task 2: Fixture `delay` field + static validation

**Files:**
- Modify: `src/lib/mock-engine/fixtures.ts` (the `Fixture` interface)
- Modify: `src/lib/catalog/validate.ts` (per-fixture validation block, around line 152–156)
- Test: `tests/catalog/validate.test.ts`

**Interfaces:**
- Consumes: `parseDelayMs`, `DurationError` from Task 1.
- Produces: `Fixture.delay?: string` — read at request time by Task 3.

- [ ] **Step 1: Write the failing test**

In `tests/catalog/validate.test.ts`, find the top-of-file constant `GOOD_FIXTURE` (used by existing tests) and add these tests inside the `describe('validateCatalog', ...)` block:

```ts
it('accepts a fixture with a valid delay', () => {
  const dir = tmpCatalogDir({
    'test-system/hello_world/default.json': { status: 200, delay: '400ms', body: { ok: true } },
  })
  expect(validateCatalog(catalog([endpoint()]), dir).errors).toEqual([])
})

it('rejects a fixture with a malformed delay', () => {
  const dir = tmpCatalogDir({
    'test-system/hello_world/default.json': { status: 200, delay: '400', body: { ok: true } },
  })
  expect(validateCatalog(catalog([endpoint()]), dir).errors.join('\n')).toMatch(
    /invalid delay "400"/,
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/catalog/validate.test.ts`
Expected: FAIL — the malformed-delay case gets no error (empty `errors`), so the `.toMatch` assertion fails.

- [ ] **Step 3: Add the `delay` field to the Fixture type**

In `src/lib/mock-engine/fixtures.ts`, add `delay` to the `Fixture` interface:

```ts
export interface Fixture {
  description?: string
  summary?: string
  status: number
  /** Optional response delay, e.g. "400ms", "2s", "1m". Applied before the
   * mock response is returned. Validated at catalog load. */
  delay?: string
  headers?: Record<string, string>
  body: unknown
}
```

- [ ] **Step 4: Validate `delay` in validate.ts**

In `src/lib/catalog/validate.ts`, add the import at the top alongside the existing `fixtures` import:

```ts
import { parseDelayMs, DurationError } from '../mock-engine/duration'
```

Then, in the per-fixture block, immediately after the existing status/body check:

```ts
        if (typeof fixture.status !== 'number' || !('body' in fixture)) {
          errors.push(`${label}: fixture ${file} must have numeric "status" and a "body"`)
          continue
        }
```

insert the delay check:

```ts
        if ('delay' in fixture && fixture.delay !== undefined) {
          if (typeof fixture.delay !== 'string') {
            errors.push(`${label}: fixture ${file} "delay" must be a string like "400ms", "2s", or "1m"`)
            continue
          }
          try {
            parseDelayMs(fixture.delay)
          } catch (err) {
            if (err instanceof DurationError) {
              errors.push(`${label}: fixture ${file} has ${err.message}`)
              continue
            }
            throw err
          }
        }
```

Note: the local `fixture` variable here is typed `{ status?: unknown; headers?: unknown; body?: unknown }`. Widen that annotation to include `delay?: unknown`:

```ts
        let fixture: { status?: unknown; headers?: unknown; body?: unknown; delay?: unknown }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/validate.test.ts`
Expected: PASS (both new cases and all existing cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mock-engine/fixtures.ts src/lib/catalog/validate.ts tests/catalog/validate.test.ts
git commit -m "feat(fault-sim): validate fixture delay field at catalog load

Refs #16"
```

---

### Task 3: Apply the delay at request time

**Files:**
- Modify: `src/lib/logs/store.ts` (`LogTraceData` interface, around line 23–36)
- Modify: `src/lib/router/route-request.ts` (`RouterDeps` interface; the fixture-success `try` block; its `catch`)
- Test: `tests/router/route-request.test.ts`

**Interfaces:**
- Consumes: `parseDelayMs`, `DurationError` (Task 1); `Fixture.delay` (Task 2).
- Produces:
  - `RouterDeps.sleep?: (ms: number) => Promise<void>` — defaults to a real `setTimeout` sleep.
  - `LogTraceData.delayMs?: number` — set when a positive delay is applied; read by Task 4.

- [ ] **Step 1: Add `delayMs` to LogTraceData**

In `src/lib/logs/store.ts`, add to the `LogTraceData` interface (place it near `upstream`, which also carries timing):

```ts
  /** Injected response delay in ms, when a fixture declared a `delay`. Folded
   * into the entry's total durationMs; recorded here to distinguish injected
   * latency from real work. */
  delayMs?: number
```

- [ ] **Step 2: Write the failing tests**

In `tests/router/route-request.test.ts`, add a delay fixture and tests. First create the fixture file `tests/testdata/fixtures/test-system/hello_world/slow.json`:

```json
{
  "status": 200,
  "delay": "400ms",
  "body": { "ok": true }
}
```

Register the `slow` scenario on the `hello_world` endpoint in the test `CATALOG` (top of `route-request.test.ts`) by changing its `scenarios` line to:

```ts
          scenarios: { default: { label: 'Success' }, failure: { label: 'Failure' }, slow: { label: 'Slow' } },
```

Then add this `describe` block (near the other `describe('mock path', ...)` tests):

```ts
describe('response delay', () => {
  it('awaits the injected sleep with the fixture delay and records trace.delayMs', async () => {
    const slept: number[] = []
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: { hello_world: 'slow' } })),
      sleep: async (ms) => {
        slept.push(ms)
      },
      trace,
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(200)
    expect(slept).toEqual([400])
    expect(trace.delayMs).toBe(400)
  })

  it('does not sleep for a fixture without a delay', async () => {
    const slept: number[] = []
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: { hello_world: 'default' } })),
      sleep: async (ms) => {
        slept.push(ms)
      },
      trace,
    })
    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(slept).toEqual([])
    expect(trace.delayMs).toBeUndefined()
  })

  it('does not sleep when the request errors before serving a fixture', async () => {
    const slept: number[] = []
    const d = deps({
      unmockedUsers: 'ERROR',
      getProfile: async () => null,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'ghost' }), d)
    expect(res.status).toBe(404)
    expect(slept).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/router/route-request.test.ts`
Expected: FAIL — `slept` is empty and `trace.delayMs` is undefined for the `slow` case (delay not yet applied). `sleep` is also not yet a known key on `RouterDeps` (TS error), which the next step resolves.

- [ ] **Step 4: Add the `sleep` dep and a real default**

In `src/lib/router/route-request.ts`, add the import near the other mock-engine imports:

```ts
import { parseDelayMs, DurationError } from '../mock-engine/duration'
```

Add `sleep` to the `RouterDeps` interface, next to `now?`:

```ts
  now?: () => Date
  /** Injected sleep so tests never wait; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>
  trace?: RouteTrace
```

Add a module-level default near the top-level helpers (e.g. just below `jsonResult`):

```ts
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

- [ ] **Step 5: Apply the delay on the fixture-success path**

In `routeRequest`, in the final `try` block, change the tail from:

```ts
    trace.placeholders = placeholders
    trace.outcome = 'fixture'
    return { status: fixture.status, headers, bodyBytes: Buffer.from(JSON.stringify(body)) }
```

to:

```ts
    trace.placeholders = placeholders
    trace.outcome = 'fixture'
    if (fixture.delay !== undefined) {
      const ms = parseDelayMs(fixture.delay)
      if (ms > 0) {
        trace.delayMs = ms
        await (deps.sleep ?? realSleep)(ms)
      }
    }
    return { status: fixture.status, headers, bodyBytes: Buffer.from(JSON.stringify(body)) }
```

And widen the surrounding `catch` to treat a `DurationError` (should never occur post-validation, but stay defensive) as the existing template error:

```ts
  } catch (err) {
    if (
      err instanceof PlaceholderError ||
      err instanceof FixtureError ||
      err instanceof DurationError
    ) {
      traceError(trace, 'template_error', err.message)
      return jsonResult(500, { error: err.message, endpoint: endpoint.name, scenario })
    }
    throw err
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/router/route-request.test.ts`
Expected: PASS (all three new cases and all existing cases).

- [ ] **Step 7: Commit**

```bash
git add src/lib/logs/store.ts src/lib/router/route-request.ts \
  tests/router/route-request.test.ts \
  tests/testdata/fixtures/test-system/hello_world/slow.json
git commit -m "feat(fault-sim): apply per-fixture response delay via injected sleep

Refs #16"
```

---

### Task 4: Surface the delay on the console log line

**Files:**
- Modify: `src/lib/router/handler.ts` (`formatRequestConsoleLine`, around line 96–116)
- Test: `tests/router/handler.test.ts`

**Interfaces:**
- Consumes: `trace.delayMs` (Task 3).
- Produces: no new exports — a console-line format change.

- [ ] **Step 1: Write the failing tests**

In `tests/router/handler.test.ts`, add these tests inside `describe('mock handler logging', ...)`. They rely on the existing `handlerWith`, `helloRequest`, `spyConsole`, and `settle` helpers; pass a fake `sleep` so the test never waits:

```ts
it('appends delay= to the console line when the fixture declares a delay', async () => {
  const consoleSpy = spyConsole()
  const { handle } = handlerWith({
    consoleLogLevel: 'info',
    sleep: async () => {},
    loadFixture: () => ({ status: 200, headers: {}, delay: '400ms', body: { ok: true } }),
  })
  await handle(helloRequest(), ['hello'])
  await settle()
  expect(consoleSpy.info).toHaveBeenCalledTimes(1)
  expect(consoleSpy.info.mock.calls[0][0]).toMatch(
    /^\[mock\] POST \/hello -> 200 \d+ms test-system\/hello profile=c1 scenario=default outcome=fixture delay=400ms$/,
  )
  consoleSpy.restore()
})

it('omits delay= when the fixture has no delay', async () => {
  const consoleSpy = spyConsole()
  const { handle } = handlerWith({ consoleLogLevel: 'info' })
  await handle(helloRequest(), ['hello'])
  await settle()
  expect(consoleSpy.info.mock.calls[0][0]).not.toContain('delay=')
  consoleSpy.restore()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/router/handler.test.ts`
Expected: FAIL — the first test's regex does not match because `delay=400ms` is not yet appended.

- [ ] **Step 3: Append `delay=` in the console formatter**

In `src/lib/router/handler.ts`, in `formatRequestConsoleLine`, add the `delay` detail right after the `outcome` push:

```ts
  if (trace.outcome) details.push(`outcome=${trace.outcome}`)
  if (trace.delayMs !== undefined) details.push(`delay=${trace.delayMs}ms`)
  if (trace.error) details.push(`error=${trace.error.code}`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/router/handler.test.ts`
Expected: PASS (both new cases and all existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/router/handler.ts tests/router/handler.test.ts
git commit -m "feat(fault-sim): show injected delay on the request console line

Refs #16"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS — all suites green, no type errors.

- [ ] **Step 2: Lockfile sanity (only if package.json/lock changed)**

This plan adds no dependencies, so no lockfile change is expected. If `package.json` or `package-lock.json` did change, run `npx -y npm@11 ci --dry-run` and confirm exit 0 (per `AGENTS.md`).

---

## Notes for the finish stage (not part of coding tasks)

- Per `AGENTS.md`, the guide pages `docs/site/docs/building/fixtures.md` (fixture shape) and `docs/site/docs/driving/request-logs.md` (the `delay=` console field / `trace.delayMs`) describe behavior this feature changes. **Ask the user** before editing them; if they consent, update and run
  `docs/site/.venv/bin/zensical build -f docs/site/zensical.toml --clean --strict`.
- Feature-lifecycle: move issue #16 to **In Progress** at task start, check off checklist items and post progress comments as tasks land, then post a summary comment and move to **In Review** for the user's approval before closing.
