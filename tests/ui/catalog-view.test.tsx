import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { CatalogView } from '../../src/app/(ui)/catalog/CatalogView'

const catalog: Catalog = {
  systems: [
    {
      displayName: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      port: 4001,
      endpoints: [
        {
          slug: 'hello_world',
          displayName: 'Hello World',
          method: 'POST',
          path: '/hello/world',
          profileIdSelector: '$.customerId',
          scenarios: { default: { displayName: 'Hello success' }, failure: { displayName: 'Hello failure' } },
          resolverScenarios: [],
        },
      ],
    },
  ],
}

const env = { HELLO_SYSTEM_URL: 'http://upstream.test' }

function currentHref(html: string): string | undefined {
  return html.match(/<a [^>]*aria-current="page"[^>]*>/)?.[0].match(/href="([^"]+)"/)?.[1]
}

describe('CatalogView', () => {
  it('renders each endpoint with method, path, and display name', () => {
    const html = renderToStaticMarkup(<CatalogView catalog={catalog} env={env} passthroughAsDefault={false} />)
    expect(html).toContain('Hello System')
    expect(html).toContain('POST')
    expect(html).toContain('/hello/world')
    expect(html).toContain('Hello World')
  })

  it('links to the endpoint detail page using the system slug', () => {
    const html = renderToStaticMarkup(<CatalogView catalog={catalog} env={env} passthroughAsDefault={false} />)
    expect(html).toContain('href="/catalog/hello-system/hello_world"')
  })

  it('shows the default scenario label and scenario count', () => {
    const html = renderToStaticMarkup(<CatalogView catalog={catalog} env={env} passthroughAsDefault={false} />)
    expect(html).toContain('Hello success')
    expect(html).toContain('2')
  })

  it('always appends "+ passthrough" to the scenario count', () => {
    const html = renderToStaticMarkup(<CatalogView catalog={catalog} env={env} passthroughAsDefault={false} />)
    expect(html).toContain('+ passthrough')
  })

  it('renders global endpoints in the catalog listing', () => {
    const withGlobal: Catalog = {
      systems: [
        {
          ...catalog.systems[0],
          endpoints: [
            ...catalog.systems[0].endpoints,
            {
              slug: 'oauth_token',
              displayName: 'OAuth Token',
              method: 'POST',
              path: '/oauth/token',
              mockType: 'global',
              scenarios: { default: { displayName: 'Token issued' } },
              resolverScenarios: [],
            },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      <CatalogView catalog={withGlobal} env={env} passthroughAsDefault={false} />,
    )
    expect(html).toContain('OAuth Token')
    expect(html).toContain('global')
  })

  it('resolves the base URL env to its value', () => {
    const html = renderToStaticMarkup(<CatalogView catalog={catalog} env={env} passthroughAsDefault={false} />)
    expect(html).toContain('http://upstream.test')
  })

  it('shows a not-set marker when the base URL env is missing', () => {
    const html = renderToStaticMarkup(<CatalogView catalog={catalog} env={{}} passthroughAsDefault={false} />)
    expect(html).toContain('not set')
  })

  describe('system nav', () => {
    const twoSystems: Catalog = {
      systems: [
        catalog.systems[0],
        {
          displayName: 'Payments Gateway',
          slug: 'payments-gateway',
          baseUrlEnv: 'PAYMENTS_GATEWAY_URL',
          port: 4002,
          clientCertEnv: 'PAYMENTS_CERT',
          clientKeyEnv: 'PAYMENTS_KEY',
          endpoints: [
            {
              slug: 'authorize',
              displayName: 'Authorize Payment',
              method: 'POST',
              path: '/payments/authorize',
              scenarios: { default: { displayName: 'Approved' } },
              resolverScenarios: [],
            },
          ],
        },
      ],
    }
    const twoEnv = { HELLO_SYSTEM_URL: 'http://upstream.test', PAYMENTS_GATEWAY_URL: 'https://payments.test' }

    function render(selectedSystem?: string): string {
      return renderToStaticMarkup(
        <CatalogView
          catalog={twoSystems}
          env={twoEnv}
          passthroughAsDefault={false}
          selectedSystem={selectedSystem}
        />,
      )
    }

    it('lists every system with its port and base URL, linking by query string', () => {
      const html = render()
      expect(html).toContain('href="/catalog?system=hello-system"')
      expect(html).toContain('href="/catalog?system=payments-gateway"')
      expect(html).toContain(':4001')
      expect(html).toContain(':4002')
      expect(html).toContain('http://upstream.test')
      expect(html).toContain('https://payments.test')
    })

    it('shows only the selected system\'s endpoints and marks it current', () => {
      const html = render('payments-gateway')
      expect(html).toContain('Authorize Payment')
      expect(html).not.toContain('Hello World')
      expect(currentHref(html)).toBe('/catalog?system=payments-gateway')
    })

    it('selects the first system when the slug is missing or unknown', () => {
      for (const html of [render(), render('no-such-system')]) {
        expect(html).toContain('Hello World')
        expect(html).not.toContain('Authorize Payment')
        expect(currentHref(html)).toBe('/catalog?system=hello-system')
      }
    })

    it('marks a system that presents a client certificate', () => {
      expect(render()).toContain('Presents a client certificate when forwarding')
    })

    it('names the missing base URL env var for the selected system only', () => {
      const html = renderToStaticMarkup(
        <CatalogView
          catalog={twoSystems}
          env={{ HELLO_SYSTEM_URL: 'http://upstream.test' }}
          passthroughAsDefault={false}
          selectedSystem="hello-system"
        />,
      )
      expect(html).toContain('base URL not set')
      expect(html).not.toContain('PAYMENTS_GATEWAY_URL')
      const selectedMissing = renderToStaticMarkup(
        <CatalogView
          catalog={twoSystems}
          env={{ HELLO_SYSTEM_URL: 'http://upstream.test' }}
          passthroughAsDefault={false}
          selectedSystem="payments-gateway"
        />,
      )
      expect(selectedMissing).toContain('PAYMENTS_GATEWAY_URL')
    })
  })

  it('renders an empty state when there are no endpoints', () => {
    const html = renderToStaticMarkup(
      <CatalogView catalog={{ systems: [] }} env={env} passthroughAsDefault={false} />,
    )
    expect(html).toContain('No endpoints')
  })

  it('does not show a schema-verified badge for endpoints without a schema', () => {
    const html = renderToStaticMarkup(<CatalogView catalog={catalog} env={env} passthroughAsDefault={false} />)
    expect(html).not.toContain('Schema verified')
  })

  it('shows a schema-verified badge for endpoints that declare a schema', () => {
    const withSchema: Catalog = {
      systems: [
        {
          ...catalog.systems[0],
          endpoints: [{ ...catalog.systems[0].endpoints[0], schema: { responses: {} } }],
        },
      ],
    }
    const html = renderToStaticMarkup(<CatalogView catalog={withSchema} env={env} passthroughAsDefault={false} />)
    expect(html).toContain('Schema verified')
  })
})
