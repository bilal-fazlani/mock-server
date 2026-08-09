import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecentActivity } from '../../src/app/ui/profiles/RecentActivity'
import type { LogSummaryView } from '../../src/app/ui/logs/types'

// Exactly what `GET /ui/api/logs` returns without `include=full`, and what the
// profile page now renders from: no `request`, response reduced to `{ status }`.
function summary(overrides: Partial<LogSummaryView> = {}): LogSummaryView {
  return {
    logId: 'lg_abc123',
    ts: '2026-07-07T09:14:03.120Z',
    durationMs: 12,
    kind: 'request',
    profileId: 'customer-123',
    system: 'hello-system',
    endpoint: 'hello_world',
    method: 'POST',
    path: '/request-transfer-assessment',
    query: '',
    response: { status: 200 },
    outcome: 'fixture',
    trace: { scenario: 'failure', scenarioSource: 'sequence' },
    ...overrides,
  } as LogSummaryView
}

describe('RecentActivity', () => {
  it('renders rows from summary-shaped entries, with no payload fields present', () => {
    const html = renderToStaticMarkup(
      <RecentActivity
        profileId="customer-123"
        initialEntries={[summary(), summary({ logId: 'lg_def456', response: { status: 500 } })]}
        systemLabels={{ 'hello-system': 'Hello System' }}
        scenarioLabels={{ 'hello-system/hello_world/failure': 'Failure' }}
      />,
    )
    expect(html.split('<article').length - 1).toBe(2)
    expect(html).toContain('>200<')
    expect(html).toContain('>500<')
    expect(html).toContain('/request-transfer-assessment')
    expect(html).toContain('Hello System')
    expect(html).toContain('Failure')
  })

  it('links to the profile-filtered logs page and labels the timezone', () => {
    const html = renderToStaticMarkup(
      <RecentActivity profileId="customer 123" initialEntries={[summary()]} />,
    )
    expect(html).toContain('/ui/logs?profile=customer%20123')
    expect(html).toContain('data-logs-timezone')
    expect(html).toContain('Times in UTC')
  })

  it('shows the empty state when the profile has no logged requests', () => {
    const html = renderToStaticMarkup(
      <RecentActivity profileId="customer-123" initialEntries={[]} />,
    )
    expect(html).toContain('No requests logged for this profile yet')
  })
})
