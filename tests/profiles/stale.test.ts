import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import {
  renderableStaleEndpoints,
  staleScenarios,
  unresolvedStaleEndpoints,
} from '../../src/lib/profiles/stale'

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
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'resolver_ep',
          displayName: 'Resolver Endpoint',
          method: 'GET',
          path: '/resolver',
          profileIdSelector: '$.customerId',
          scenarios: { default: { label: 'Success' }, by_amount: { label: 'Routes by amount' } },
          resolverScenarios: ['by_amount'],
        },
      ],
    },
  ],
}

const base = { profileId: 'p1', createdAt: new Date(), modifiedAt: new Date() }

describe('staleScenarios', () => {
  it('returns empty for selections that still exist in the catalog', () => {
    expect(
      staleScenarios({ ...base, endpointScenarios: { hello_world: 'default' } }, catalog),
    ).toEqual({})
  })

  it('flags a scenario the catalog no longer declares', () => {
    expect(
      staleScenarios({ ...base, endpointScenarios: { hello_world: 'legacy' } }, catalog),
    ).toEqual({ hello_world: 'legacy' })
  })

  it('flags a selection for an endpoint the catalog no longer has', () => {
    expect(
      staleScenarios({ ...base, endpointScenarios: { removed_ep: 'default' } }, catalog),
    ).toEqual({ removed_ep: 'default' })
  })

  it('does not flag a pinned "real" because passthrough is always allowed', () => {
    expect(staleScenarios({ ...base, endpointScenarios: { hello_world: 'real' } }, catalog)).toEqual(
      {},
    )
  })

  it('returns empty for a sequence whose steps all exist (including "real")', () => {
    expect(
      staleScenarios(
        { ...base, endpointScenarios: { hello_world: ['real', 'default'] } },
        catalog,
      ),
    ).toEqual({})
  })

  it('flags the undeclared steps of a sequence', () => {
    expect(
      staleScenarios(
        { ...base, endpointScenarios: { hello_world: ['default', 'legacy', 'ghost'] } },
        catalog,
      ),
    ).toEqual({ hello_world: 'legacy, ghost' })
  })

  it('flags a sequence for an endpoint the catalog no longer has', () => {
    expect(
      staleScenarios({ ...base, endpointScenarios: { removed_ep: ['default'] } }, catalog),
    ).toEqual({ removed_ep: 'default' })
  })

  it('does not flag a resolver-backed slug pin on an endpoint that declares it', () => {
    expect(
      staleScenarios({ ...base, endpointScenarios: { resolver_ep: 'by_amount' } }, catalog),
    ).toEqual({})
  })

  it('flags a resolver-backed slug pin on an endpoint that does not declare it', () => {
    expect(
      staleScenarios({ ...base, endpointScenarios: { hello_world: 'by_amount' } }, catalog),
    ).toEqual({ hello_world: 'by_amount' })
  })

  it('does not flag a resolver-backed step within a sequence on a resolver endpoint', () => {
    expect(
      staleScenarios(
        { ...base, endpointScenarios: { resolver_ep: ['default', 'by_amount'] } },
        catalog,
      ),
    ).toEqual({})
  })
})

describe('unresolvedStaleEndpoints', () => {
  it('flags an endpoint whose single dangling slug is still selected', () => {
    expect(
      unresolvedStaleEndpoints({ hello_world: ['legacy'] }, { hello_world: ['legacy'] }),
    ).toEqual(['hello_world'])
  })

  it('clears an endpoint once a valid scenario is selected instead', () => {
    expect(
      unresolvedStaleEndpoints({ hello_world: ['legacy'] }, { hello_world: ['default'] }),
    ).toEqual([])
  })

  it('flags a sequence that still contains a dangling step', () => {
    expect(
      unresolvedStaleEndpoints(
        { hello_world: ['gone'] },
        { hello_world: ['default', 'gone', 'default'] },
      ),
    ).toEqual(['hello_world'])
  })

  it('clears a sequence once the dangling step is replaced', () => {
    expect(
      unresolvedStaleEndpoints(
        { hello_world: ['gone'] },
        { hello_world: ['default', 'default'] },
      ),
    ).toEqual([])
  })

  it('treats a stale endpoint absent from selections as unresolved', () => {
    expect(unresolvedStaleEndpoints({ hello_world: ['legacy'] }, {})).toEqual(['hello_world'])
  })

  it('treats a stale endpoint with an empty selection as unresolved', () => {
    expect(unresolvedStaleEndpoints({ hello_world: ['legacy'] }, { hello_world: [] })).toEqual([
      'hello_world',
    ])
  })

  it('returns empty when nothing is stale', () => {
    expect(unresolvedStaleEndpoints({}, { hello_world: ['legacy'] })).toEqual([])
  })
})

describe('renderableStaleEndpoints', () => {
  it('keeps a stale endpoint that still exists in the catalog', () => {
    expect(renderableStaleEndpoints({ hello_world: ['legacy'] }, catalog)).toEqual({
      hello_world: ['legacy'],
    })
  })

  it('drops a stale endpoint the catalog no longer has (not user-resolvable)', () => {
    expect(renderableStaleEndpoints({ removed_ep: ['default'] }, catalog)).toEqual({})
  })

  it('keeps present endpoints and drops absent ones together', () => {
    expect(
      renderableStaleEndpoints({ hello_world: ['legacy'], removed_ep: ['default'] }, catalog),
    ).toEqual({ hello_world: ['legacy'] })
  })
})
