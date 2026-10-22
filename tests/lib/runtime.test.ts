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

const SYSTEM_META = { displayName: 'Test System', baseUrlEnv: 'TEST_URL', port: 4001 }
const ENDPOINT_META = {
  displayName: 'Endpoint',
  method: 'POST',
  path: '/ep',
  profileIdSelector: '$.customerId',
}
const FIXTURE = { status: 200, body: { ok: true } }

afterEach(() => {
  delete (globalThis as { __mockServerRuntime?: unknown }).__mockServerRuntime
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

  it('builds a fresh runtime per module copy in development, so hot reloads take effect', async () => {
    process.chdir(__dirname + '/../..')
    process.env = { ...originalEnv, NODE_ENV: 'development' }
    vi.resetModules()
    const first = (await import('../../src/lib/runtime')).getRuntime()
    vi.resetModules()
    const second = (await import('../../src/lib/runtime')).getRuntime()

    expect(second).not.toBe(first)
  })

  it('builds the runtime once across separately bundled copies of the module in production', async () => {
    process.chdir(__dirname + '/../..')
    process.env = { ...originalEnv, NODE_ENV: 'production' }
    vi.resetModules()
    const first = (await import('../../src/lib/runtime')).getRuntime()
    vi.resetModules()
    const second = (await import('../../src/lib/runtime')).getRuntime()

    expect(second).toBe(first)
  })

  it('fails startup when BIND_ADDRESS is not an IP address', async () => {
    process.chdir(__dirname + '/../..')
    process.env = { ...originalEnv, BIND_ADDRESS: 'my-host' }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(() => getRuntime()).toThrow(/BIND_ADDRESS must be an IPv4 or IPv6 address.*"my-host"/)
  })

  it('defaults UNMATCHED_ENDPOINTS to ERROR, accepts REAL, and fails startup on anything else', async () => {
    process.chdir(__dirname + '/../..')
    process.env = { ...originalEnv }
    delete process.env.UNMATCHED_ENDPOINTS
    vi.resetModules()
    let mod = await import('../../src/lib/runtime')
    expect(mod.getRuntime().unmatchedEndpoints).toBe('ERROR')

    process.env = { ...originalEnv, UNMATCHED_ENDPOINTS: 'real' }
    vi.resetModules()
    mod = await import('../../src/lib/runtime')
    expect(mod.getRuntime().unmatchedEndpoints).toBe('REAL')

    process.env = { ...originalEnv, UNMATCHED_ENDPOINTS: 'DEFAULT_MOCK' }
    vi.resetModules()
    mod = await import('../../src/lib/runtime')
    expect(() => mod.getRuntime()).toThrow(/UNMATCHED_ENDPOINTS must be one of ERROR, REAL/)
  })

  it('fails startup when PORT is not a port number', async () => {
    process.chdir(__dirname + '/../..')
    process.env = { ...originalEnv, PORT: 'eighty' }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(() => getRuntime()).toThrow(/PORT must be an integer from 1 to 65535, got "eighty"/)
  })

  it('fails startup when a system port equals PORT', async () => {
    process.chdir(__dirname + '/../..')
    process.env = { ...originalEnv, PORT: '4001' }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(() => getRuntime()).toThrow(/system "hello-system": port 4001 is the admin port \(PORT\)/)
  })

  it('compiles a <slug>.ts resolver and serves it via getCompiledResolver, patching the label', async () => {
    const dir = tmpProjectDir({
      'catalog/sys/_system.json': SYSTEM_META,
      'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
      'catalog/sys/ep/success.json': FIXTURE,
      'catalog/sys/ep/default.mjs': `export const displayName = 'Routes by amount'\nexport default () => 'success'`,
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
    // The compiled module's `displayName` export patches the scenario label.
    const ep = rt.catalog.systems[0].endpoints[0]
    expect(ep.scenarios.default.displayName).toBe('Routes by amount')
    expect(rt.getCompiledResolver('sys', 'ep', 'missing')).toBeNull()
  })

  it('patches a scenario summary from a resolver summary export', async () => {
    const dir = tmpProjectDir({
      'catalog/sys/_system.json': SYSTEM_META,
      'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
      'catalog/sys/ep/success.json': FIXTURE,
      'catalog/sys/ep/default.mjs': `export const summary = 'Routes by amount'\nexport default () => 'success'`,
    })
    process.chdir(dir)
    process.env = { ...originalEnv }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    const ep = getRuntime().catalog.systems[0].endpoints[0]
    expect(ep.scenarios.default.summary).toBe('Routes by amount')
  })

  it('serves the resolver from the startup cache in production', async () => {
    const dir = tmpProjectDir({
      'catalog/sys/_system.json': SYSTEM_META,
      'catalog/sys/ep/_endpoint.json': ENDPOINT_META,
      'catalog/sys/ep/default.json': FIXTURE,
      'catalog/sys/ep/pick.mjs': `export default () => 'default'`,
    })
    process.chdir(dir)
    process.env = { ...originalEnv, NODE_ENV: 'production' }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    const rt = getRuntime()
    expect(rt.getCompiledResolver('sys', 'ep', 'pick')).not.toBeNull()

    // Delete the source on disk: the prod cache-read path must keep serving the
    // compiled resolver built at startup (a per-call re-read would throw/return null).
    fs.rmSync(path.join(dir, 'catalog/sys/ep/pick.mjs'))
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
      'catalog/sys/ep/pick.mjs': `export default (=>`,
    })
    process.chdir(dir)
    process.env = { ...originalEnv }
    vi.resetModules()
    const { getRuntime } = await import('../../src/lib/runtime')

    expect(() => getRuntime()).toThrow(/catalog validation failed/)
  })
})
