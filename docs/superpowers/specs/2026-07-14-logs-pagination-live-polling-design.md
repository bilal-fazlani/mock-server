# Logs pagination + live polling

**Date:** 2026-07-14
**Status:** Design approved, ready for planning

## Problem

The request-logs page can break under load when the collection grows large. Two costs drive
this, both about *boundedness* rather than deep history browsing:

- **Payload size.** The list ships the entire `LogEntry` per row. `toLogEntryView`
  (`src/app/ui/logs/types.ts:6`) returns the full entry — request headers+body, response
  headers+body, and trace — for every row. At the current cap of 200 rows, each SSR render and
  each filter refetch moves a large JSON blob.
- **DOM cost.** The client holds and renders up to 200 rich rows (`MAX_ENTRIES = 200` in
  `src/app/ui/logs/LogsView.tsx:11`), each with expandable headers, body, and trace. Rendering
  hundreds of these is heavy.

Reads themselves are already bounded and indexed: `listLogEntries`
(`src/lib/logs/store.ts:70`) limits to ≤ 200, sorts on indexed fields, and the `requestLogs`
collection has a 24h TTL plus compound indexes on `ts`, `profileId+ts`, and `endpoint+ts`
(`src/lib/profiles/store.ts:104`). So the query won't fall over — the payload weight and the
DOM are what bite.

The design tension the user raised: **a live tail and pagination pull in opposite directions.**
Live polling prepends new rows at the top; pagination walks backwards into history. When a user
is looking at older logs, new rows must not shove the viewport around.

## Solution overview

Pagination here means **"fetch less, render less, on demand"**, and the live-polling behavior
falls out of it. Three moves:

1. **Ship summaries, fetch payloads lazily.** The list carries a lightweight summary per row
   (enough to render the collapsed row); the heavy request/response payloads are fetched only
   when a row is expanded.
2. **Infinite scroll into history via a keyset cursor.** An IntersectionObserver sentinel loads
   older entries in pages as the user scrolls down, bounded by a hard DOM cap.
3. **Two modes for live polling.** *Tail mode* (pinned at top) prepends fresh entries as today.
   *Browse mode* (scrolled down) buffers fresh entries into a "N new ↑" pill instead of
   injecting them, so scroll position never jumps.

### The summary / payload seam

The collapsed row (`rowSummary` in `src/app/ui/logs/LogRow.tsx:37`) needs only small fields:
ts, kind, admin action, system/endpoint, method, path, query, scenario chip, error code,
response **status**, and profile. The heavy fields — full request headers+body, full response
headers+body, and the Copy-as-cURL action — live only in `LogDetail`, which renders on expand.

That is a clean seam: the list ships everything **except** the request payload and the response
headers/body; the full entry is fetched when a row opens.

## Data layer — `src/lib/logs/store.ts`

**Summary projection.** Add a summary read (a `summary: true` option on `listLogEntries`, or a
sibling `listLogSummaries`) that projects out the heavy fields:

```
{ request: 0, 'response.headers': 0, 'response.body': 0, 'response.truncated': 0 }
```

This keeps `response.status` and the full (bodyless) `trace`, so the collapsed row and most of
the expanded trace-meta render without a second fetch — only the request/response payload blocks
and cURL need the lazy fetch. All-exclusion projection (nested exclusions are legal alongside
`_id: 0`).

**`before` keyset cursor.** Symmetric to the existing `sinceId`. Fetch entries strictly *older*
than a given log, matching the `{ ts: -1, logId: -1 }` sort order:

```
ts < cursor.ts OR (ts == cursor.ts AND logId < cursor.logId)
```

Look up the cursor entry's `ts` by `logId` (as `sinceId` already does), then apply the `$or`.
An unknown/expired cursor yields no older results (end of list).

**Fix `sinceId` to a real keyset.** Today it is `ts: { $gt: since.ts }` (`store.ts:83`).
Entries sharing the newest entry's millisecond are silently skipped — a latent live-tail gap.
Apply the symmetric keyset: `ts > since.ts OR (ts == since.ts AND logId > since.logId)`. The
client already dedupes by `logId`, so this only ever *adds* correctness.

**Single-entry fetch.** `getLogEntry(db, logId)` returns the full entry (with payloads) for lazy
row expansion. Returns `null` if not found (e.g. TTL-expired between list and expand).

## API

**List route** (`src/app/ui/api/logs/route.ts`) returns **summaries** and accepts `before=<logId>`
alongside the existing `since`, `profile`, `endpoint`, `errorsOnly`, `logId`, and `limit`. The
SSR loader in `src/app/ui/logs/page.tsx` switches to the summary read as well.

**New detail route** `GET /ui/api/logs/[logId]` returns the full entry (request + response
payloads). Called once when a row expands; the result is cached in the row so re-expanding is
free. A 404 renders a small "entry no longer available" state (TTL boundary).

**Types.** Add a `LogSummaryView` (the `LogEntryView` shape minus `request`, and with `response`
reduced to `{ status }`) and a `toLogSummaryView` mapper. `LogEntryView` / `toLogEntryView`
stay as the full shape used by the detail route and `LogDetail`.

## Client — `LogsView` + `LogRow`

Two modes, driven by scroll position (top ⇒ tail, scrolled down ⇒ browse):

**Tail mode** (scrolled to top): unchanged behavior — poll `since=newest`, prepend fresh
summaries, dedupe by `logId`, trim to a **tail cap (~100 rows)**.

**Browse mode** (scrolled down / after loading older): the poll keeps running but **buffers**
fresh entries into a bounded pending buffer instead of injecting them. A **"N new ↑"** pill shows
the count. Clicking it (or scrolling back to the top) scrolls to top, flushes the buffer to the
front, **drops the loaded-older rows**, clears the buffer, and returns to tail mode. Scroll
position never jumps under the user — this is the answer to "how does live polling work with
pagination."

**Infinite scroll into history**: an IntersectionObserver sentinel sits just below the last row.
When it enters view, fetch ~50 older via `before=<oldestLogId>` and append (deduped). The
observer is gated while a fetch is in flight (no double-fire) and re-armed on success. When a
fetch returns **fewer than requested**, stop observing and render a quiet "beginning of logs"
marker — that is the TTL/collection floor.

**Bounded DOM (the auto-load stop).** Total rendered rows are capped at **~500 lightweight
summaries**. On reaching the cap, disconnect the observer and show a "showing latest 500 —
narrow your filters to see older" hint. Scrolling still works; it just stops fetching. Because
the tail is bounded and history-loading is bounded, the page cannot grow without limit — this is
what makes "infinite" scroll safe against the load concern.

**Filter changes** still do a full refetch (as today), resetting to tail mode and the newest
summary page.

**`LogRow`**: on first expand, fetch the full entry from the detail route, showing a small
loading state, then render `LogDetail` exactly as today. Cache the fetched entry on the row so
subsequent expand/collapse is instant. The collapsed row renders entirely from the summary, so
no fetch happens until the user opens a row.

### Mode / state summary

| Trigger | Tail mode | Browse mode |
|---|---|---|
| Poll returns fresh entries | prepend, trim to ~100 | buffer, bump "N new" pill |
| Sentinel enters view | n/a (at top) | fetch `before`, append, dedupe |
| Fetch returns < requested | — | stop observing, show floor marker |
| Rendered rows reach ~500 | — | disconnect observer, show cap hint |
| Click "N new ↑" / scroll to top | stays tail | flush buffer, drop older rows, → tail |
| Filter change | full refetch → tail | full refetch → tail |

## Testing

**Store** (`tests/logs/store.test.ts`): `before` cursor returns strictly-older entries in order,
including the same-millisecond tiebreak; `sinceId` keyset fix no longer skips same-ms entries;
summary projection omits payload fields but keeps `response.status` and `trace`; `getLogEntry`
returns the full entry and `null` when absent.

**API**: list route returns summaries and honors `before`; detail route returns the full entry
and 404s for unknown/expired `logId`.

**UI** (`tests/ui/logs-view.test.tsx`, `tests/ui/log-row.test.tsx`): tail-mode prepend/trim;
browse-mode buffering + "N new ↑" pill and flush-on-click; sentinel load-older append + dedupe;
end-of-list floor marker when a short page returns; DOM cap disables further loading; row lazy
expand fetches the detail route once and caches it.

## Out of scope

- Numbered / prev-next pages (rejected in favor of infinite scroll for a continuous feed).
- DOM virtualization (a ~500-row cap of lightweight summaries is manageable; the 24h TTL and
  dev-tool audience don't justify the machinery).
- Server-side change to the TTL, retention, or log-write path.
