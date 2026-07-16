import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EndpointDef, SystemDef } from '../../src/lib/catalog/types'
import { buildScenarioViews, type ScenarioView } from '../../src/app/ui/catalog/scenario-view'

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
  resolverScenarios: [],
}

describe('buildScenarioViews', () => {
  it('loads the raw fixture json for the default scenario', async () => {
    const views = await buildScenarioViews(system, endpoint, fixturesDir, {}, false)
    const fixture = views.find((v) => v.key === 'default')
    expect(fixture).toMatchObject({ key: 'default', isDefault: true, kind: 'fixture' })
    if (fixture?.kind === 'fixture') expect(fixture.json).toContain('"status"')
  })

  it('reports an error view when a fixture is missing', async () => {
    const missing: EndpointDef = { ...endpoint, scenarios: { nope: 'Missing' } }
    const views = await buildScenarioViews(system, missing, fixturesDir, {}, false)
    expect(views[0].kind).toBe('error')
  })

  it('appends a synthetic passthrough entry last when passthrough is not the default', async () => {
    const views = await buildScenarioViews(system, endpoint, fixturesDir, { TEST_SYSTEM_URL: 'http://upstream.test' }, false)
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

  it('prepends the synthetic passthrough entry first when passthrough is the default', async () => {
    const views = await buildScenarioViews(system, endpoint, fixturesDir, {}, true)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ key: 'real', kind: 'passthrough', url: null })
    expect(views[1]).toMatchObject({ key: 'default' })
  })

  it('marks a resolver-backed scenario slug with the resolver kind', async () => {
    const views = await buildScenarioViews(
      system,
      {
        ...endpoint,
        scenarios: { default: 'Success', by_amount: 'Routes by amount' },
        resolverScenarios: ['by_amount'],
      },
      fixturesDir,
      {},
      false,
    )
    const resolver = views.find((v) => v.key === 'by_amount')
    expect(resolver?.kind).toBe('resolver')
  })
})

describe('buildScenarioViews - resolver source and syntax highlighting', () => {
  let dir: string
  let views: ScenarioView[]

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-scenario-view-'))
    fs.mkdirSync(path.join(dir, 'test-system', 'hello_world'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'test-system', 'hello_world', 'by-amount.ts'),
      "export default function resolve() {\n  return 'default'\n}\n",
    )
    fs.writeFileSync(
      path.join(dir, 'test-system', 'hello_world', 'default.json'),
      JSON.stringify({
        description: 'Success',
        status: 200,
        body: { greeting: 'hello' },
      }),
    )

    const resolverEndpoint: EndpointDef = {
      ...endpoint,
      scenarios: { default: 'Success', 'by-amount': 'Routes by amount' },
      resolverScenarios: ['by-amount'],
    }
    views = await buildScenarioViews(system, resolverEndpoint, dir, {}, false)
  })

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('includes resolver source and highlighted html for resolver-backed scenarios', () => {
    const resolver = views.find((v) => v.key === 'by-amount')
    expect(resolver).toMatchObject({ kind: 'resolver' })
    expect((resolver as { code: string }).code).toContain('export default')
    expect((resolver as { html: string }).html).toContain('<pre')
  })

  it('highlights only the fixture body, not the full fixture object', () => {
    const fixture = views.find((v) => v.kind === 'fixture')
    const html = (fixture as { html: string }).html
    // Highlighted markup for the body only...
    expect(html).toContain('<pre')
    expect(html).toContain('greeting')
    // ...so the top-level fixture keys are absent from the highlighted body.
    expect(html).not.toContain('status')
    expect(html).not.toContain('description')
    // The full fixture is still available as `json` for the status chip.
    expect((fixture as { json: string }).json).toContain('status')
  })
})
