import type { Db } from 'mongodb'
import { countLogEntries, type ListLogsOptions } from './store'

/**
 * The bounded wait behind `GET /ui/api/logs`'s `minCount`/`waitMs`. A caller
 * asking "has this endpoint been called N times yet?" spends one request here
 * instead of a client-side polling loop; the `since` cursor remains the way to
 * ask the same question without holding a connection.
 */

/** Applied when `minCount` is sent without `waitMs`. */
export const DEFAULT_WAIT_MS = 10_000
/** Ceiling on `waitMs` — what stops an abandoned caller from holding a connection. */
export const MAX_WAIT_MS = 60_000
/** How often the filtered count is re-checked while waiting. */
export const POLL_INTERVAL_MS = 150

export interface LogWait {
  minCount: number
  waitMs: number
}

function parseCount(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Reads the long-poll query pair, or `undefined` when neither parameter was
 * sent and the request is an ordinary listing.
 *
 * Either parameter opts in and each defaults the other: `waitMs` alone waits
 * for a single entry (pair it with `since` to long-poll for "anything new"),
 * `minCount` alone waits the default window. Unparseable values fall back to
 * those defaults rather than failing the request — the same lenient handling
 * `errorsOnly` and `validation` get, since a bad parameter should not break a
 * caller's poll.
 */
export function parseLogWait(minCountRaw: string | null, waitMsRaw: string | null): LogWait | undefined {
  if (!minCountRaw && !waitMsRaw) return undefined
  return {
    minCount: Math.max(parseCount(minCountRaw, 1), 1),
    waitMs: Math.min(Math.max(parseCount(waitMsRaw, DEFAULT_WAIT_MS), 0), MAX_WAIT_MS),
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    // Either path tears down the other, so an aborted wait leaves no pending
    // timer and a completed one leaves no listener on a long-lived signal.
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Polls the filtered count until it reaches `minCount` or the window runs out,
 * answering whether the threshold was met. That answer is what the response
 * reports as `matched`: `entries.length` cannot carry it, because the page is
 * capped by `limit` while the threshold is not.
 *
 * The first check happens before any sleep, so an already-satisfied request
 * returns with no added latency and `waitMs=0` degrades to a plain count.
 */
export async function awaitLogCount(
  db: Db,
  options: ListLogsOptions,
  wait: LogWait,
  signal?: AbortSignal,
): Promise<boolean> {
  // A `before` page reaches backwards from a cursor, so its match count can
  // never grow — waiting on one would only ever burn the whole window.
  const deadline = Date.now() + (options.beforeId ? 0 : wait.waitMs)
  for (;;) {
    if ((await countLogEntries(db, options, wait.minCount)) >= wait.minCount) return true
    const remaining = deadline - Date.now()
    // A disconnected client is not owed the rest of its wait: stop querying.
    if (remaining <= 0 || signal?.aborted) return false
    await sleep(Math.min(POLL_INTERVAL_MS, remaining), signal)
  }
}
