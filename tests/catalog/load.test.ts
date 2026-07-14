import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CatalogLoadError, loadCatalog } from '../../src/lib/catalog/load'

const tmpDirs: string[] = []

function tmpCatalogDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-catalog-'))
  tmpDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

const SYSTEM_META = { name: 'Test System', baseUrlEnv: 'TEST_URL' }
const ENDPOINT_META = {
  displayName: 'Hello World',
  method: 'POST',
  path: '/hello/world',
  profileIdSelector: '$.customerId',
}
const FIXTURE = { description: 'Success', status: 200, body: { ok: true } }

describe('loadCatalog', () => {
  it('loads the example catalog systems', () => {
    const catalog = loadCatalog(path.join(__dirname, '../../catalog'))
    expect(catalog.systems.map((s) => s.slug)).toEqual(['hello-system'])
    expect(catalog.systems.flatMap((s) => s.endpoints.map((e) => `${s.slug}/${e.name}`))).toEqual(
      expect.arrayContaining(['hello-system/hello_world', 'hello-system/customer_status']),
    )
  })

  it('derives scenario descriptions, falling back to the filename', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': { status: 200, body: {} }, // no description
      'sys/ep/failure.json': { description: 'It failed', status: 500, body: {} },
    })
    const catalog = loadCatalog(dir)
    expect(catalog.systems[0].endpoints[0].scenarios).toEqual({
      default: 'default',
      failure: 'It failed',
    })
  })

  it('orders scenarios default-first, then alphabetically', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/zeta.json': FIXTURE,
      'sys/ep/alpha.json': FIXTURE,
      'sys/ep/default.json': FIXTURE,
    })
    const catalog = loadCatalog(dir)
    expect(Object.keys(catalog.systems[0].endpoints[0].scenarios)).toEqual([
      'default',
      'alpha',
      'zeta',
    ])
  })

  it('throws one aggregated error listing every structural problem', () => {
    const dir = tmpCatalogDir({
      'stray.json': {}, // loose file in catalog root
      'no-meta/ep/_endpoint.json': ENDPOINT_META, // system without _system.json
      'no-meta/ep/default.json': FIXTURE,
      'sys/_system.json': SYSTEM_META,
      'sys/loose.json': {}, // loose file in a system dir
      'sys/ep/default.json': FIXTURE, // endpoint without _endpoint.json
      'sys/ep2/_endpoint.json': ENDPOINT_META,
      'sys/ep2/default.json': FIXTURE,
      'sys/ep2/Bad Name.json': FIXTURE, // invalid scenario filename
    })
    let message = ''
    try {
      loadCatalog(dir)
    } catch (err) {
      expect(err).toBeInstanceOf(CatalogLoadError)
      message = (err as Error).message
    }
    expect(message).toMatch(/stray\.json/)
    expect(message).toMatch(/_system\.json/)
    expect(message).toMatch(/loose\.json/)
    expect(message).toMatch(/_endpoint\.json/)
    expect(message).toMatch(/Bad Name\.json/)
  })

  it('flags metadata files with missing fields or invalid JSON', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': { name: 'S' }, // missing baseUrlEnv
      'sys/ep/_endpoint.json': 'not json {',
      'sys/ep/default.json': FIXTURE,
    })
    let message = ''
    try {
      loadCatalog(dir)
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/baseUrlEnv/)
    expect(message).toMatch(/not valid JSON/)
  })

  it('ignores dotfiles at every level', () => {
    const dir = tmpCatalogDir({
      '.DS_Store': '',
      'sys/_system.json': SYSTEM_META,
      'sys/.DS_Store': '',
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/.DS_Store': '',
      'sys/ep/default.json': FIXTURE,
    })
    expect(() => loadCatalog(dir)).not.toThrow()
  })

  it('throws when the catalog directory does not exist', () => {
    expect(() => loadCatalog('/nonexistent/catalog')).toThrow(CatalogLoadError)
  })

  it('loads an endpoint with metadata but zero scenario files as empty scenarios', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
    })
    const catalog = loadCatalog(dir)
    expect(catalog.systems[0].endpoints[0].scenarios).toEqual({})
  })

  it('marks an endpoint with _dynamic.ts as hasResolver and ignores the file as a scenario', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': FIXTURE,
      'sys/ep/_dynamic.ts': `export default () => 'default'`,
    })
    const catalog = loadCatalog(dir)
    const ep = catalog.systems[0].endpoints[0]
    expect(ep.hasResolver).toBe(true)
    expect(Object.keys(ep.scenarios)).toEqual(['default'])
  })

  it('loads captureProfileKeys from endpoint metadata', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': {
        ...ENDPOINT_META,
        captureProfileKeys: [{ namespace: 'event-id', keySelector: '$.eventID' }],
      },
      'sys/ep/default.json': FIXTURE,
    })
    const endpoint = loadCatalog(dir).systems[0].endpoints[0]
    expect(endpoint).toMatchObject({
      captureProfileKeys: [{ namespace: 'event-id', keySelector: '$.eventID' }],
    })
  })

  it('throws when captureProfileKeys metadata is structurally invalid', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': {
        ...ENDPOINT_META,
        captureProfileKeys: [{ namespace: 'event-id' }],
      },
      'sys/ep/default.json': FIXTURE,
    })

    expect(() => loadCatalog(dir)).toThrow(CatalogLoadError)
    expect(() => loadCatalog(dir)).toThrow(/captureProfileKeys/)
  })
})

describe('loadCatalog _schema.json', () => {
  const OP = {
    responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
  }

  it('attaches _schema.json to the endpoint when present', () => {
    const dir = tmpCatalogDir({
      'test-system/_system.json': SYSTEM_META,
      'test-system/hello_world/_endpoint.json': ENDPOINT_META,
      'test-system/hello_world/default.json': FIXTURE,
      'test-system/hello_world/_schema.json': OP,
    })
    const catalog = loadCatalog(dir)
    const ep = catalog.systems[0].endpoints[0]
    expect(ep.schema).toEqual(OP)
    expect(Object.keys(ep.scenarios)).toEqual(['default']) // _schema.json is not a scenario
  })

  it('leaves schema undefined when the file is absent', () => {
    const dir = tmpCatalogDir({
      'test-system/_system.json': SYSTEM_META,
      'test-system/hello_world/_endpoint.json': ENDPOINT_META,
      'test-system/hello_world/default.json': FIXTURE,
    })
    expect(loadCatalog(dir).systems[0].endpoints[0].schema).toBeUndefined()
  })

  it('fails hard on a malformed _schema.json', () => {
    const dir = tmpCatalogDir({
      'test-system/_system.json': SYSTEM_META,
      'test-system/hello_world/_endpoint.json': ENDPOINT_META,
      'test-system/hello_world/default.json': FIXTURE,
      'test-system/hello_world/_schema.json': '{not json',
    })
    expect(() => loadCatalog(dir)).toThrow(CatalogLoadError)
    expect(() => loadCatalog(dir)).toThrow(/_schema\.json/)
  })
})
