import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }
const originalCwd = process.cwd()

const tmpDirs: string[] = []

function tmpProjectDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-runtime-'))
  tmpDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

const SYSTEM_META = { name: 'Test System', baseUrlEnv: 'TEST_URL' }
const ENDPOINT_META = {
  displayName: 'Endpoint',
  method: 'POST',
  path: '/ep',
  profileIdSelector: '$.customerId',
}
const FIXTURE = { status: 200, body: { ok: true } }

afterEach(() => {
  process.chdir(originalCwd)
  process.env = { ...originalEnv }
  vi.resetModules()
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('getRuntime', () => {
  it('ignores legacy STRICT_MODE when parsing current routing config', async () => {
    process.chdir(__dirname + '/../..')
    process.env = {
      ...originalEnv,
      STRICT_MODE: 'true',
      PASSTHROUGH_AS_DEFAULT: 'false',
      UNMOCKED_USERS: 'ERROR',
      MOCK_CONSOLE_LOG_LEVEL: 'warn',
    }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(getRuntime()).toMatchObject({
      passthroughAsDefault: false,
      unmockedUsers: 'ERROR',
      consoleLogLevel: 'warn',
    })
  })

  it('compiles a <slug>.ts resolver and serves it via getCompiledResolver, patching the label', async () => {
    const dir = tmpProjectDir({
      'catalog/sys/_system.json': SYSTEM_META,
      'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
      'catalog/sys/ep/success.json': FIXTURE,
      'catalog/sys/ep/default.ts': `export const description = 'Routes by amount'\nexport default () => 'success'`,
    })
    process.chdir(dir)
    process.env = { ...originalEnv }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    const rt = getRuntime()
    const resolver = rt.getCompiledResolver('sys', 'ep', 'default')
    expect(resolver).not.toBeNull()
    expect(resolver!.invoke({ request: { method: 'POST', path: '/ep', pathParams: {}, query: {}, headers: {}, body: null }, history: [], profileId: null }, 100)).toBe('success')
    expect(rt.resolverHistoryLimit).toBe(10)
    // The compiled module's `description` export patches the scenario label.
    const ep = rt.catalog.systems[0].endpoints[0]
    expect(ep.scenarios.default).toBe('Routes by amount')
    expect(rt.getCompiledResolver('sys', 'ep', 'missing')).toBeNull()
  })

  it('serves the resolver from the startup cache in production', async () => {
    const dir = tmpProjectDir({
      'catalog/sys/_system.json': SYSTEM_META,
      'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
      'catalog/sys/ep/default.json': FIXTURE,
      'catalog/sys/ep/pick.ts': `export default () => 'default'`,
    })
    process.chdir(dir)
    process.env = { ...originalEnv, NODE_ENV: 'production' }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    const rt = getRuntime()
    expect(rt.getCompiledResolver('sys', 'ep', 'pick')).not.toBeNull()

    // Delete the source on disk: the prod cache-read path must keep serving the
    // compiled resolver built at startup (a per-call re-read would throw/return null).
    fs.rmSync(path.join(dir, 'catalog/sys/ep/pick.ts'))
    const resolver = rt.getCompiledResolver('sys', 'ep', 'pick')
    expect(resolver).not.toBeNull()
    expect(
      resolver!.invoke(
        { request: { method: 'POST', path: '/ep', pathParams: {}, query: {}, headers: {}, body: null }, history: [], profileId: null },
        100,
      ),
    ).toBe('default')
  })

  it('returns null for a slug that has no <slug>.ts resolver', async () => {
    const dir = tmpProjectDir({
      'catalog/sys/_system.json': SYSTEM_META,
      'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
      'catalog/sys/ep/default.json': FIXTURE,
    })
    process.chdir(dir)
    process.env = { ...originalEnv }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(getRuntime().getCompiledResolver('sys', 'ep', 'default')).toBeNull()
  })

  it('fails startup when a <slug>.ts resolver does not compile', async () => {
    const dir = tmpProjectDir({
      'catalog/sys/_system.json': SYSTEM_META,
      'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
      'catalog/sys/ep/default.json': FIXTURE,
      'catalog/sys/ep/pick.ts': `export default (=>`,
    })
    process.chdir(dir)
    process.env = { ...originalEnv }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(() => getRuntime()).toThrow(/catalog validation failed/)
  })
})
