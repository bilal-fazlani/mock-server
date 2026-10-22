import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/find'
import { findEndpointBySlug } from '../../src/lib/catalog/find'

const catalog: Catalog = {
  systems: [
    {
      displayName: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [
        {
          slug: 'hello_world',
          displayName: 'Hello World',
          method: 'POST',
          path: '/hello/world',
          profileIdSelector: '$.customerId',
          scenarios: { default: { displayName: 'Hello success' } },
          resolverScenarios: [],
        },
      ],
    },
  ],
}

describe('findEndpointBySlug', () => {
  it('finds an endpoint by system slug and endpoint name', () => {
    const match = findEndpointBySlug(catalog, 'hello-system', 'hello_world')
    expect(match?.system.displayName).toBe('Hello System')
    expect(match?.endpoint.slug).toBe('hello_world')
  })

  it('returns null for an unknown system slug', () => {
    expect(findEndpointBySlug(catalog, 'nope-system', 'hello_world')).toBeNull()
  })

  it('returns null for an unknown endpoint name', () => {
    expect(findEndpointBySlug(catalog, 'hello-system', 'goodbye')).toBeNull()
  })
})
