import { readFileSync } from 'node:fs'
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

const scenarios: ScenarioView[] = [
  { key: 'accept_policy', label: 'Accept Policy', isDefault: true, kind: 'fixture', json: fixtureJson },
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

function endpointCss(): string {
  return readFileSync(new URL('../../src/app/ui/catalog/endpoint.module.css', import.meta.url), 'utf8')
}

describe('EndpointView', () => {
  it('renders configuration fields with visible row labels', () => {
    const html = view()
    expect(html).toContain('$.customerId')
    expect(html).toContain('/hello/world')
    expect(visibleText(html)).not.toContain('Configuration')
    expect(html).not.toContain('<dt>System</dt>')
    expect(html).toContain('configurationPanel')
    expect(html).toContain('configRow')
    expect(html).toContain('systemIcon')
    expect(html).toContain('title="System"')
    expect(html).toContain('profileIcon')
    expect(html).toContain('title="Profile ID selector"')
    expect(html).toContain('configValueWithIcon')
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

    expect(html).toContain('mappingValue')
    expect(html).toContain('mappingInline')
    expect(html).toContain('mappingIcon')
    expect(html).toContain('lucide-save')
    expect(html).toContain('aria-label="Captures profile keys"')
    expect(html).not.toContain('Maps Profile ID to')
    expect(html).toContain('selectorCapture')
    expect(html).toContain('selectorArrow')
    expect(html).toContain('selectorProfileKey')
    expect(html).toContain('selectorNamespace')
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
    const css = endpointCss()
    const listBlock = css.match(/\.mappingList\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(html).toContain('configRowTop')
    expect(html.match(/selectorCapture/g)!.length).toBeGreaterThanOrEqual(2)
    expect(listBlock).toContain('flex-direction: column')
  })

  it('renders key-resolved profile selectors as a flow ending in a profile', () => {
    const mappedEndpoint: EndpointDef = {
      ...endpoint,
      profileIdSelector: 'profileKey:event-id:$.eventID',
    }
    const html = view({ endpoint: mappedEndpoint })
    const text = visibleText(html)

    expect(html).toContain('selectorProfileKey')
    expect(html).toContain('selectorNamespace')
    expect(html).toContain('profileResultChip')
    expect(html).toContain('lookupHint')
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

    expect(html).toContain('namespacePopover')
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

    expect(pathHtml).toContain('selectorPath')
    expect(pathHtml).toContain('selectorValue')
    expect(visibleText(pathHtml)).toContain('path accountId')
    expect(queryHtml).toContain('selectorQuery')
    expect(queryHtml).toContain('selectorValue')
    expect(visibleText(queryHtml)).toContain('query customerId')
    expect(bodyHtml).toContain('selectorBody')
    expect(bodyHtml).not.toContain('selectorPath')
    expect(bodyHtml).not.toContain('selectorQuery')
    expect(visibleText(bodyHtml)).toContain('$.customerId')
  })

  it('segments opaque and JWT-claim bearer profile selectors', () => {
    const opaqueHtml = view({ endpoint: { ...endpoint, profileIdSelector: 'bearer' } })
    const claimHtml = view({ endpoint: { ...endpoint, profileIdSelector: 'bearer:sub' } })

    expect(opaqueHtml).toContain('selectorBearer')
    expect(visibleText(opaqueHtml)).toContain('bearer')
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

    expect(text).toContain('HTTP 200 OK')
    expect(html).toContain('scenarioHeaderStatus')
    expect(html.indexOf('HTTP 200 OK')).toBeLessThan(html.indexOf('scenarioBody'))
    expect(text).toContain('content-type application/json')
    expect(text).not.toContain('Headers')
    expect(text).not.toContain('content-type:')
    expect(html).toContain('headerKey')
    expect(html).toContain('headerValue')
    expect(text).not.toContain('Status 200')
    expect(html).toMatch(/<pre class="[^"]*fixture[^"]*">\{\n/)
    expect(html).toContain('&quot;transaction-results&quot;')
    expect(html).toContain('&quot;recommendation-code&quot;: &quot;ACCEPT_POLICY&quot;')
    expect(html).toContain('\n}</pre>')
    expect(html).not.toContain('&quot;description&quot;')
    expect(html).not.toContain('&quot;status&quot;')
    expect(html).not.toContain('&quot;headers&quot;')
    expect(html).not.toContain('&quot;body&quot;')
  })

  it('uses status color tones by response family', () => {
    const statusScenarios: ScenarioView[] = [
      { key: 'success', label: 'Success', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(200) },
      { key: 'redirect', label: 'Redirect', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(302) },
      { key: 'client_error', label: 'Client error', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(404) },
      { key: 'server_error', label: 'Server error', isDefault: false, kind: 'fixture', json: fixtureJsonWithStatus(500) },
    ]
    const html = view({ scenarios: statusScenarios })

    // Status tone convention: 2xx green, 3xx yellow, 4xx/5xx red.
    expect(html).toContain('HTTP 200 OK')
    expect(html).toContain('fixtureStatusSuccess')
    expect(html).toContain('HTTP 302 Found')
    expect(html).toContain('fixtureStatusRedirect')
    expect(html).toContain('HTTP 404 Not Found')
    expect(html).toContain('HTTP 500 Internal Server Error')
    expect(html).not.toContain('fixtureStatusWarn')
    expect(html.match(/fixtureStatusError/g)!.length).toBeGreaterThanOrEqual(2)
  })

  it('renders scenario cards with friendly names only', () => {
    const html = view()

    expect(visibleText(html)).toContain('Accept Policy')
    expect(visibleText(html)).toContain('Default')
    expect(visibleText(html)).not.toContain('accept_policy')
    expect(html).not.toContain('scenarioKey')
    expect(html).toContain('scenarioHeading')
    expect(html).toContain('defaultMarker')
    expect(html).toContain('defaultMarkerIcon')
    expect(html.indexOf('scenarioHeading')).toBeLessThan(html.indexOf('defaultMarker'))
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
    expect(html).toContain('scenarioCard')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls=')
  })

  it('keeps the configuration panel unboxed', () => {
    const css = endpointCss()
    const panelBlock = css.match(/\.configurationPanel\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(panelBlock).not.toContain('border-top')
    expect(panelBlock).not.toContain('border-bottom')
  })

  it('centers the system name and base URL in the same row', () => {
    const css = endpointCss()
    const systemNameBlock = css.match(/\.systemName\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const baseUrlBlock = css.match(/\.baseUrl\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(systemNameBlock).toContain('display: inline-flex')
    expect(systemNameBlock).toContain('align-items: center')
    expect(systemNameBlock).toContain('min-height: 28px')
    expect(baseUrlBlock).toContain('display: inline-flex')
    expect(baseUrlBlock).toContain('align-items: center')
    expect(baseUrlBlock).toContain('min-height: 28px')
  })

  it('uses the app accent color to tint the entire scenario card on title hover', () => {
    const css = endpointCss()
    const cardHoverBlock = css.match(/\.scenarioCard:has\(\.scenarioToggle:hover\)\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''
    const toggleHoverBlock = css.match(/\.scenarioToggle:hover\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(cardHoverBlock).toContain('background')
    expect(cardHoverBlock).toContain('border-color')
    expect(cardHoverBlock).toContain('var(--accent-tint)')
    expect(cardHoverBlock).toContain('var(--accent-rgb)')
    expect(toggleHoverBlock).toContain('background: transparent')
  })

  it('uses the success color for the default marker', () => {
    const css = endpointCss()
    const defaultMarkerBlock = css.match(/\.defaultMarker\s*{(?<body>[^}]*)}/)?.groups?.body ?? ''

    expect(defaultMarkerBlock).toContain('color: var(--success)')
  })

  it('renders global endpoints without a profile selector', () => {
    const globalEndpoint: EndpointDef = {
      name: 'oauth_token',
      displayName: 'OAuth Token',
      method: 'POST',
      path: '/oauth/token',
      mockType: 'global',
      scenarios: { default: 'Token' },
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
