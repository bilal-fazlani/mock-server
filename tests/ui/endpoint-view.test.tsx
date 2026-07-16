import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Catalog, EndpointDef, SystemDef } from '../../src/lib/catalog/types'
import type { ScenarioView } from '../../src/app/ui/catalog/scenario-view'
import { EndpointView } from '../../src/app/ui/catalog/EndpointView'

const system: SystemDef = {
  name: 'Hello System',
  slug: 'hello-system',
  baseUrlEnv: 'HELLO_SYSTEM_URL',
  endpoints: [],
}

const endpoint: EndpointDef = {
  name: 'hello_world',
  displayName: 'Hello World',
  method: 'POST',
  path: '/hello/world',
  profileIdSelector: '$.customerId',
  scenarios: { default: 'Hello success' },
  resolverScenarios: [],
}

const fixtureJson = JSON.stringify(
  {
    description: 'Accept Policy',
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
    body: {
      'transaction-results': {
        'recommendation-code': 'ACCEPT_POLICY',
        'total-score': 0,
        'rules-tripped': '',
      },
    },
  },
  null,
  2,
)

function fixtureJsonWithStatus(status: number): string {
  return JSON.stringify(
    {
      description: `Status ${status}`,
      status,
      headers: {},
      body: { ok: true },
    },
    null,
    2,
  )
}

// Stand-in for the real shiki output (tested against the real highlighter in
// scenario-view.test.ts) — just needs to be identifiable in the rendered markup.
function fixtureHtml(marker: string): string {
  return `<pre class="shiki shiki-themes github-light github-dark"><code>${marker}</code></pre>`
}

const scenarios: ScenarioView[] = [
  {
    key: 'accept_policy',
    label: 'Accept Policy',
    isDefault: true,
    kind: 'fixture',
    json: fixtureJson,
    html: fixtureHtml('accept-policy-body'),
  },
  { key: 'real', label: 'Passthrough', isDefault: false, kind: 'passthrough', baseUrlEnv: 'HELLO_SYSTEM_URL', url: 'http://upstream.test' },
]

function view({
  endpoint: ep = endpoint,
  scenarios: sc = scenarios,
  baseUrl = 'http://upstream.test' as string | null,
  showBaseUrl = true,
  catalog,
}: {
  endpoint?: EndpointDef
  scenarios?: ScenarioView[]
  baseUrl?: string | null
  showBaseUrl?: boolean
  catalog?: Catalog
} = {}): string {
  const cat: Catalog = catalog ?? { systems: [{ ...system, endpoints: [ep] }] }
  return renderToStaticMarkup(
    <EndpointView
      system={system}
      endpoint={ep}
      scenarios={sc}
      baseUrl={baseUrl}
      showBaseUrl={showBaseUrl}
      catalog={cat}
    />,
  )
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

describe('EndpointView', () => {
  it('renders configuration fields with visible row labels', () => {
    const html = view()
    expect(html).toContain('$.customerId')
    expect(html).toContain('/hello/world')
    expect(visibleText(html)).not.toContain('Configuration')
    expect(html).not.toContain('<dt>System</dt>')
    expect(html).toContain('aria-label="Endpoint configuration"')
    expect(html).toContain('grid-cols-[22px_82px_minmax(0,1fr)]')
    expect(html).toContain('lucide-server')
    expect(html).toContain('title="System"')
    expect(html).toContain('lucide-user-round')
    expect(html).toContain('title="Profile ID selector"')
    expect(html).toContain('cursor-help')
    expect(visibleText(html)).toContain('system')
    expect(visibleText(html)).toContain('profile')
  })

  it('renders profile key captures for data-collection endpoints', () => {
    const collectingEndpoint: EndpointDef = {
      ...endpoint,
      profileIdSelector: '$.customer.customerId',
      captureProfileKeys: [{ namespace: 'order-id', keySelector: '$.orderId' }],
    }
    const html = view({ endpoint: collectingEndpoint })

    expect(html).toContain('lucide-save')
    expect(html).toContain('text-[#93c5fd]')
    expect(html).toContain('aria-label="Captures profile keys"')
    expect(html).toContain('title="Stores each key')
    expect(html).not.toContain('Maps Profile ID to')
    // profileKey / namespace segments of the capture flow
    expect(html).toContain('bg-[var(--accent-tint)] text-[var(--accent-strong)]')
    expect(html).toContain('bg-[var(--warning-bg)] text-[var(--warning-text)] cursor-help underline decoration-dotted')
    expect(html).toContain('aria-hidden="true">→</span>')
    expect(visibleText(html)).toContain('captures')
    expect(visibleText(html)).toContain('$.orderId → profileKey order-id')
    expect(visibleText(html)).not.toContain('$.orderId as order-id')
  })

  it('stacks multiple captures as one flow per line', () => {
    const collectingEndpoint: EndpointDef = {
      ...endpoint,
      profileIdSelector: '$.customer.customerId',
      captureProfileKeys: [
        { namespace: 'order-id', keySelector: '$.orderId' },
        { namespace: 'shipment-id', keySelector: '$.shipmentId' },
      ],
    }
    const html = view({ endpoint: collectingEndpoint })

    // Multi-capture rows switch to the "top-aligned" row variant...
    expect(html).toContain('grid-cols-[22px_82px_minmax(0,1fr)] gap-2.5 items-start')
    // ...and stack each capture's selector-to-namespace flow as its own line.
    expect(html).toContain('flex flex-col items-start gap-1.5')
    expect(html.match(/text-secondary-foreground text-\[0\.85rem\] leading-\[1\.45\]/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('renders key-resolved profile selectors as a flow ending in a profile', () => {
    const mappedEndpoint: EndpointDef = {
      ...endpoint,
      profileIdSelector: 'profileKey:event-id:$.eventID',
    }
    const html = view({ endpoint: mappedEndpoint })
    const text = visibleText(html)

    expect(html).toContain('bg-[var(--accent-tint)] text-[var(--accent-strong)]')
    expect(html).toContain('bg-[var(--warning-bg)] text-[var(--warning-text)] cursor-help underline decoration-dotted')
    expect(html).toContain(
      'rounded-full border border-[rgba(96,165,250,0.4)] bg-[rgba(96,165,250,0.14)] px-2.5 py-1 font-mono text-[0.85rem] font-bold leading-[1.15] text-[#93c5fd]',
    )
    expect(html).toContain('text-muted-foreground text-[0.78rem]')
    expect(html).toContain('title="Profile resolved via a previously captured key"')
    expect(text).toContain('profile via')
    expect(text).toContain('$.eventID → profileKey event-id')
    expect(text).toContain('→ profile')
    expect(text).toContain('Needs a mapping captured by an earlier call')
  })

  it('cross-references namespace usage in a hoverable popover', () => {
    const capturer: EndpointDef = {
      ...endpoint,
      name: 'capture_ep',
      displayName: 'Capture Endpoint',
      profileIdSelector: '$.accountId',
      captureProfileKeys: [{ namespace: 'event-id', keySelector: '$.eventID' }],
    }
    const resolver: EndpointDef = {
      ...endpoint,
      name: 'resolve_ep',
      displayName: 'Resolve Endpoint',
      profileIdSelector: 'profileKey:event-id:$.eventID',
    }
    const catalog: Catalog = { systems: [{ ...system, endpoints: [capturer, resolver] }] }
    const html = view({ endpoint: resolver, catalog })
    const text = visibleText(html)

    expect(html).toContain('role="tooltip"')
    expect(html).toContain('group-hover:block group-focus-within:block')
    expect(text).toContain('Correlation key event-id')
    expect(text).toContain('Captured by')
    expect(text).toContain('Capture Endpoint')
    expect(html).toContain('/ui/catalog/hello-system/capture_ep')
    expect(text).toContain('Resolves profile for')
    expect(text).toContain('this endpoint')
    expect(html).not.toContain(`href="/ui/catalog/hello-system/resolve_ep"`)
  })

  it('segments path and query profile selectors but keeps body selectors neutral', () => {
    const pathEndpoint: EndpointDef = {
      ...endpoint,
      profileIdSelector: 'path:accountId',
    }
    const queryEndpoint: EndpointDef = {
      ...endpoint,
      profileIdSelector: 'query:customerId',
    }
    const pathHtml = view({ endpoint: pathEndpoint })
    const queryHtml = view({ endpoint: queryEndpoint })
    const bodyHtml = view()

    expect(pathHtml).toContain('bg-[rgba(96,165,250,0.14)] text-[#93c5fd]">path</code>')
    expect(pathHtml).toContain('bg-card text-foreground font-bold">accountId</code>')
    expect(visibleText(pathHtml)).toContain('path accountId')
    expect(queryHtml).toContain('bg-[rgba(96,165,250,0.14)] text-[#93c5fd]">query</code>')
    expect(queryHtml).toContain('bg-card text-foreground font-bold">customerId</code>')
    expect(visibleText(queryHtml)).toContain('query customerId')
    expect(bodyHtml).toContain(
      'rounded-full border border-border bg-card px-2.5 py-1 text-foreground font-bold leading-[1.15]">$.customerId</code>',
    )
    expect(bodyHtml).not.toContain('>path</code>')
    expect(bodyHtml).not.toContain('>query</code>')
    expect(visibleText(bodyHtml)).toContain('$.customerId')
  })

  it('segments opaque and JWT-claim bearer profile selectors', () => {
    const opaqueHtml = view({ endpoint: { ...endpoint, profileIdSelector: 'bearer' } })
    const claimHtml = view({ endpoint: { ...endpoint, profileIdSelector: 'bearer:sub' } })

    expect(opaqueHtml).toContain('bg-[rgba(96,165,250,0.14)] text-[#93c5fd]">bearer</code>')
    expect(visibleText(opaqueHtml)).toContain('bearer')
    expect(claimHtml).toContain('bg-[rgba(96,165,250,0.14)] text-[#93c5fd]">bearer</code>')
    expect(claimHtml).toContain('bg-card text-foreground font-bold">sub</code>')
    expect(visibleText(claimHtml)).toContain('bearer sub')
  })

  it('shows the resolved base URL value in the config', () => {
    expect(view()).toContain('http://upstream.test')
  })

  it('shows a not-set marker in the config when the base URL env is missing', () => {
    expect(view({ baseUrl: null })).toContain('base URL not set')
  })

  it('hides the base URL from the config when showBaseUrl is false', () => {
    const html = view({ scenarios: [], showBaseUrl: false })
    expect(html).not.toContain('http://upstream.test')
    expect(html).not.toContain('not set')
  })

  it('renders fixture status and headers outside the body json', () => {
    const html = view()
    const text = visibleText(html)
    const bodyHtml = fixtureHtml('accept-policy-body')

    expect(text).toContain('HTTP 200 OK')
    expect(html).toContain('border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)] text-[var(--success)]')
    expect(html.indexOf('HTTP 200 OK')).toBeLessThan(html.indexOf(bodyHtml))
    expect(text).toContain('content-type application/json')
    expect(text).not.toContain('Headers')
    expect(text).not.toContain('content-type:')
    // header name/value render as separate dt/dd pills, not inline text
    expect(html).toContain('<dt class="min-w-0 inline-flex min-h-[28px] items-center border-r border-border bg-background')
    expect(html).toContain('<dd class="min-w-0 inline-flex min-h-[28px] items-center bg-[var(--accent-tint)]')
    expect(text).not.toContain('Status 200')
    // the server-highlighted html is injected verbatim into the wrapper div
    expect(html).toContain('overflow-x-auto rounded-sm border border-border text-[0.8rem] [&amp;_pre]:p-3')
    expect(html).toContain(bodyHtml)
  })

  it('uses status color tones by response family', () => {
    const statusScenarios: ScenarioView[] = [
      { key: 'success', label: 'Success', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(200), html: fixtureHtml('success-body') },
      { key: 'redirect', label: 'Redirect', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(302), html: fixtureHtml('redirect-body') },
      { key: 'client_error', label: 'Client error', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(404), html: fixtureHtml('client-error-body') },
      { key: 'server_error', label: 'Server error', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(500), html: fixtureHtml('server-error-body') },
    ]
    const html = view({ scenarios: statusScenarios })

    // Status tone convention: 2xx green, 3xx yellow, 4xx/5xx red.
    expect(html).toContain('HTTP 200 OK')
    expect(html).toContain('border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)] text-[var(--success)]')
    expect(html).toContain('HTTP 302 Found')
    expect(html).toContain('border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]')
    expect(html).toContain('HTTP 404 Not Found')
    expect(html).toContain('HTTP 500 Internal Server Error')
    expect(html.match(/border-\[#d92d20\] bg-\[rgba\(217,45,32,0\.12\)\] text-\[#d92d20\]/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('renders scenario cards with friendly names only', () => {
    const html = view()

    expect(visibleText(html)).toContain('Accept Policy')
    expect(visibleText(html)).toContain('Default')
    expect(visibleText(html)).not.toContain('accept_policy')
    expect(html).toContain('text-[0.95rem] font-semibold text-foreground')
    expect(html).toContain('text-[0.78rem] font-[750] text-[var(--success)]')
    expect(html).toContain('lucide-check')
    expect(html.indexOf('text-[0.95rem] font-semibold text-foreground')).toBeLessThan(
      html.indexOf('text-[0.78rem] font-[750] text-[var(--success)]'),
    )
  })

  it('does not render the implicit real passthrough scenario', () => {
    const html = view({ showBaseUrl: false })

    expect(visibleText(html)).not.toContain('real Passthrough')
    expect(visibleText(html)).not.toContain('Passthrough →')
    expect(html).not.toContain('http://upstream.test')
  })

  it('renders scenarios as collapsible cards with bulk controls', () => {
    const html = view()

    expect(html).toContain('Expand all')
    expect(html).toContain('Collapse all')
    expect(html).toContain('<article class="overflow-hidden rounded-lg border border-border bg-card')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls=')
  })

  it('keeps the configuration panel unboxed', () => {
    const html = view()
    const sectionMatch = html.match(/<section class="([^"]*)" aria-label="Endpoint configuration">/)
    const sectionClass = sectionMatch?.[1] ?? ''

    expect(sectionClass).not.toContain('border-t')
    expect(sectionClass).not.toContain('border-b')
    expect(sectionClass).not.toContain('border')
  })

  it('centers the system name and base URL in the same row', () => {
    const html = view()
    const systemNameMatch = html.match(/<span class="([^"]*)">Hello System<\/span>/)
    const baseUrlMatch = html.match(/<code class="([^"]*)">http:\/\/upstream\.test<\/code>/)

    expect(systemNameMatch?.[1]).toContain('inline-flex')
    expect(systemNameMatch?.[1]).toContain('items-center')
    expect(systemNameMatch?.[1]).toContain('min-h-[28px]')
    expect(baseUrlMatch?.[1]).toContain('inline-flex')
    expect(baseUrlMatch?.[1]).toContain('items-center')
    expect(baseUrlMatch?.[1]).toContain('min-h-[28px]')
  })

  it('uses the app accent color to tint the entire scenario card on title hover', () => {
    const html = view()

    expect(html).toContain('has-[:hover]:border-[rgba(var(--accent-rgb),0.58)]')
    expect(html).toContain('has-[:hover]:bg-[var(--accent-tint)]')
    expect(html).toContain('has-[:focus-visible]:border-[rgba(var(--accent-rgb),0.58)]')
    expect(html).toContain('has-[:focus-visible]:bg-[var(--accent-tint)]')
    // the toggle itself stays transparent so the card-level tint shows through
    expect(html).toMatch(/<button type="button" class="flex w-full items-center justify-between[^"]*bg-transparent[^"]*"/)
  })

  it('uses the success color for the default marker', () => {
    const html = view()

    expect(html).toContain('text-[0.78rem] font-[750] text-[var(--success)]')
  })

  it('renders global endpoints without a profile selector', () => {
    const globalEndpoint: EndpointDef = {
      name: 'oauth_token',
      displayName: 'OAuth Token',
      method: 'POST',
      path: '/oauth/token',
      mockType: 'global',
      scenarios: { default: 'Token' },
      resolverScenarios: [],
    }
    const html = view({ endpoint: globalEndpoint })
    expect(html).toContain('Global')
    expect(html).not.toContain('Profile ID selector')
  })

  it('does not show a schema-verified badge when the endpoint has no schema', () => {
    expect(view()).not.toContain('Schema verified')
  })

  it('shows a schema-verified badge at the top when the endpoint declares a schema', () => {
    const withSchema: EndpointDef = { ...endpoint, schema: { responses: {} } }
    const html = view({ endpoint: withSchema })
    expect(html).toContain('Schema verified')
    // "at the top": the badge appears before the configuration details
    expect(html.indexOf('Schema verified')).toBeLessThan(html.indexOf('Profile ID selector'))
  })
})
