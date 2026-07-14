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
