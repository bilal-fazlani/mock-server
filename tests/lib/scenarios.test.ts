import { describe, expect, it } from 'vitest'
import type { EndpointDef } from '../../src/lib/catalog/types'
import {
  danglingScenarioLabel,
  DYNAMIC_SCENARIO,
  scenariosWithPassthrough,
} from '../../src/lib/scenarios'

const ep = (over: Partial<EndpointDef> = {}): EndpointDef => ({
  name: 'ep', displayName: 'Ep', method: 'GET', path: '/ep',
  scenarios: { default: 'Default', frozen: 'Frozen' },
  ...over,
})

describe('scenariosWithPassthrough', () => {
  it('omits dynamic when there is no resolver', () => {
    const keys = Object.keys(scenariosWithPassthrough(ep(), false))
    expect(keys).toEqual(['default', 'frozen', 'real'])
  })
  it('includes dynamic (before real) when hasResolver is true', () => {
    const keys = Object.keys(scenariosWithPassthrough(ep({ hasResolver: true }), false))
    expect(keys).toEqual(['default', 'frozen', DYNAMIC_SCENARIO, 'real'])
  })
})

describe('danglingScenarioLabel', () => {
  it('special-cases dynamic', () => {
    expect(danglingScenarioLabel('dynamic')).toBe('Dynamic — unavailable (no _dynamic.ts)')
  })
  it('generic for other slugs', () => {
    expect(danglingScenarioLabel('frozen')).toBe('frozen — unavailable')
  })
})
