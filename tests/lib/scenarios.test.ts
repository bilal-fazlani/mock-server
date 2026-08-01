import { describe, expect, it } from 'vitest'
import type { EndpointDef } from '../../src/lib/catalog/types'
import { REAL_SUMMARY } from '../../src/lib/config'
import {
  danglingScenarioLabel,
  isScenarioDeclared,
  scenarioOptionsWithDangling,
  scenariosWithPassthrough,
  type ScenarioOption,
} from '../../src/lib/scenarios'

const ep = (over: Partial<EndpointDef> = {}): EndpointDef => ({
  name: 'ep', displayName: 'Ep', method: 'GET', path: '/ep',
  scenarios: { default: { label: 'Default' }, frozen: { label: 'Frozen' } },
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
      scenarios: { default: { label: 'default' }, 'by-amount': { label: 'Routes by amount' } },
      resolverScenarios: ['by-amount'],
    } as EndpointDef
    expect(Object.keys(scenariosWithPassthrough(endpoint, false))).toEqual([
      'default',
      'by-amount',
      'real',
    ])
  })
})

describe('scenariosWithPassthrough option shape', () => {
  it('carries label, kind, and summary per declared scenario', () => {
    const endpoint = ep({
      scenarios: {
        default: { label: 'Default', summary: 'All good' },
        'by-amount': { label: 'Routes by amount' },
      },
      resolverScenarios: ['by-amount'],
    })
    const options = scenariosWithPassthrough(endpoint, false)
    expect(options.default).toEqual({ label: 'Default', summary: 'All good', kind: 'fixture' })
    expect(options['by-amount']).toEqual({ label: 'Routes by amount', kind: 'resolver' })
  })

  it('gives the implicit real entry the passthrough kind and auto-summary', () => {
    const options = scenariosWithPassthrough(ep(), false)
    expect(options.real).toEqual({ label: 'Passthrough', summary: REAL_SUMMARY, kind: 'passthrough' })
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
    const endpoint = ep({ scenarios: { default: { label: 'Default' }, 'by-amount': { label: 'Routes' } }, resolverScenarios: ['by-amount'] })
    expect(isScenarioDeclared(endpoint, 'by-amount')).toBe(true)
  })
})

describe('danglingScenarioLabel', () => {
  it('renders a generic unavailable label', () => {
    expect(danglingScenarioLabel('frozen')).toBe('frozen — unavailable')
  })
})

describe('scenarioOptionsWithDangling', () => {
  const offered: Record<string, ScenarioOption> = {
    default: { label: 'Default', kind: 'fixture' },
    real: { label: 'Passthrough', kind: 'passthrough' },
  }

  it('leaves options untouched when the selection is offered', () => {
    const r = scenarioOptionsWithDangling(offered, 'default')
    expect(r.options).toEqual(offered)
    expect(r.unavailable).toEqual([])
  })

  it('adds a dangling entry for a missing single selection', () => {
    const r = scenarioOptionsWithDangling(offered, 'gone')
    expect(r.options.gone).toEqual({ label: 'gone — unavailable', kind: 'fixture' })
    expect(r.unavailable).toEqual(['gone'])
  })

  it('adds dangling entries for missing sequence steps', () => {
    const r = scenarioOptionsWithDangling(offered, ['default', 'gone', 'vanished'])
    expect(r.unavailable.sort()).toEqual(['gone', 'vanished'])
    expect(r.options.gone).toEqual({ label: 'gone — unavailable', kind: 'fixture' })
  })

  it('ignores an undefined selection', () => {
    expect(scenarioOptionsWithDangling(offered, undefined).unavailable).toEqual([])
  })
})

describe('scenarioOptionsWithDangling option shape', () => {
  it('adds dangling pins as fixture-kind options with the unavailable label', () => {
    const offered = scenariosWithPassthrough(ep(), false)
    const { options, unavailable } = scenarioOptionsWithDangling(offered, 'ghost')
    expect(options.ghost).toEqual({ label: danglingScenarioLabel('ghost'), kind: 'fixture' })
    expect(unavailable).toEqual(['ghost'])
  })
})
