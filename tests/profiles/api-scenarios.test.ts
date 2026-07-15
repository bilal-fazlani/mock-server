import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import {
  InvalidScenarioSelectionError,
  parseEndpointScenariosFromJson,
} from '../../src/lib/profiles/api-scenarios'

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
          scenarios: { default: 'Success', failure: 'Failure', slow: 'Slow' },
        },
        {
          name: 'resolver_ep',
          displayName: 'Resolver Endpoint',
          method: 'GET',
          path: '/resolver',
          profileIdSelector: '$.customerId',
          scenarios: { default: 'Success' },
          hasResolver: true,
        },
      ],
    },
  ],
}

describe('parseEndpointScenariosFromJson', () => {
  it('keeps an explicit non-implicit single selection', () => {
    const out = parseEndpointScenariosFromJson({ hello_world: 'failure' }, catalog, 'default')
    expect(out).toEqual({ hello_world: 'failure' })
  })

  it('drops a selection equal to the implicit scenario (delta save)', () => {
    const out = parseEndpointScenariosFromJson({ hello_world: 'default' }, catalog, 'default')
    expect(out).toEqual({})
  })

  it('keeps a multi-step sequence and collapses a one-step sequence', () => {
    expect(
      parseEndpointScenariosFromJson({ hello_world: ['failure', 'slow'] }, catalog, 'default'),
    ).toEqual({ hello_world: ['failure', 'slow'] })
    expect(
      parseEndpointScenariosFromJson({ hello_world: ['failure'] }, catalog, 'default'),
    ).toEqual({ hello_world: 'failure' })
  })

  it('accepts the implicit "real" passthrough as a declared selection', () => {
    expect(
      parseEndpointScenariosFromJson({ hello_world: 'real' }, catalog, 'default'),
    ).toEqual({ hello_world: 'real' })
  })

  it('rejects a non-object input', () => {
    expect(() => parseEndpointScenariosFromJson([], catalog, 'default')).toThrow(
      InvalidScenarioSelectionError,
    )
  })

  it('rejects an unknown endpoint name', () => {
    expect(() => parseEndpointScenariosFromJson({ ghost: 'default' }, catalog, 'default')).toThrow(
      /unknown endpoint "ghost"/,
    )
  })

  it('rejects an undeclared scenario', () => {
    expect(() =>
      parseEndpointScenariosFromJson({ hello_world: 'nope' }, catalog, 'default'),
    ).toThrow(/not declared/)
  })

  it('accepts "dynamic" on an endpoint that has a resolver', () => {
    expect(
      parseEndpointScenariosFromJson({ resolver_ep: 'dynamic' }, catalog, 'default'),
    ).toEqual({ resolver_ep: 'dynamic' })
  })

  it('accepts "dynamic" as a sequence step on a resolver endpoint', () => {
    expect(
      parseEndpointScenariosFromJson({ resolver_ep: ['dynamic', 'default'] }, catalog, 'default'),
    ).toEqual({ resolver_ep: ['dynamic', 'default'] })
  })

  it('rejects "dynamic" on an endpoint without a resolver', () => {
    expect(() =>
      parseEndpointScenariosFromJson({ hello_world: 'dynamic' }, catalog, 'default'),
    ).toThrow(/not declared/)
  })

  it('rejects a sequence with a non-string step', () => {
    expect(() =>
      parseEndpointScenariosFromJson({ hello_world: ['failure', 3] }, catalog, 'default'),
    ).toThrow(InvalidScenarioSelectionError)
  })
})
