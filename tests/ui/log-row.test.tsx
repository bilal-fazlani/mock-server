import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LogRow } from '../../src/app/ui/logs/LogRow'
import type { LogEntryView } from '../../src/app/ui/logs/types'

function entry(overrides: Partial<LogEntryView> = {}): LogEntryView {
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
    request: { headers: { 'content-type': 'application/json' }, body: { orderId: 'evt-1' }, truncated: false },
    response: { status: 200, headers: {}, body: { ok: true }, truncated: false },
    outcome: 'fixture',
    trace: {
      profileResolution: { selector: '$.accountID', value: 'customer-123', via: 'direct' },
      scenario: 'failure',
      scenarioSource: 'sequence',
      sequence: { step: 2, of: 3, served: 2 },
      placeholders: { '{{$.customerId}}': 'c1' },
    },
    ...overrides,
  }
}

function countOccurrences(text: string, pattern: string): number {
  return text.split(pattern).length - 1
}

describe('LogRow', () => {
  it('renders the collapsed summary line', () => {
    const html = renderToStaticMarkup(
      <LogRow
        entry={entry()}
        systemLabels={{ 'hello-system': 'Hello System' }}
        scenarioLabels={{
          'hello-system/hello_world/failure': 'Failure',
        }}
      />,
    )
    expect(html).toContain('POST')
    expect(html).toContain('Hello System')
    expect(html).toContain('href="/ui/catalog/hello-system/hello_world"')
    expect(html).toContain('/request-transfer-assessment')
    expect(html).toContain('customer-123')
    expect(html).toContain('Failure')
    expect(html).not.toContain('>failure<')
    expect(html).toContain('200')
    expect(html).not.toContain('12 ms')
  })

  it('falls back to the scenario slug when no label is available', () => {
    const html = renderToStaticMarkup(<LogRow entry={entry()} />)
    expect(html).toContain('failure')
  })

  it('falls back to the system slug when no label is available', () => {
    const html = renderToStaticMarkup(<LogRow entry={entry()} />)
    expect(html).toContain('hello-system')
    expect(html).toContain('href="/ui/catalog/hello-system/hello_world"')
  })

  it('marks error entries with the error code', () => {
    const html = renderToStaticMarkup(
      <LogRow
        entry={entry({
          outcome: 'error',
          error: { code: 'mapping_not_found', message: 'no mapping' },
          response: { status: 404, headers: {}, body: {}, truncated: false },
          trace: {},
          profileId: undefined,
        })}
      />,
    )
    expect(html).toContain('mapping_not_found')
    expect(html).toContain('404')
  })

  it('renders admin entries with their action', () => {
    const html = renderToStaticMarkup(
      <LogRow
        entry={entry({
          kind: 'admin',
          method: undefined,
          path: undefined,
          outcome: undefined,
          request: undefined,
          response: undefined,
          trace: { adminAction: 'progress_reset', adminEndpoint: 'hello_world' },
        })}
      />,
    )
    expect(html).toContain('admin')
    expect(html).toContain('progress_reset')
  })

  it('shows the decision trace and payloads when expanded', () => {
    const full = entry()
    const html = renderToStaticMarkup(
      <LogRow
        entry={full}
        scenarioLabels={{
          'hello-system/hello_world/failure': 'Failure',
        }}
        defaultExpanded
        initialDetail={full}
      />,
    )
    expect(html).toContain('$.accountID')
    expect(html).toContain('Failure')
    expect(countOccurrences(html, 'Failure')).toBe(1)
    expect(html).toContain('Sequence')
    expect(html).toContain('This profile uses a scenario sequence; this request served the shown step.')
    expect(html).not.toContain('>sequence<')
    expect(html).not.toContain('<dt>source</dt>')
    // profile-id row shares space with the source explainer on the same line
    expect(html).toContain('flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2')
    expect(html).toContain('ml-auto max-w-[min(440px,100%)] items-end text-right')
    expect(html).toContain('text-[0.75rem] font-medium leading-[1.35] text-muted-foreground')
    expect(html).not.toContain('role="tooltip"')
    expect(html).toContain('2/3')
    expect(html).not.toContain('<dt>duration</dt>')
    expect(html).toContain('font-mono text-[0.72rem] font-[650] normal-case tracking-normal text-secondary-foreground')
    expect(html).toContain('12 ms')
    expect(html).not.toContain('<dt>placeholders</dt>')
    expect(html).not.toContain('{{$.customerId}}')
    expect(html).toContain('evt-1')
    expect(html).toContain('Copy as cURL')
    expect(html).toContain('lg_abc123')
  })

  it('renders direct profile resolution under Profile ID as a selector to profile pill flow', () => {
    const full = entry()
    const direct = renderToStaticMarkup(
      <LogRow entry={full} defaultExpanded initialDetail={full} />,
    )
    expect(direct).toMatch(/<dt[^>]*>profile id<\/dt>/)
    expect(direct).toContain(
      'rounded-full border border-border bg-card px-2.5 py-[3px] font-mono text-[0.78rem] font-bold text-foreground',
    )
    expect(direct).toContain('font-[750] text-muted-foreground')
    expect(direct).toContain('inline-flex max-w-full items-center overflow-hidden rounded-full border border-border')
    expect(direct).toContain('>$.accountID</code>')
    expect(direct).toContain('bg-[rgba(96,165,250,0.14)] text-[#93c5fd]')
    expect(direct).toContain('lucide-user-round')
    expect(direct).toContain('border-r-0 [overflow-wrap:anywhere] bg-card text-foreground">customer-123</code>')
    const profileIdRow = direct.match(/<dt[^>]*>profile id<\/dt><dd[^>]*>(.*?)<\/dd>/)?.[1] ?? ''
    expect(profileIdRow).not.toContain('rounded-full border border-[rgba(96,165,250,0.4)] bg-[rgba(96,165,250,0.14)]')
    expect(profileIdRow).not.toContain('bg-[var(--warning-bg)] text-[var(--warning-text)]')
  })

  it('renders path profile selectors as dual selector pills', () => {
    const full = entry({
      profileId: '00171001',
      trace: {
        profileResolution: { selector: 'path:accountId', value: '00171001', via: 'direct' },
        scenario: 'default',
        scenarioSource: 'implicit',
      },
    })
    const html = renderToStaticMarkup(
      <LogRow entry={full} defaultExpanded initialDetail={full} />,
    )
    expect(html).toMatch(/<dt[^>]*>profile id<\/dt>/)
    expect(html).toContain('inline-flex max-w-full items-center overflow-hidden rounded-full border border-border bg-card')
    expect(html).toContain('bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent-strong)]')
    expect(html).toContain('>path</code>')
    expect(html).toContain('bg-card text-foreground">accountId</code>')
    expect(html).toContain('>accountId</code>')
    expect(html).toContain('font-[750] text-muted-foreground')
    expect(html).toContain('>00171001</code>')
    expect(html).not.toContain('>path:accountId</code>')
  })

  it('renders bearer profile selectors as segmented pills', () => {
    const opaqueEntry = entry({
      trace: {
        profileResolution: { selector: 'bearer', value: 'customer-123', via: 'direct' },
        scenario: 'default',
        scenarioSource: 'implicit',
      },
    })
    const opaque = renderToStaticMarkup(
      <LogRow entry={opaqueEntry} defaultExpanded initialDetail={opaqueEntry} />,
    )
    const claimEntry = entry({
      trace: {
        profileResolution: {
          selector: 'bearer:sub',
          value: 'customer-123',
          via: 'direct',
        },
        scenario: 'default',
        scenarioSource: 'implicit',
      },
    })
    const claim = renderToStaticMarkup(
      <LogRow entry={claimEntry} defaultExpanded initialDetail={claimEntry} />,
    )

    expect(opaque).toContain('>bearer</code>')
    expect(opaque).not.toContain('>bearer:</code>')
    expect(claim).toContain('>bearer</code>')
    expect(claim).toContain('>sub</code>')
  })

  it('renders mapped profile resolution under Profile ID', () => {
    const full = entry({
      trace: {
        profileResolution: {
          selector: 'profileKey:order-id:$.orderId',
          value: 'evt-91',
          via: { namespace: 'order-id', key: 'evt-91' },
        },
        scenario: 'default',
        scenarioSource: 'implicit',
      },
    })
    const mapped = renderToStaticMarkup(
      <LogRow entry={full} defaultExpanded initialDetail={full} />,
    )
    expect(mapped).toMatch(/<dt[^>]*>profile id<\/dt>/)
    expect(mapped).toContain('bg-[var(--accent-tint)] text-[var(--accent-strong)]')
    expect(mapped).toContain('bg-[var(--warning-bg)] text-[var(--warning-text)]')
    expect(mapped).toContain('>$.orderId<')
    expect(mapped).toContain('evt-91')
    expect(mapped).toContain('rounded-full border border-[rgba(96,165,250,0.4)] bg-[rgba(96,165,250,0.14)]')
    expect(mapped).toContain('customer-123')
  })

  it('renders friendly source labels for every scenario source', () => {
    const sources: Array<{
      source: NonNullable<LogEntryView['trace']['scenarioSource']>
      label: string
      tooltip: string
    }> = [
      {
        source: 'pin',
        label: 'Profile pick',
        tooltip: 'This profile explicitly selects this scenario for the endpoint.',
      },
      {
        source: 'sequence',
        label: 'Sequence',
        tooltip: 'This profile uses a scenario sequence; this request served the shown step.',
      },
      {
        source: 'implicit',
        label: 'Default fallback',
        tooltip: 'No choice was set, so the runtime used the implicit scenario.',
      },
      {
        source: 'global',
        label: 'Global mock',
        tooltip: 'A global mock setting selected this scenario for the endpoint.',
      },
      {
        source: 'unmocked_policy',
        label: 'Unmocked user policy',
        tooltip: 'The profile was not found, so UNMOCKED_USERS chose this scenario.',
      },
    ]

    for (const { source, label, tooltip } of sources) {
      const full = entry({
        trace: { scenario: 'default', scenarioSource: source },
      })
      const html = renderToStaticMarkup(
        <LogRow entry={full} defaultExpanded initialDetail={full} />,
      )
      expect(html).toContain(label)
      expect(html).toContain(tooltip)
      expect(html).toContain('text-[0.8rem] font-bold text-secondary-foreground')
      expect(html).toContain('text-[0.75rem] font-medium leading-[1.35] text-muted-foreground')
      expect(html).not.toContain('<dt>source</dt>')
      // no profile-resolution row present, so the source explainer spans the full width alone
      expect(html).toContain('col-span-full flex min-w-0 flex-wrap items-center justify-end gap-1.5')
      expect(html).not.toContain('sourceChip')
      expect(html).not.toContain('sourceHelp')
      expect(html).not.toContain('sourceHelpIcon')
      expect(html).not.toContain('sourcePopover')
      expect(html).not.toContain('role="tooltip"')
      expect(html).not.toContain(`title="${tooltip}"`)
      expect(html).not.toContain(`>${source}<`)
    }
  })

  it('renders captured profile keys as selector to segmented key/value flows', () => {
    const full = entry({
      trace: {
        profileResolution: { selector: '$.accountID', value: 'customer-123', via: 'direct' },
        scenario: 'default',
        scenarioSource: 'implicit',
        captures: [{ namespace: 'order-id', key: '<orderId>' }],
      },
    })
    const html = renderToStaticMarkup(
      <LogRow
        entry={full}
        captureSelectorLabels={{
          'hello-system/hello_world/order-id': '$.orderId',
        }}
        defaultExpanded
        initialDetail={full}
      />,
    )
    expect(html).toContain('captured')
    expect(html).toContain('>$.orderId</code>')
    expect(html).toContain('font-[750] text-muted-foreground')
    expect(html).toContain('inline-flex max-w-full items-center overflow-hidden rounded-full border border-border')
    expect(html).toContain('bg-[var(--warning-bg)] text-[var(--warning-text)]')
    expect(html).toContain('>order-id</code>')
    expect(html).toContain('bg-card text-foreground">&lt;orderId&gt;</code>')
    expect(html).not.toContain('order-id:&lt;orderId&gt;')
  })

  it('renders passthrough timing with total and upstream duration in the body', () => {
    const full = entry({
      durationMs: 52,
      trace: {
        scenario: 'real',
        scenarioSource: 'unmocked_policy',
        upstream: { url: 'https://upstream.example/path', status: 200, durationMs: 48 },
      },
    })
    const html = renderToStaticMarkup(
      <LogRow entry={full} defaultExpanded initialDetail={full} />,
    )
    expect(html).not.toContain('>52 ms</span></button>')
    expect(html).not.toContain('<dt>timing</dt>')
    expect(html).toContain('font-mono text-[0.72rem] font-[650] normal-case tracking-normal text-secondary-foreground')
    expect(html).toContain('total 52 ms')
    expect(html).toContain('upstream 48 ms')
  })

  it('renders upstream as metadata with the base URL only', () => {
    const full = entry({
      response: { status: 401, headers: {}, body: {}, truncated: false },
      trace: {
        scenario: 'real',
        scenarioSource: 'unmocked_policy',
        upstream: {
          url: 'https://upstream.example/v1/members/customer-123/accounts?expand=true',
          status: 401,
          durationMs: 48,
        },
      },
    })
    const html = renderToStaticMarkup(
      <LogRow entry={full} defaultExpanded initialDetail={full} />,
    )

    expect(html).toMatch(/<dt[^>]*>upstream<\/dt>/)
    expect(html).toContain('inline-flex max-w-full items-center overflow-hidden rounded-full border border-border min-w-0 bg-card')
    expect(html).toContain('bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent-strong)]')
    expect(html).toContain('lucide-server')
    expect(html).toContain('https://upstream.example')
    expect(html).not.toContain('https://upstream.example/v1/members/customer-123/accounts')
    expect(html).not.toContain('→ 401')
  })

  it('flags truncated payloads', () => {
    const full = entry({
      request: { headers: {}, body: 'xxxx', truncated: true },
    })
    const html = renderToStaticMarkup(
      <LogRow entry={full} defaultExpanded initialDetail={full} />,
    )
    expect(html).toContain('truncated')
  })

  it('shows a loading state when expanded without a seeded detail', () => {
    const html = renderToStaticMarkup(<LogRow entry={entry()} defaultExpanded />)
    expect(html).toContain('px-3.5 py-2.5 text-xs text-muted-foreground')
    expect(html).toContain('Loading…')
    expect(html).not.toContain('Copy as cURL')
  })
})
