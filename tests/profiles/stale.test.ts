import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { staleScenarios } from '../../src/lib/profiles/stale'

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
          scenarios: { default: 'Success' },
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
})
