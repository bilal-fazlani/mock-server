# Per-fixture response delay — design

Tracks GitHub issue #16 (`area: fault-sim`, `enhancement`).

## Summary

Let a fixture delay its response by a configurable amount before replying, so
users can exercise timeouts, spinners, retry/backoff, and circuit breakers
against a mock. Because fixtures live under scenarios/profiles, a delay set on
one profile's fixture makes *that caller's* endpoint slow — per-caller latency
falls out of the existing profile model for free.

```jsonc
{ "status": 200, "delay": "400ms", "body": { /* ... */ } }
```

## Scope

**In scope (this ticket):** a fixed delay, expressed as a human-readable
duration string, applied per-fixture on the successful mock-response path.

**Out of scope (deferred):**

- **Jitter** (`delay: { minMs, maxMs }`). The issue calls for *deterministic*
  jitter seeded from `(profileId, endpoint)` — that seeding infrastructure is
  issue #14's (seeded randomness), which is not yet built. Building jitter now
  would either duplicate/pre-empt #14's seeding decisions or reintroduce the
  test-flakiness the issue explicitly warns against. Defer until #14 lands.
- **Server-level global default delay.** Not needed for the core use case;
  per-fixture (and therefore per-profile) delay is the differentiator.

## Field shape

One optional field on the `Fixture` envelope (`src/lib/mock-engine/fixtures.ts`),
a sibling of `status` / `headers` / `body`:

- `delay?: string` — a duration in the form `<non-negative-integer><unit>`,
  where unit is one of `ms` | `s` | `m`. Examples: `"400ms"`, `"2s"`, `"1m"`.
  Absent means no delay. `"0ms"` / `"0s"` are valid no-ops.

Rationale for a duration string over the issue's original `delayMs: number`:
readability at the call site (`"1m"` beats `60000`). Units are capped at
`ms/s/m` — the sensible range for a response delay; hours would be absurd.

Because `delay` is an envelope field and not part of `body`, it never
participates in `_schema.json` request/response validation.

## Components

### 1. Duration parser — `src/lib/mock-engine/duration.ts` (new)

```ts
export class DurationError extends Error {}
export function parseDelayMs(raw: string): number
```

- Grammar: `^(\d+)(ms|s|m)$`. Unit multipliers `ms→1`, `s→1000`, `m→60000`.
- Returns milliseconds. Throws `DurationError` with a clear message on any
  malformed input (missing unit, unsupported unit, non-integer, empty,
  compound like `"1m30s"`).

Kept separate from `parseRequestLogTtlSeconds` in `src/lib/config.ts`: that
parser is env-config-specific, returns *seconds*, and uses a different unit set
(`s/m/h/d`, no `ms`). No reuse that would couple the two.

### 2. Static validation — `src/lib/catalog/validate.ts`

In the existing per-fixture block (where `status`/`body` are already checked
after `JSON.parse`), if `delay` is present, run it through `parseDelayMs` and on
failure push a catalog error:

```
<label>: fixture <file> has invalid delay "<raw>" (use e.g. "400ms", "2s", "1m")
```

A typo therefore fails at **startup**, not at request time.

### 3. Applying the delay — `src/lib/router/route-request.ts`

Applied on the **successful fixture path only** — after the body and headers are
assembled and response-schema validation passes, immediately before the final
`return { status, headers, bodyBytes }`. Error responses, passthrough (`real`),
and resolver failures are never delayed; the delay simulates the mocked
dependency's happy-path latency, not internal failures.

For test determinism the sleep is injected via `RouterDeps`, mirroring the
existing `now?: () => Date`:

```ts
sleep?: (ms: number) => Promise<void>   // default: setTimeout-based real sleep
```

Tests pass a fake `sleep` that records the requested ms and resolves
immediately — no real waiting, and the exact delay is assertable.

When `fixture.delay` is present: `const ms = parseDelayMs(fixture.delay)`; if
`ms > 0`, set `trace.delayMs = ms` and `await sleep(ms)`. `parseDelayMs` is
re-run here (it's guaranteed valid post-validation, but a `DurationError` would
surface as the existing `template_error` 500 rather than crash).

### 4. Log recording — `src/lib/logs/store.ts`, `src/lib/router/handler.ts`

- Add `delayMs?: number` to `LogTraceData`. It flows into the persisted log
  entry's `trace` automatically via the existing spread in `buildLogEntry`.
- In `formatRequestConsoleLine` (handler.ts), when `trace.delayMs` is set,
  append `delay=<ms>ms` to the console line. When no delay is configured the
  line is byte-for-byte unchanged from today.
- Total `durationMs` naturally includes the injected delay, because
  `handler.ts` measures it around the whole `routeRequest` call. So the log
  shows both the total and, separately, how much of it was injected.

## Data flow

```
fixture.delay ("400ms")
  └─ startup: validate.ts → parseDelayMs → catalog error if malformed
  └─ request: route-request.ts (fixture path, post-validation)
       → parseDelayMs → ms
       → trace.delayMs = ms; await deps.sleep(ms)
       → return response
  └─ handler.ts: durationMs (includes delay) + trace.delayMs
       → console line "... 412ms ... delay=400ms"
       → persisted log entry trace.delayMs
```

## Testing

- `tests/**/duration.test.ts` — parser: each valid unit; rejects missing unit,
  bad unit, non-integer, empty, compound; `0` variants accepted.
- route-request tests — fixture with `delay` calls injected `sleep` with the
  correct ms and sets `trace.delayMs`; fixture without `delay` never calls
  `sleep`; error and passthrough paths never call `sleep`.
- validate test — a fixture with a malformed `delay` yields a catalog error.

## Docs impact

Guide pages affected (edit only on user consent, per AGENTS.md):

- `docs/site/docs/building/fixtures.md` — document the `delay` field on the
  fixture shape.
- `docs/site/docs/driving/request-logs.md` — document the `delay=` console field
  and `trace.delayMs` in the persisted log.

## Related

- #14 seeded randomness — shares the seeding design that deferred jitter will
  build on.
- Sibling fault-injection ticket (connection reset / hung socket / malformed
  body) — filed separately.
