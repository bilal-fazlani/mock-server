import { describe, expect, it } from 'vitest'
import type { EndpointDef } from '../../src/lib/catalog/types'
import {
  danglingScenarioLabel,
  isScenarioDeclared,
  scenarioOptionsWithDangling,
  scenariosWithPassthrough,
} from '../../src/lib/scenarios'

const ep = (over: Partial<EndpointDef> = {}): EndpointDef => ({
  name: 'ep', displayName: 'Ep', method: 'GET', path: '/ep',
  scenarios: { default: 'Default', frozen: 'Frozen' },
  resolverScenarios: [],
  ...over,
})

describe('scenariosWithPassthrough', () => {
  it('appends real last when passthrough is not the default', () => {
    const keys = Object.keys(scenariosWithPassthrough(ep(), false))
    expect(keys).toEqual(['default', 'frozen', 'real'])
  })

  it('prepends real first when passthrough is the default', () => {
    const keys = Object.keys(scenariosWithPassthrough(ep(), true))
    expect(keys).toEqual(['real', 'default', 'frozen'])
  })

  it('no longer injects any synthetic entries beyond real', () => {
    const endpoint = {
      name: 'e', displayName: 'E', method: 'GET', path: '/e',
      scenarios: { default: 'default', 'by-amount': 'Routes by amount' },
      resolverScenarios: ['by-amount'],
    } as EndpointDef
    expect(Object.keys(scenariosWithPassthrough(endpoint, false))).toEqual([
      'default',
      'by-amount',
      'real',
    ])
  })
})

describe('isScenarioDeclared', () => {
  it('accepts a declared fixture scenario', () => {
    expect(isScenarioDeclared(ep(), 'frozen')).toBe(true)
  })
  it('accepts the "real" passthrough', () => {
    expect(isScenarioDeclared(ep(), 'real')).toBe(true)
  })
  it('rejects an undeclared scenario', () => {
    expect(isScenarioDeclared(ep(), 'ghost')).toBe(false)
  })
  it('accepts a resolver-backed slug like any other declared scenario', () => {
    const endpoint = ep({ scenarios: { default: 'Default', 'by-amount': 'Routes' }, resolverScenarios: ['by-amount'] })
    expect(isScenarioDeclared(endpoint, 'by-amount')).toBe(true)
  })
})

describe('danglingScenarioLabel', () => {
  it('renders a generic unavailable label', () => {
    expect(danglingScenarioLabel('frozen')).toBe('frozen — unavailable')
  })
})

describe('scenarioOptionsWithDangling', () => {
  const offered = { default: 'Default', real: 'Passthrough' }

  it('leaves options untouched when the selection is offered', () => {
    const r = scenarioOptionsWithDangling(offered, 'default')
    expect(r.options).toEqual(offered)
    expect(r.unavailable).toEqual([])
  })

  it('adds a dangling entry for a missing single selection', () => {
    const r = scenarioOptionsWithDangling(offered, 'gone')
    expect(r.options.gone).toBe('gone — unavailable')
    expect(r.unavailable).toEqual(['gone'])
  })

  it('adds dangling entries for missing sequence steps', () => {
    const r = scenarioOptionsWithDangling(offered, ['default', 'gone', 'vanished'])
    expect(r.unavailable.sort()).toEqual(['gone', 'vanished'])
    expect(r.options.gone).toBe('gone — unavailable')
  })

  it('ignores an undefined selection', () => {
    expect(scenarioOptionsWithDangling(offered, undefined).unavailable).toEqual([])
  })
})
