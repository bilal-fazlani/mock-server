import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../src/lib/catalog/load'
import { liveResolverScenarios } from '../../src/lib/dynamic/prune'

const tmpDirs: string[] = []

function tmpCatalogDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-prune-'))
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

const ENDPOINT_META = { displayName: 'Ep', method: 'GET', path: '/ep', profileIdSelector: 'path:id' }
const RESOLVER = 'export default () => "default"'

describe('liveResolverScenarios', () => {
  it('lists every resolver-backed scenario across all systems, and no fixture-backed ones', () => {
    const dir = tmpCatalogDir({
      'a/_system.json': { name: 'A', baseUrlEnv: 'A_URL' },
      'a/ep1/_endpoint.json': ENDPOINT_META,
      'a/ep1/default.json': { status: 200, body: {} },
      'a/ep1/by-amount.mjs': RESOLVER,
      'b/_system.json': { name: 'B', baseUrlEnv: 'B_URL' },
      'b/ep2/_endpoint.json': ENDPOINT_META,
      'b/ep2/default.mjs': RESOLVER,
      'b/ep2/ok.json': { status: 200, body: {} },
    })

    expect(liveResolverScenarios(loadCatalog(dir))).toEqual(
      expect.arrayContaining([
        { endpointName: 'ep1', scenario: 'by-amount' },
        { endpointName: 'ep2', scenario: 'default' },
      ]),
    )
    expect(liveResolverScenarios(loadCatalog(dir))).toHaveLength(2)
  })
})
