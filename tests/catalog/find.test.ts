import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/find'
import { findEndpointBySlug } from '../../src/lib/catalog/find'

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
          scenarios: { default: 'Hello success' },
        },
      ],
    },
  ],
}

describe('findEndpointBySlug', () => {
  it('finds an endpoint by system slug and endpoint name', () => {
    const match = findEndpointBySlug(catalog, 'hello-system', 'hello_world')
    expect(match?.system.name).toBe('Hello System')
    expect(match?.endpoint.name).toBe('hello_world')
  })

  it('returns null for an unknown system slug', () => {
    expect(findEndpointBySlug(catalog, 'nope-system', 'hello_world')).toBeNull()
  })

  it('returns null for an unknown endpoint name', () => {
    expect(findEndpointBySlug(catalog, 'hello-system', 'goodbye')).toBeNull()
  })
})
