import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LogsView } from '../../src/app/ui/logs/LogsView'
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

const options = {
  profiles: [{ profileId: 'customer-123', displayName: 'Happy path' }],
  endpoints: [
    {
      name: 'request_transfer_assessment',
      displayName: 'Request Transfer Assessment',
      method: 'POST',
      path: '/request-transfer-assessment',
    },
  ],
}

describe('LogsView filters', () => {
  it('renders a profile combobox, endpoint listbox trigger, and log id filter', () => {
    const html = renderToStaticMarkup(
      <LogsView initialEntries={[]} options={options} initialProfile="" />,
    )
    expect(html).toContain('role="combobox"')
    expect(html).toContain('placeholder="Filter by profile"')
    expect(html).toContain('aria-label="Filter by endpoint"')
    expect(html).toContain('All endpoints')
    expect(html).toContain('placeholder="Filter by log id"')
    expect(html).not.toContain('Filter by path')
  })
})

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
