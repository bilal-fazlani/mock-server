import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { parseEndpointScenarios } from '../../src/lib/profiles/form'

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
          scenarios: { default: 'Success', failure: 'Failure', timeout: 'Timeout' },
          resolverScenarios: [],
        },
        {
          name: 'goodbye_world',
          displayName: 'Goodbye World',
          method: 'POST',
          path: '/goodbye/world',
          profileIdSelector: '$.customerId',
          scenarios: { default: 'Success' },
          resolverScenarios: [],
        },
        {
          name: 'resolver_ep',
          displayName: 'Resolver Endpoint',
          method: 'GET',
          path: '/resolver',
          profileIdSelector: '$.customerId',
          scenarios: { default: 'Success', by_amount: 'Routes by amount' },
          resolverScenarios: ['by_amount'],
        },
      ],
    },
  ],
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

describe('parseEndpointScenarios', () => {
  it('keeps single selections that deviate from the implicit scenario', () => {
    const result = parseEndpointScenarios(form({ 'scenario:hello_world': 'failure' }), catalog, 'default')
    expect(result).toEqual({ hello_world: 'failure' })
  })

  it('drops single selections equal to the implicit scenario (delta save)', () => {
    const result = parseEndpointScenarios(form({ 'scenario:hello_world': 'default' }), catalog, 'default')
    expect(result).toEqual({})
  })

  it('parses a sequence field into an ordered array', () => {
    const result = parseEndpointScenarios(
      form({ 'scenarioSequence:hello_world': JSON.stringify(['timeout', 'failure', 'default']) }),
      catalog,
      'default',
    )
    expect(result).toEqual({ hello_world: ['timeout', 'failure', 'default'] })
  })

  it('prefers the sequence field over a radio value for the same endpoint', () => {
    const result = parseEndpointScenarios(
      form({
        'scenarioSequence:hello_world': JSON.stringify(['timeout', 'default']),
        'scenario:hello_world': 'failure',
      }),
      catalog,
      'default',
    )
    expect(result).toEqual({ hello_world: ['timeout', 'default'] })
  })

  it('normalizes a one-step sequence to a single selection with delta save', () => {
    expect(
      parseEndpointScenarios(
        form({ 'scenarioSequence:hello_world': JSON.stringify(['failure']) }),
        catalog,
        'default',
      ),
    ).toEqual({ hello_world: 'failure' })
    expect(
      parseEndpointScenarios(
        form({ 'scenarioSequence:hello_world': JSON.stringify(['default']) }),
        catalog,
        'default',
      ),
    ).toEqual({})
  })

  it('treats an empty sequence as no selection', () => {
    expect(
      parseEndpointScenarios(
        form({ 'scenarioSequence:hello_world': JSON.stringify([]) }),
        catalog,
        'default',
      ),
    ).toEqual({})
  })

  it('accepts "real" as a sequence step', () => {
    expect(
      parseEndpointScenarios(
        form({ 'scenarioSequence:hello_world': JSON.stringify(['real', 'default']) }),
        catalog,
        'default',
      ),
    ).toEqual({ hello_world: ['real', 'default'] })
  })

  it('rejects a sequence containing an undeclared scenario', () => {
    expect(() =>
      parseEndpointScenarios(
        form({ 'scenarioSequence:hello_world': JSON.stringify(['ghost', 'default']) }),
        catalog,
        'default',
      ),
    ).toThrow(/ghost/)
  })

  it('rejects a malformed sequence payload', () => {
    expect(() =>
      parseEndpointScenarios(form({ 'scenarioSequence:hello_world': 'not-json' }), catalog, 'default'),
    ).toThrow(/sequence/)
    expect(() =>
      parseEndpointScenarios(
        form({ 'scenarioSequence:hello_world': JSON.stringify([42]) }),
        catalog,
        'default',
      ),
    ).toThrow(/sequence/)
  })

  it('rejects an undeclared single selection', () => {
    expect(() =>
      parseEndpointScenarios(form({ 'scenario:hello_world': 'ghost' }), catalog, 'default'),
    ).toThrow(/ghost/)
  })

  it('accepts a resolver-backed slug on an endpoint that declares it', () => {
    expect(
      parseEndpointScenarios(form({ 'scenario:resolver_ep': 'by_amount' }), catalog, 'default'),
    ).toEqual({ resolver_ep: 'by_amount' })
  })

  it('accepts a resolver-backed slug as a sequence step', () => {
    expect(
      parseEndpointScenarios(
        form({ 'scenarioSequence:resolver_ep': JSON.stringify(['by_amount', 'default']) }),
        catalog,
        'default',
      ),
    ).toEqual({ resolver_ep: ['by_amount', 'default'] })
  })

  it('rejects a resolver-backed slug on an endpoint that does not declare it', () => {
    expect(() =>
      parseEndpointScenarios(form({ 'scenario:hello_world': 'by_amount' }), catalog, 'default'),
    ).toThrow(/by_amount/)
  })

  it('handles multiple endpoints independently', () => {
    const result = parseEndpointScenarios(
      form({
        'scenarioSequence:hello_world': JSON.stringify(['timeout', 'default']),
        'scenario:goodbye_world': 'real',
      }),
      catalog,
      'default',
    )
    expect(result).toEqual({ hello_world: ['timeout', 'default'], goodbye_world: 'real' })
  })
})
