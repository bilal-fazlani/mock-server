import { describe, expect, it } from 'vitest'
import {
  appendOlder,
  atTop,
  bufferPending,
  DOM_CAP,
  flushToTail,
  mergeTail,
  PENDING_CAP,
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

  it('bufferPending caps the buffer at PENDING_CAP, keeping newest', () => {
    const fresh = rows(...Array.from({ length: PENDING_CAP + 30 }, (_, i) => `f${i}`))
    const pending = bufferPending([], fresh, new Set<string>())
    expect(pending).toHaveLength(PENDING_CAP)
    expect(pending[0].logId).toBe('f0')
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
