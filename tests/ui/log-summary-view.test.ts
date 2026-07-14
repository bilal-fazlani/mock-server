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
