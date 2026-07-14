# Logs Pagination + Live Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the request-logs page bounded under load by shipping lightweight row summaries with lazy payload fetch, infinite-scroll into history via a keyset cursor, and a tail/browse two-mode live poll that never yanks scroll position.

**Architecture:** The Mongo store gains a `before` keyset cursor (symmetric to the existing `since`), a summary projection that drops heavy payload fields, and a single-entry fetch. The list API returns summaries; a new detail route serves full entries on row expand. A pure `list-state.ts` module owns all the merge/dedup/trim/buffer/cap logic (unit-tested in the node env), and `LogsView` wires it to an IntersectionObserver sentinel, a "N new ↑" pill, and scroll-driven mode switching.

**Tech Stack:** Next.js 16 (App Router, `force-dynamic` route handlers), React 19, MongoDB (`mongodb` driver), Vitest (`environment: 'node'`, SSR string assertions via `react-dom/server`), `mongodb-memory-server` for store tests.

## Global Constraints

- Test environment is `node` (`vitest.config.ts`) — **no jsdom, no @testing-library**. UI component tests assert `renderToStaticMarkup(...)` output strings. All stateful/interaction logic must live in pure functions unit-tested without a DOM.
- Do not add new runtime or dev dependencies.
- Next 16 route handlers and pages receive `params` as a `Promise` — `{ params }: { params: Promise<{ logId: string }> }`, awaited before use.
- `getDb()` is `async` and returns `Promise<Db>` (`src/lib/profiles/store.ts:79`).
- Log list sort is fixed at `{ ts: -1, logId: -1 }` (newest first). Every cursor and dedup rule must respect that order.
- The `requestLogs` collection has a 24h TTL and indexes on `ts`, unique `logId`, `profileId+ts`, `endpoint+ts` (`src/lib/profiles/store.ts:104`). Do not change them.
- Status tone convention stays: 2xx green, 3xx yellow, 4xx/5xx red.
- Follow existing style: 2-space indent, no semicolons, single quotes (see any `src/` file).

---

## File Structure

- `src/lib/logs/store.ts` — **modify**: shared keyset filter builder, `beforeId` cursor, keyset `sinceId` fix, `listLogSummaries` + `LogSummary` type, `getLogEntry`.
- `src/app/ui/logs/types.ts` — **modify**: add `LogSummaryView` + `toLogSummaryView`.
- `src/app/ui/api/logs/route.ts` — **modify**: return summaries, accept `before`.
- `src/app/ui/api/logs/[logId]/route.ts` — **create**: single-entry detail route.
- `src/app/ui/logs/page.tsx` — **modify**: SSR loads summaries.
- `src/app/ui/logs/LogRow.tsx` — **modify**: accept `LogSummaryView`, lazy-fetch detail on expand, `initialDetail` seed + loading state.
- `src/app/ui/logs/list-state.ts` — **create**: pure merge/dedup/trim/buffer/cap helpers + constants.
- `src/app/ui/logs/LogsView.tsx` — **modify**: wire pure module, sentinel, pill, mode switching.
- `src/app/ui/logs/logs.module.css` — **modify**: styles for pill, sentinel, detail-loading, floor/cap markers.
- Tests: `tests/logs/store.test.ts` (extend), `tests/ui/list-state.test.ts` (create), `tests/ui/log-row.test.tsx` (adjust), `tests/ui/logs-view.test.tsx` (extend).

---

## Task 1: Store — keyset cursors, summary projection, single-entry fetch

**Files:**
- Modify: `src/lib/logs/store.ts`
- Test: `tests/logs/store.test.ts`

**Interfaces:**
- Consumes: existing `LogEntry`, `insertLogEntry`, `listLogEntries`, `ListLogsOptions`.
- Produces:
  - `ListLogsOptions` gains `beforeId?: string`.
  - `type LogSummary = Omit<LogEntry, 'request' | 'response'> & { response?: { status: number } }`
  - `listLogSummaries(db: Db, options: ListLogsOptions): Promise<LogSummary[]>`
  - `getLogEntry(db: Db, logId: string): Promise<LogEntry | null>`
  - `listLogEntries` unchanged in signature; `sinceId` now uses a keyset (no same-millisecond skips).

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/logs/store.test.ts`. Import the new names by extending the existing import block to:
`import { clearLogs, getLogEntry, insertLogEntry, listLogEntries, listLogSummaries, type LogEntry } from '../../src/lib/logs/store'`

```ts
  it('sinceId keyset does not skip entries sharing the newest millisecond', async () => {
    const ts = new Date('2026-07-07T09:00:00.000Z')
    await insertLogEntry(db, entry({ ts, logId: 'lg_k1' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_k2' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_k3' }))

    // Cursor at the lexicographically-middle id must still return the newer one.
    const newer = await listLogEntries(db, { sinceId: 'lg_k2' })
    expect(newer.map((e) => e.logId)).toEqual(['lg_k3'])
  })

  it('beforeId returns strictly-older entries, newest first', async () => {
    const a = entry({ ts: new Date('2026-07-07T09:00:01.000Z'), logId: 'lg_o1' })
    const b = entry({ ts: new Date('2026-07-07T09:00:02.000Z'), logId: 'lg_o2' })
    const c = entry({ ts: new Date('2026-07-07T09:00:03.000Z'), logId: 'lg_o3' })
    for (const e of [a, b, c]) await insertLogEntry(db, e)

    const older = await listLogEntries(db, { beforeId: 'lg_o3' })
    expect(older.map((e) => e.logId)).toEqual(['lg_o2', 'lg_o1'])
    expect(await listLogEntries(db, { beforeId: 'lg_o1' })).toHaveLength(0)
  })

  it('beforeId breaks same-millisecond ties by logId', async () => {
    const ts = new Date('2026-07-07T09:00:00.000Z')
    await insertLogEntry(db, entry({ ts, logId: 'lg_t1' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_t2' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_t3' }))

    const older = await listLogEntries(db, { beforeId: 'lg_t3' })
    expect(older.map((e) => e.logId)).toEqual(['lg_t2', 'lg_t1'])
  })

  it('unknown beforeId yields no older results', async () => {
    await insertLogEntry(db, entry())
    expect(await listLogEntries(db, { beforeId: 'lg_gone' })).toHaveLength(0)
  })

  it('listLogSummaries omits payload bodies but keeps status and trace', async () => {
    await insertLogEntry(
      db,
      entry({
        request: { headers: { 'content-type': 'application/json' }, body: { big: 'x' }, truncated: false },
        response: { status: 201, headers: { 'x-a': 'b' }, body: { ok: true }, truncated: false },
        trace: { scenario: 'default', scenarioSource: 'implicit' },
      }),
    )

    const [summary] = await listLogSummaries(db, {})
    // `request` is projected out; assert absence with `in` (the type omits it).
    expect('request' in summary).toBe(false)
    expect(summary.response).toEqual({ status: 201 })
    expect(summary.trace).toEqual({ scenario: 'default', scenarioSource: 'implicit' })
    expect('_id' in summary).toBe(false)
  })

  it('getLogEntry returns the full entry or null', async () => {
    await insertLogEntry(db, entry({ logId: 'lg_full', response: { status: 200, headers: {}, body: { ok: 1 }, truncated: false } }))
    const full = await getLogEntry(db, 'lg_full')
    expect(full?.response?.body).toEqual({ ok: 1 })
    expect(await getLogEntry(db, 'lg_missing')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/logs/store.test.ts`
Expected: FAIL — `listLogSummaries` / `getLogEntry` are not exported; `beforeId` tests fail (currently ignored) and the same-millisecond `sinceId` test fails.

- [ ] **Step 3: Implement the store changes**

In `src/lib/logs/store.ts`, add `beforeId` to the options, add the `LogSummary` type, replace `listLogEntries` internals to share a keyset-aware filter builder, and add `listLogSummaries` + `getLogEntry`. Replace the existing `ListLogsOptions` interface and the `listLogEntries` function with:

```ts
export interface ListLogsOptions {
  profileId?: string
  endpoint?: string
  errorsOnly?: boolean
  /** Case-insensitive prefix match on logId (paste from x-mock-log-id). */
  logIdQuery?: string
  sinceId?: string
  beforeId?: string
  limit?: number
}

export type LogSummary = Omit<LogEntry, 'request' | 'response'> & {
  response?: { status: number }
}

const DEFAULT_LIMIT = 100

const SUMMARY_PROJECTION = {
  _id: 0,
  request: 0,
  'response.headers': 0,
  'response.body': 0,
  'response.truncated': 0,
} as const

async function buildLogFilter(
  collection: import('mongodb').Collection<LogEntry>,
  options: ListLogsOptions,
): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {}
  if (options.profileId) filter.profileId = options.profileId
  if (options.endpoint) filter.endpoint = options.endpoint
  if (options.errorsOnly) filter.outcome = 'error'
  if (options.logIdQuery) {
    filter.logId = { $regex: `^${escapeRegex(options.logIdQuery)}`, $options: 'i' }
  }
  // Keyset cursors respect the { ts: -1, logId: -1 } sort so entries sharing a
  // millisecond are never skipped. `before` (older) takes precedence over
  // `since` (newer) if both are somehow supplied; the UI only sends one.
  const cursorId = options.beforeId ?? options.sinceId
  if (cursorId) {
    const cursor = await collection.findOne(
      { logId: cursorId },
      { projection: { _id: 0, ts: 1, logId: 1 } },
    )
    if (cursor) {
      const op = options.beforeId ? '$lt' : '$gt'
      filter.$or = [{ ts: { [op]: cursor.ts } }, { ts: cursor.ts, logId: { [op]: cursor.logId } }]
    } else if (options.beforeId) {
      // An unknown/expired `before` cursor means "no older entries" rather than
      // falling back to the newest page (that fallback only makes sense for `since`).
      filter.logId = '__none__'
    }
  }
  return filter
}

export async function listLogEntries(db: Db, options: ListLogsOptions): Promise<LogEntry[]> {
  const collection = db.collection<LogEntry>('requestLogs')
  const filter = await buildLogFilter(collection, options)
  return collection
    .find(filter, { projection: { _id: 0 } })
    .sort({ ts: -1, logId: -1 })
    .limit(options.limit ?? DEFAULT_LIMIT)
    .toArray()
}

export async function listLogSummaries(db: Db, options: ListLogsOptions): Promise<LogSummary[]> {
  const collection = db.collection<LogEntry>('requestLogs')
  const filter = await buildLogFilter(collection, options)
  return collection
    .find(filter, { projection: SUMMARY_PROJECTION })
    .sort({ ts: -1, logId: -1 })
    .limit(options.limit ?? DEFAULT_LIMIT)
    .toArray() as unknown as Promise<LogSummary[]>
}

export async function getLogEntry(db: Db, logId: string): Promise<LogEntry | null> {
  return db.collection<LogEntry>('requestLogs').findOne({ logId }, { projection: { _id: 0 } })
}
```

Delete the old `const DEFAULT_LIMIT = 100` line further up (it now lives above `buildLogFilter`) so it is declared exactly once. Leave `insertLogEntry`, `clearLogs`, `newLogId`, and `escapeRegex` unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/logs/store.test.ts`
Expected: PASS — all existing tests plus the six new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logs/store.ts tests/logs/store.test.ts
git commit -m "feat(logs): add before cursor, summary projection, and single-entry fetch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: View summary type + mapper

**Files:**
- Modify: `src/app/ui/logs/types.ts`
- Test: `tests/ui/log-summary-view.test.ts`

**Interfaces:**
- Consumes: `LogSummary` (Task 1); existing `LogEntry`, `LogEntryView`.
- Produces:
  - `type LogSummaryView = Omit<LogEntryView, 'request' | 'response'> & { response?: { status: number } }`
  - `toLogSummaryView(entry: LogSummary): LogSummaryView`

This task only *adds* symbols — no existing consumer changes — so the tree stays green. `page.tsx`, the list route, and `LogsView` switch to summaries atomically in Task 5.

- [ ] **Step 1: Write the failing mapper test**

Create `tests/ui/log-summary-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LogSummary } from '../../src/lib/logs/store'
import { toLogSummaryView } from '../../src/app/ui/logs/types'

describe('toLogSummaryView', () => {
  it('serializes ts to ISO and keeps summary-safe fields', () => {
    const summary = {
      logId: 'lg_x',
      ts: new Date('2026-07-07T09:14:03.120Z'),
      kind: 'request',
      method: 'POST',
      path: '/x',
      query: '',
      outcome: 'fixture',
      response: { status: 201 },
      trace: { scenario: 'default' },
    } as LogSummary

    const view = toLogSummaryView(summary)
    expect(view.ts).toBe('2026-07-07T09:14:03.120Z')
    expect(view.response).toEqual({ status: 201 })
    expect('request' in view).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/log-summary-view.test.ts`
Expected: FAIL — `toLogSummaryView` is not exported.

- [ ] **Step 3: Add the summary view type and mapper**

In `src/app/ui/logs/types.ts`, change the first import line to add `LogSummary`, and append the new type + mapper:

```ts
import type { LogEntry, LogSummary } from '../../../lib/logs/store'
```

```ts
/** Row-list shape: LogEntryView without the heavy request/response payloads. */
export type LogSummaryView = Omit<LogEntryView, 'request' | 'response'> & {
  response?: { status: number }
}

export function toLogSummaryView(entry: LogSummary): LogSummaryView {
  return { ...entry, ts: new Date(entry.ts).toISOString() }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ui/log-summary-view.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/logs/types.ts tests/ui/log-summary-view.test.ts
git commit -m "feat(logs): add LogSummaryView type and mapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Detail route + LogRow lazy-loads payloads on expand

**Files:**
- Create: `src/app/ui/api/logs/[logId]/route.ts`
- Modify: `src/app/ui/logs/LogRow.tsx`
- Test: `tests/ui/log-row.test.tsx`

**Interfaces:**
- Consumes: `getLogEntry` (Task 1), `toLogEntryView`, `LogSummaryView` (Task 2), existing `LogEntryView`.
- Produces:
  - `GET /ui/api/logs/[logId]` → `{ entry: LogEntryView }` (200) or `{ error: 'not_found' }` (404).
  - `LogRow` prop `entry` is now `LogSummaryView`; new optional prop `initialDetail?: LogEntryView` seeds the expanded detail (used as row cache and by tests). When expanded without a seed, `LogRow` fetches the detail route and shows a loading state until it resolves.

- [ ] **Step 1: Write the detail route**

Create `src/app/ui/api/logs/[logId]/route.ts`:

```ts
import { getLogEntry } from '../../../../../lib/logs/store'
import { getDb } from '../../../../../lib/profiles/store'
import { toLogEntryView } from '../../../logs/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ logId: string }> },
): Promise<Response> {
  const { logId } = await params
  const entry = await getLogEntry(await getDb(), logId)
  if (!entry) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ entry: toLogEntryView(entry) })
}
```

- [ ] **Step 2: Adjust the failing LogRow tests**

In `tests/ui/log-row.test.tsx`, the `entry()` helper still returns a full `LogEntryView` (a valid summary superset), so collapsed-summary tests need no change. For every test that renders with `defaultExpanded`, pass the same full entry as `initialDetail` so the detail renders synchronously under SSR. Concretely, in each `defaultExpanded` test change the element to include `initialDetail`:

```tsx
    const full = entry()
    const html = renderToStaticMarkup(
      <LogRow
        entry={full}
        scenarioLabels={{ 'hello-system/hello_world/failure': 'Failure' }}
        defaultExpanded
        initialDetail={full}
      />,
    )
```

Apply the same `initialDetail={...}` addition (using whatever entry that test builds) to the four `defaultExpanded` tests: "shows the decision trace and payloads when expanded", "renders direct profile resolution…", "renders path profile selectors…", and "renders bearer profile selectors…". Then add one new test for the loading state:

```tsx
  it('shows a loading state when expanded without a seeded detail', () => {
    const html = renderToStaticMarkup(<LogRow entry={entry()} defaultExpanded />)
    expect(html).toContain('detailLoading')
    expect(html).not.toContain('Copy as cURL')
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/log-row.test.tsx`
Expected: FAIL — `LogRow` does not yet accept `initialDetail`, and the new loading-state test finds no `detailLoading`.

- [ ] **Step 4: Rework LogRow for summary + lazy detail**

In `src/app/ui/logs/LogRow.tsx`:

Update the top imports to add `useEffect`:
```tsx
import { useEffect, useState } from 'react'
```
and import both view types:
```tsx
import type { LogEntryView, LogSummaryView } from './types'
```

Replace the `LogRow` function signature and body down to the `return` with:

```tsx
export function LogRow({
  entry,
  systemLabels = {},
  scenarioLabels = {},
  captureSelectorLabels = {},
  defaultExpanded = false,
  initialDetail,
}: {
  entry: LogSummaryView
  systemLabels?: Record<string, string>
  scenarioLabels?: Record<string, string>
  captureSelectorLabels?: Record<string, string>
  defaultExpanded?: boolean
  initialDetail?: LogEntryView
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState(false)
  const [detail, setDetail] = useState<LogEntryView | null>(initialDetail ?? null)
  const [detailError, setDetailError] = useState(false)

  // Fetch the full entry (payloads) the first time the row opens.
  useEffect(() => {
    if (!expanded || detail || detailError) return
    let cancelled = false
    fetch(`/ui/api/logs/${encodeURIComponent(entry.logId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('not_found'))))
      .then((data: { entry: LogEntryView }) => {
        if (!cancelled) setDetail(data.entry)
      })
      .catch(() => {
        if (!cancelled) setDetailError(true)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, detail, detailError, entry.logId])

  const isError = entry.outcome === 'error'
  const time = entry.ts.slice(11, 23)
  const systemLabel = entry.system ? (systemLabels[entry.system] ?? entry.system) : undefined
  const systemIsFallback = systemLabel === entry.system
  const scenarioLabel = (scenario: string) =>
    entry.system && entry.endpoint
      ? scenarioLabels[scenarioLabelKey(entry.system, entry.endpoint, scenario)] ?? scenario
      : scenario
```

Keep the entire collapsed `<article>…<button>…</button>` block exactly as it is today (it reads only summary-safe fields). Replace only the trailing `{expanded && <LogDetail … />}` block with:

```tsx
      {expanded &&
        (detail ? (
          <LogDetail
            entry={detail}
            copied={copied}
            setCopied={setCopied}
            captureSelectorLabels={captureSelectorLabels}
          />
        ) : (
          <div className={styles.detailLoading}>
            {detailError ? 'Entry no longer available.' : 'Loading…'}
          </div>
        ))}
    </article>
  )
}
```

Change `LogDetail`'s `entry` parameter type from `LogEntryView` to keep `LogEntryView` (it already is — no change needed there). Everything from `function LogDetail(` downward stays unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/log-row.test.tsx`
Expected: PASS — collapsed tests, the four seeded `defaultExpanded` tests, and the new loading-state test.

- [ ] **Step 6: Add the loading/error style and commit**

Append to `src/app/ui/logs/logs.module.css`:

```css
.detailLoading {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--muted, #6b7280);
}
```

```bash
git add src/app/ui/api/logs/\[logId\]/route.ts src/app/ui/logs/LogRow.tsx tests/ui/log-row.test.tsx src/app/ui/logs/logs.module.css
git commit -m "feat(logs): lazy-load request/response payloads on row expand

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Pure list-state module

**Files:**
- Create: `src/app/ui/logs/list-state.ts`
- Test: `tests/ui/list-state.test.ts`

**Interfaces:**
- Consumes: `LogSummaryView` (Task 2).
- Produces:
  - `TAIL_CAP = 100`, `DOM_CAP = 500`, `OLDER_PAGE_SIZE = 50`, `TOP_THRESHOLD_PX = 8`
  - `mergeTail(current: LogSummaryView[], fresh: LogSummaryView[]): LogSummaryView[]`
  - `appendOlder(current: LogSummaryView[], older: LogSummaryView[]): { rows: LogSummaryView[]; capped: boolean }`
  - `bufferPending(pending: LogSummaryView[], fresh: LogSummaryView[], knownIds: Set<string>): LogSummaryView[]`
  - `flushToTail(rows: LogSummaryView[], pending: LogSummaryView[]): LogSummaryView[]`
  - `atTop(scrollTop: number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/ui/list-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  appendOlder,
  atTop,
  bufferPending,
  DOM_CAP,
  flushToTail,
  mergeTail,
  TAIL_CAP,
} from '../../src/app/ui/logs/list-state'
import type { LogSummaryView } from '../../src/app/ui/logs/types'

function row(logId: string): LogSummaryView {
  return {
    logId,
    ts: '2026-07-07T09:00:00.000Z',
    kind: 'request',
    trace: {},
  } as LogSummaryView
}

function rows(...ids: string[]): LogSummaryView[] {
  return ids.map(row)
}

describe('list-state', () => {
  it('mergeTail prepends fresh, dedupes by logId, and trims to TAIL_CAP', () => {
    const current = rows('b', 'a')
    const merged = mergeTail(current, rows('c', 'b'))
    expect(merged.map((r) => r.logId)).toEqual(['c', 'b', 'a'])
  })

  it('mergeTail caps at TAIL_CAP keeping the newest', () => {
    const fresh = rows(...Array.from({ length: TAIL_CAP + 20 }, (_, i) => `n${i}`))
    const merged = mergeTail([row('old')], fresh)
    expect(merged).toHaveLength(TAIL_CAP)
    expect(merged[0].logId).toBe('n0')
    expect(merged.some((r) => r.logId === 'old')).toBe(false)
  })

  it('appendOlder appends, dedupes, and reports not-capped under the limit', () => {
    const { rows: out, capped } = appendOlder(rows('c', 'b'), rows('b', 'a'))
    expect(out.map((r) => r.logId)).toEqual(['c', 'b', 'a'])
    expect(capped).toBe(false)
  })

  it('appendOlder trims to DOM_CAP and reports capped', () => {
    const current = rows(...Array.from({ length: DOM_CAP - 10 }, (_, i) => `c${i}`))
    const older = rows(...Array.from({ length: 40 }, (_, i) => `o${i}`))
    const { rows: out, capped } = appendOlder(current, older)
    expect(out).toHaveLength(DOM_CAP)
    expect(capped).toBe(true)
    expect(out[0].logId).toBe('c0')
  })

  it('bufferPending accumulates only entries not already known or buffered', () => {
    const known = new Set(['a', 'b'])
    const pending = bufferPending(rows('c'), rows('d', 'c', 'a'), known)
    expect(pending.map((r) => r.logId)).toEqual(['d', 'c'])
  })

  it('flushToTail prepends pending, drops older rows, trims to TAIL_CAP', () => {
    const rendered = rows(...Array.from({ length: 200 }, (_, i) => `r${i}`))
    const pending = rows('p1', 'p0')
    const flushed = flushToTail(rendered, pending)
    expect(flushed).toHaveLength(TAIL_CAP)
    expect(flushed.slice(0, 2).map((r) => r.logId)).toEqual(['p1', 'p0'])
    expect(flushed.some((r) => r.logId === 'r199')).toBe(false)
  })

  it('atTop is true near zero and false when scrolled', () => {
    expect(atTop(0)).toBe(true)
    expect(atTop(4)).toBe(true)
    expect(atTop(120)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/list-state.test.ts`
Expected: FAIL — module `src/app/ui/logs/list-state.ts` does not exist.

- [ ] **Step 3: Implement the pure module**

Create `src/app/ui/logs/list-state.ts`:

```ts
import type { LogSummaryView } from './types'

export const TAIL_CAP = 100
export const DOM_CAP = 500
export const OLDER_PAGE_SIZE = 50
export const TOP_THRESHOLD_PX = 8

/** Unique by logId, keeping the first occurrence (order preserved). */
function dedupe(entries: LogSummaryView[]): LogSummaryView[] {
  const seen = new Set<string>()
  const out: LogSummaryView[] = []
  for (const e of entries) {
    if (seen.has(e.logId)) continue
    seen.add(e.logId)
    out.push(e)
  }
  return out
}

/** Tail mode: prepend newer entries, dedupe, keep the newest TAIL_CAP. */
export function mergeTail(
  current: LogSummaryView[],
  fresh: LogSummaryView[],
): LogSummaryView[] {
  return dedupe([...fresh, ...current]).slice(0, TAIL_CAP)
}

/** Append older entries, dedupe, and cap the rendered DOM at DOM_CAP. */
export function appendOlder(
  current: LogSummaryView[],
  older: LogSummaryView[],
): { rows: LogSummaryView[]; capped: boolean } {
  const merged = dedupe([...current, ...older])
  const capped = merged.length >= DOM_CAP
  return { rows: merged.slice(0, DOM_CAP), capped }
}

/** Browse mode: accumulate fresh entries not already rendered or buffered. */
export function bufferPending(
  pending: LogSummaryView[],
  fresh: LogSummaryView[],
  knownIds: Set<string>,
): LogSummaryView[] {
  const buffered = new Set(pending.map((e) => e.logId))
  const additions = fresh.filter((e) => !knownIds.has(e.logId) && !buffered.has(e.logId))
  // Fresh arrivals are newer than everything already buffered, so they go in
  // front to keep the buffer newest-first (matching the list sort).
  return [...additions, ...pending]
}

/** Return to tail: prepend buffered entries, drop loaded-older rows, trim. */
export function flushToTail(
  rows: LogSummaryView[],
  pending: LogSummaryView[],
): LogSummaryView[] {
  return dedupe([...pending, ...rows]).slice(0, TAIL_CAP)
}

export function atTop(scrollTop: number): boolean {
  return scrollTop <= TOP_THRESHOLD_PX
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/list-state.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/ui/logs/list-state.ts tests/ui/list-state.test.ts
git commit -m "feat(logs): add pure list-state helpers for tail/browse/cap logic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Summary API + SSR switch + LogsView sentinel/pill/mode switching

**Files:**
- Modify: `src/app/ui/api/logs/route.ts` (list route → summaries, accept `before`)
- Modify: `src/app/ui/logs/page.tsx` (SSR → summaries)
- Modify: `src/app/ui/logs/LogsView.tsx`
- Modify: `src/app/ui/logs/logs.module.css`
- Test: `tests/ui/logs-view.test.tsx`

**Interfaces:**
- Consumes: `listLogSummaries` (Task 1), `LogSummaryView` + `toLogSummaryView` (Task 2), `LogRow` with `entry: LogSummaryView` (Task 3), all `list-state.ts` exports (Task 4).
- Produces:
  - List route `GET /ui/api/logs` returns `{ entries: LogSummaryView[] }` and accepts `before=<logId>`.
  - `page.tsx` passes `LogSummaryView[]` to `LogsView`.
  - `LogsView` props become `initialEntries: LogSummaryView[]`, `options`, `initialProfile`.

This task changes the whole summary data flow at once (API → SSR → `LogsView`), so the types stay consistent end-to-end.

- [ ] **Step 1: Switch the list route to summaries + `before`**

Replace the body of `src/app/ui/api/logs/route.ts` with:

```ts
import { listLogSummaries } from '../../../../lib/logs/store'
import { getDb } from '../../../../lib/profiles/store'
import { toLogSummaryView } from '../../logs/types'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 200

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const requestedLimit = Number.parseInt(params.get('limit') ?? '', 10)
  const entries = await listLogSummaries(await getDb(), {
    profileId: params.get('profile') || undefined,
    endpoint: params.get('endpoint') || undefined,
    errorsOnly: params.get('errorsOnly') === '1',
    logIdQuery: params.get('logId') || undefined,
    sinceId: params.get('since') || undefined,
    beforeId: params.get('before') || undefined,
    limit: Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : undefined,
  })
  return Response.json({ entries: entries.map(toLogSummaryView) })
}
```

- [ ] **Step 2: Switch the SSR loader to summaries**

In `src/app/ui/logs/page.tsx`:
- Replace `import { listLogEntries } from '../../../lib/logs/store'` with `import { listLogSummaries } from '../../../lib/logs/store'`.
- Replace `import { toLogEntryView } from './types'` with `import { toLogSummaryView } from './types'`.
- In the `Promise.all`, replace `listLogEntries(db, { profileId: profile || undefined })` with `listLogSummaries(db, { profileId: profile || undefined })`.
- Replace `initialEntries={entries.map(toLogEntryView)}` with `initialEntries={entries.map(toLogSummaryView)}`.

- [ ] **Step 3: Write the failing SSR tests**

Add to `tests/ui/logs-view.test.tsx`. Extend the top of the file to build a couple of summary entries and assert the sentinel and scroll container render:

```tsx
import type { LogSummaryView } from '../../src/app/ui/logs/types'

function summary(logId: string): LogSummaryView {
  return {
    logId,
    ts: '2026-07-07T09:00:00.000Z',
    kind: 'request',
    method: 'GET',
    path: '/x',
    query: '',
    outcome: 'fixture',
    response: { status: 200 },
    trace: {},
  } as LogSummaryView
}

describe('LogsView pagination', () => {
  it('renders a scroll container and an infinite-scroll sentinel when there are entries', () => {
    const html = renderToStaticMarkup(
      <LogsView
        initialEntries={[summary('lg_1'), summary('lg_2')]}
        options={options}
        initialProfile=""
      />,
    )
    expect(html).toContain('data-logs-scroll')
    expect(html).toContain('data-logs-sentinel')
  })

  it('does not render the sentinel when there are no entries', () => {
    const html = renderToStaticMarkup(
      <LogsView initialEntries={[]} options={options} initialProfile="" />,
    )
    expect(html).not.toContain('data-logs-sentinel')
    expect(html).toContain('No log entries yet')
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/logs-view.test.tsx`
Expected: FAIL — no `data-logs-scroll` / `data-logs-sentinel` in the current markup.

- [ ] **Step 5: Rewrite the LogsView state + effects + render**

In `src/app/ui/logs/LogsView.tsx`:

Replace the imports at the top of the file with:

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronsUpDown, Trash2 } from 'lucide-react'
import { clearLogsAction } from './actions'
import { LogRow } from './LogRow'
import {
  appendOlder,
  atTop,
  bufferPending,
  flushToTail,
  mergeTail,
  OLDER_PAGE_SIZE,
} from './list-state'
import type { LogSummaryView } from './types'
import styles from './logs.module.css'

const POLL_INTERVAL_MS = 2000
const MAX_SUGGESTIONS = 8
```

(Delete the old `MAX_ENTRIES` constant — capping now lives in `list-state.ts`. Keep `ProfileOption`, `EndpointOption`, `LogFilterOptions`, `ProfileFilter`, and `EndpointFilter` exactly as they are.)

Replace the `LogsView` function from its signature through the end of its `return (...)` with:

```tsx
export function LogsView({
  initialEntries,
  options,
  initialProfile = '',
}: {
  initialEntries: LogSummaryView[]
  options: LogFilterOptions
  initialProfile?: string
}) {
  const [entries, setEntries] = useState<LogSummaryView[]>(initialEntries)
  const [pending, setPending] = useState<LogSummaryView[]>([])
  const [profile, setProfile] = useState(initialProfile)
  const [endpoint, setEndpoint] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [logIdQuery, setLogIdQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [atFloor, setAtFloor] = useState(false)
  const [capped, setCapped] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const entriesRef = useRef(entries)
  const pendingRef = useRef(pending)
  const browsingRef = useRef(browsing)
  const loadingOlderRef = useRef(false)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => {
    browsingRef.current = browsing
  }, [browsing])

  const query = useCallback(
    (extra?: { since?: string; before?: string }) => {
      const params = new URLSearchParams()
      if (profile) params.set('profile', profile)
      if (endpoint) params.set('endpoint', endpoint)
      if (errorsOnly) params.set('errorsOnly', '1')
      if (logIdQuery) params.set('logId', logIdQuery)
      if (extra?.since) params.set('since', extra.since)
      if (extra?.before) {
        params.set('before', extra.before)
        params.set('limit', String(OLDER_PAGE_SIZE))
      }
      return `/ui/api/logs?${params}`
    },
    [profile, endpoint, errorsOnly, logIdQuery],
  )

  // Filter change: full refetch, reset to tail.
  useEffect(() => {
    let cancelled = false
    fetch(query())
      .then((res) => res.json())
      .then((data: { entries: LogSummaryView[] }) => {
        if (cancelled) return
        setEntries(data.entries)
        setPending([])
        setBrowsing(false)
        setAtFloor(false)
        setCapped(false)
        scrollRef.current?.scrollTo({ top: 0 })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [query])

  // Live poll: prepend in tail mode, buffer in browse mode.
  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => {
      const newest = entriesRef.current[0]?.logId
      fetch(query({ since: newest }))
        .then((res) => res.json())
        .then((data: { entries: LogSummaryView[] }) => {
          if (data.entries.length === 0) return
          if (browsingRef.current) {
            const known = new Set(entriesRef.current.map((e) => e.logId))
            setPending((current) => bufferPending(current, data.entries, known))
          } else {
            setEntries((current) => mergeTail(current, data.entries))
          }
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [query, paused])

  const loadOlder = useCallback(() => {
    if (loadingOlderRef.current || atFloor || capped) return
    const oldest = entriesRef.current[entriesRef.current.length - 1]?.logId
    if (!oldest) return
    loadingOlderRef.current = true
    fetch(query({ before: oldest }))
      .then((res) => res.json())
      .then((data: { entries: LogSummaryView[] }) => {
        if (data.entries.length < OLDER_PAGE_SIZE) setAtFloor(true)
        if (data.entries.length > 0) {
          setEntries((current) => {
            const { rows, capped: hitCap } = appendOlder(current, data.entries)
            if (hitCap) setCapped(true)
            return rows
          })
        }
      })
      .catch(() => {})
      .finally(() => {
        loadingOlderRef.current = false
      })
  }, [query, atFloor, capped])

  // Infinite scroll: load older when the sentinel enters view.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || atFloor || capped) return
    const observer = new IntersectionObserver(
      (records) => {
        if (records[0]?.isIntersecting) loadOlder()
      },
      { root: scrollRef.current, rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadOlder, atFloor, capped, entries.length])

  const onScroll = useCallback(() => {
    const top = scrollRef.current?.scrollTop ?? 0
    setBrowsing(!atTop(top))
  }, [])

  const jumpToLatest = useCallback(() => {
    setEntries((current) => flushToTail(current, pendingRef.current))
    setPending([])
    setBrowsing(false)
    setAtFloor(false)
    setCapped(false)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.filters}>
          <ProfileFilter
            profiles={options.profiles}
            value={profile}
            onChange={setProfile}
            initialText={initialProfile}
          />
          <EndpointFilter endpoints={options.endpoints} value={endpoint} onChange={setEndpoint} />
          <input
            className={styles.filterInput}
            type="search"
            placeholder="Filter by log id"
            value={logIdQuery}
            onChange={(e) => setLogIdQuery(e.target.value.trim())}
            aria-label="Filter by log id"
          />
          <label className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.target.checked)}
            />
            Errors only
          </label>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.filterToggle}>
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            Pause
          </label>
          <span className={`${styles.liveDot} ${paused ? styles.livePaused : ''}`}>
            {paused ? 'paused' : 'live'}
          </span>
          <form
            action={clearLogsAction}
            onSubmit={() => {
              setEntries([])
              setPending([])
            }}
          >
            {profile && <input type="hidden" name="profileId" value={profile} />}
            <button type="submit" className="btnSecondary">
              <Trash2 style={{ width: 13, height: 13, marginRight: 6, verticalAlign: '-2px' }} aria-hidden="true" />
              Clear {profile ? 'profile logs' : 'all logs'}
            </button>
          </form>
        </div>
      </div>

      {pending.length > 0 && (
        <button type="button" className={styles.newPill} onClick={jumpToLatest}>
          <ArrowUp style={{ width: 13, height: 13, marginRight: 6, verticalAlign: '-2px' }} aria-hidden="true" />
          {pending.length} new
        </button>
      )}

      {entries.length === 0 ? (
        <p className={styles.empty}>No log entries yet — send a request to the mock server.</p>
      ) : (
        <div className={styles.list} data-logs-scroll ref={scrollRef} onScroll={onScroll}>
          {entries.map((entry) => (
            <LogRow
              key={entry.logId}
              entry={entry}
              systemLabels={options.systemLabels}
              scenarioLabels={options.scenarioLabels}
              captureSelectorLabels={options.captureSelectorLabels}
            />
          ))}
          {capped ? (
            <p className={styles.floorMarker}>Showing latest 500 — narrow your filters to see older entries.</p>
          ) : atFloor ? (
            <p className={styles.floorMarker}>Beginning of logs.</p>
          ) : (
            <div data-logs-sentinel ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Add styles for the pill, sentinel, and floor marker**

Append to `src/app/ui/logs/logs.module.css`:

```css
.newPill {
  align-self: center;
  margin: 8px 0;
  padding: 5px 14px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 999px;
  background: var(--accent, #2563eb);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.sentinel {
  height: 1px;
}

.floorMarker {
  padding: 12px 14px;
  text-align: center;
  font-size: 12px;
  color: var(--muted, #6b7280);
}
```

If `.list` is not already a scroll container, ensure it can scroll by adding to the existing `.list` rule (do not duplicate the selector — edit the current one): `max-height: calc(100vh - 180px); overflow-y: auto;`. Inspect the current `.list` block first; only add the two properties if absent.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/logs-view.test.tsx`
Expected: PASS — the two new tests plus the existing filter test.

- [ ] **Step 8: Full test + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — entire suite green, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/ui/api/logs/route.ts src/app/ui/logs/page.tsx src/app/ui/logs/LogsView.tsx src/app/ui/logs/logs.module.css tests/ui/logs-view.test.tsx
git commit -m "feat(logs): infinite-scroll history with tail/browse live polling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the dev server and exercise the flow**

Run: `npm run dev`, open `/ui/logs`, and confirm:
- Send several requests to the mock server; new rows appear at the top within ~2s (tail mode).
- Scroll down past the top; the live "N new ↑" pill appears as new requests arrive and the list does **not** jump.
- Continue scrolling; older entries load automatically (infinite scroll). With few logs, a "Beginning of logs." marker appears instead of loading forever.
- Click the "N new ↑" pill; the view snaps to the top, shows the newest tail, and the pill clears.
- Expand a row; the request/response payloads and "Copy as cURL" load (briefly showing "Loading…").
- Change a filter; the list resets to the newest page in tail mode.

- [ ] **Step 2: Confirm the payload is lighter**

In the browser Network tab, confirm `GET /ui/api/logs` responses no longer include `request`/`response` bodies, and that expanding a row issues a single `GET /ui/api/logs/<logId>` that returns the full entry.

- [ ] **Step 3: Update docs if needed**

Check `docs/site/docs/guide/reference/request-logs.md` for any description of the log list's loading/paging behavior; if it describes the old fixed-window behavior, update it to mention infinite scroll + live pill. If it says nothing about paging, no change is needed.

---

## Self-Review Notes

- **Spec coverage:** summary projection + lazy fetch (Tasks 1–3); `before` keyset cursor (Task 1); `since` keyset fix (Task 1); single-entry fetch + detail route (Tasks 1, 3); two-mode polling + "N new ↑" pill (Tasks 4–5); infinite-scroll sentinel + end-of-list floor (Tasks 4–5); ~500 DOM cap + hint (Tasks 4–5); tail cap ~100 (Task 4); filter-change refetch resets to tail (Task 5); testing across store/pure-module/UI (all tasks). Out-of-scope items (numbered pages, virtualization, TTL changes) are not implemented, as intended.
- **Placeholder scan:** none — every code and test block is complete.
- **Type consistency:** `LogSummary` (lib) → `toLogSummaryView` → `LogSummaryView` (view) used consistently across store, API, `LogRow`, `LogsView`, and `list-state`; `getLogEntry` → detail route → `initialDetail: LogEntryView` consistent; `list-state` export names match their call sites in `LogsView`.
