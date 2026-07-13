import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { CatalogView } from '../../src/app/ui/catalog/CatalogView'

const catalog: Catalog = {
  systems: [
    {
      name: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [
        {
          name: 'hello_world',
          displayName: 'Hello World',
          method: 'POST',
          path: '/hello/world',
          profileIdSelector: '$.customerId',
          scenarios: { default: 'Hello success', failure: 'Hello failure' },
        },
      ],
    },
  ],
}

const env = { HELLO_SYSTEM_URL: 'http://upstream.test' }

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
    expect(html).toContain('href="/ui/catalog/hello-system/hello_world"')
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
              name: 'oauth_token',
              displayName: 'OAuth Token',
              method: 'POST',
              path: '/oauth/token',
              mockType: 'global',
              scenarios: { default: 'Token issued' },
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
