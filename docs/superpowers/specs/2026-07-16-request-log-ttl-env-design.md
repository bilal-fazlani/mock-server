# Request log TTL env var — design

## Problem

Request logs expire via a hardcoded MongoDB TTL index — `expireAfterSeconds: 86400`
(24h) created in `ensureIndexes()` at `src/lib/profiles/store.ts`. There is no way to
change this retention window without editing code. We want operators to configure it
with an environment variable.

## Solution

A new env var `REQUEST_LOG_TTL_DURATION` holds a human duration string. Its parsed
value drives the `expireAfterSeconds` of the `requestLogs.ts_1` TTL index. When the
value changes between boots, the index is migrated in place so no logs are lost.

### Env var contract

- **Name:** `REQUEST_LOG_TTL_DURATION`
- **Format:** `<positive-integer><unit>`, unit ∈ `s`, `m`, `h`, `d`
  (seconds, minutes, hours, days). Examples: `30m`, `24h`, `1d`, `7d`.
- **Default** (unset or empty string): `1d` → 86400s. Identical to today, so a server
  with the var unset behaves exactly as before.
- **No disable option.** Logs always expire.
- **Invalid values** (bad/missing unit, zero, negative, non-integer, trailing junk,
  compound like `1d12h`) throw a `ConfigError` that fails startup — same failure mode
  as `DYNAMIC_HISTORY_LIMIT`.

### Component 1 — parser

`parseRequestLogTtlSeconds(raw: string | undefined): number` in `src/lib/config.ts`,
alongside the existing `parseDynamicHistoryLimit` etc.

- `raw` undefined or `''` → return `86400`.
- Match against `/^(\d+)(s|m|h|d)$/`. On no match, throw
  `ConfigError('REQUEST_LOG_TTL_DURATION must be a positive duration like "24h", "30m", "7d", got "<raw>"')`.
- Reject a zero count (e.g. `0h`) with the same error.
- Multiply the integer by the unit's seconds (`s`=1, `m`=60, `h`=3600, `d`=86400) and
  return. Result is always an integer, satisfying MongoDB's `expireAfterSeconds`.

Unit-tested like the other parsers: valid units, default, and each invalid shape.

### Component 2 — startup validation

In `getRuntime()` (`src/lib/runtime.ts`), call
`parseRequestLogTtlSeconds(process.env.REQUEST_LOG_TTL_DURATION)` alongside the other
`parseX` calls so a malformed value fails at the same startup-validation gate. The
value itself is **not** stored on `Runtime` — `ensureIndexes` re-reads and parses the env
var independently (it runs on first DB connect, decoupled from `getRuntime`). This call
exists purely to fail fast at startup; its return value is intentionally discarded (a
short comment notes why, so it doesn't read as a mistake).

### Component 3 — index reconciliation (graceful migration)

Replace the single `createIndex({ ts: 1 }, { expireAfterSeconds: 86400 })` call in
`ensureIndexes()` with reconciliation logic. MongoDB rejects a `createIndex` that only
changes `expireAfterSeconds` on an existing index (IndexOptionsConflict), so we cannot
just re-declare it. Steps:

1. `const ttlSeconds = parseRequestLogTtlSeconds(process.env.REQUEST_LOG_TTL_DURATION)`.
2. `listIndexes()` on `requestLogs`; find the index whose key is `{ ts: 1 }` (name
   `ts_1`).
3. **Missing** → `createIndex({ ts: 1 }, { expireAfterSeconds: ttlSeconds })`.
4. **Exists with `expireAfterSeconds === ttlSeconds`** → no-op.
5. **Exists with a different `expireAfterSeconds`** → migrate in place:
   `db.command({ collMod: 'requestLogs', index: { keyPattern: { ts: 1 }, expireAfterSeconds: ttlSeconds } })`.
   `collMod` rewrites the TTL without dropping the index — no data loss.
6. **Defensive fallback — exists but has no `expireAfterSeconds`** (a non-TTL `ts_1`
   index, which this codebase never creates but could exist from an older/hand-modified
   DB): `dropIndex('ts_1')` then `createIndex` with the TTL. `collMod` cannot add a TTL
   to a non-TTL index on all server versions, so drop+recreate is the safe path.

The other `requestLogs` indexes (`logId`, `profileId,ts`, `endpoint,ts`, `ts,-1 logId,-1`)
are unchanged.

The comment above the index ("Request logs expire after 24 hours") is updated to say the
window is configurable via `REQUEST_LOG_TTL_DURATION` (default `1d`).

Chosen over a try-`createIndex`/catch-conflict approach because introspection is explicit
and doesn't depend on matching Mongo error codes across versions.

## Out of scope

- No change to how logs are written or read.
- No per-profile or per-endpoint TTLs.
- No runtime API to change the TTL without a restart (env-var only; the index migrates on
  next boot).

## Testing

- Unit tests for `parseRequestLogTtlSeconds`: each unit, default, and invalid shapes
  (`w` now invalid, `0h`, `1d12h`, `abc`, bare `100`, negative).
- Reconciliation is covered against a real MongoDB (the repo's existing store tests use
  one): assert the TTL after first `ensureIndexes` with a given env value, then re-run
  with a changed value and assert the index's `expireAfterSeconds` migrated without the
  collection's documents being dropped.

## Docs (follow-up, gated on consent)

Per AGENTS.md this change is guide-affecting (request logging + a new env var). After the
code lands, propose updates to `docs/site/docs/driving/request-logs.md` and
`docs/site/docs/reference/configuration.md`, and — only on user consent — edit them and
rebuild the Zensical site with `--strict`.
