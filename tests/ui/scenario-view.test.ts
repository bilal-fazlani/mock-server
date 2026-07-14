import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EndpointDef, SystemDef } from '../../src/lib/catalog/types'
import { buildScenarioViews } from '../../src/app/ui/catalog/scenario-view'

const fixturesDir = path.join(__dirname, '../testdata/fixtures')

const system: SystemDef = {
  name: 'Test System',
  slug: 'test-system',
  baseUrlEnv: 'TEST_SYSTEM_URL',
  endpoints: [],
}

const endpoint: EndpointDef = {
  name: 'hello_world',
  displayName: 'Hello World',
  method: 'POST',
  path: '/hello/world',
  profileIdSelector: '$.customerId',
  scenarios: { default: 'Success' },
}

describe('buildScenarioViews', () => {
  it('loads the raw fixture json for the default scenario', () => {
    const views = buildScenarioViews(system, endpoint, fixturesDir, {}, false)
    const fixture = views.find((v) => v.key === 'default')
    expect(fixture).toMatchObject({ key: 'default', isDefault: true, kind: 'fixture' })
    if (fixture?.kind === 'fixture') expect(fixture.json).toContain('"status"')
  })

  it('reports an error view when a fixture is missing', () => {
    const missing: EndpointDef = { ...endpoint, scenarios: { nope: 'Missing' } }
    const views = buildScenarioViews(system, missing, fixturesDir, {}, false)
    expect(views[0].kind).toBe('error')
  })

  it('appends a synthetic passthrough entry last when passthrough is not the default', () => {
    const views = buildScenarioViews(system, endpoint, fixturesDir, { TEST_SYSTEM_URL: 'http://upstream.test' }, false)
    expect(views).toHaveLength(2)
    const real = views[1]
    expect(real).toMatchObject({
      key: 'real',
      isDefault: false,
      kind: 'passthrough',
      baseUrlEnv: 'TEST_SYSTEM_URL',
      url: 'http://upstream.test',
    })
  })

  it('prepends the synthetic passthrough entry first when passthrough is the default', () => {
    const views = buildScenarioViews(system, endpoint, fixturesDir, {}, true)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ key: 'real', kind: 'passthrough', url: null })
    expect(views[1]).toMatchObject({ key: 'default' })
  })

  it('includes a dynamic view when the endpoint has a resolver', () => {
    const views = buildScenarioViews(
      system,
      { ...endpoint, hasResolver: true },
      fixturesDir,
      {},
      false,
    )
    const dyn = views.find((v) => v.key === 'dynamic')
    expect(dyn?.kind).toBe('dynamic')
  })
})
