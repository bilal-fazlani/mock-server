import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Runs the real entry point as a child process, bundled the way
// scripts/build-standalone-entries.mjs bundles it, beside a stub `server.js`
// that reports the HOSTNAME it was started with. That is the only way to see the
// things this file is for: the handoff to Next's server, the system listeners
// opened before it, and the process exiting before it when either can't start.

let dir: string
let serveCjs: string

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-serve-main-'))
  serveCjs = path.join(dir, 'serve.cjs')
  await build({
    entryPoints: [path.join(__dirname, '../../src/server/serve-main.ts')],
    outfile: serveCjs,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['./server.js'],
    logLevel: 'silent',
  })
  fs.writeFileSync(
    path.join(dir, 'server.js'),
    [
      "const net = require('node:net')",
      "const ports = (process.env.PROBE_PORTS ?? '').split(',').filter(Boolean)",
      'Promise.all(ports.map((port) => new Promise((resolve) => {',
      "  const socket = net.connect(Number(port), '127.0.0.1', () => { socket.end(); resolve('open') })",
      "  socket.on('error', () => resolve('closed'))",
      '}))).then((probes) => {',
      "  if (ports.length) console.log('probes=' + probes.join(','))",
      "  if (process.env.SHOW_CATALOG) console.log('catalog=' + process.env.CATALOG_PATH)",
      "  console.log('HOSTNAME=' + process.env.HOSTNAME + ' token=' + (process.env.MOCK_SERVER_INTERNAL_SYSTEM_TOKEN ?? '').length)",
      '  process.exit(0)',
      '})',
    ].join('\n'),
  )
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

function writeCatalog(systems: Record<string, Record<string, unknown>>): string {
  const catalogDir = fs.mkdtempSync(path.join(dir, 'catalog-'))
  for (const [slug, meta] of Object.entries(systems)) {
    fs.mkdirSync(path.join(catalogDir, slug))
    fs.writeFileSync(
      path.join(catalogDir, slug, '_system.json'),
      JSON.stringify({ displayName: slug, baseUrlEnv: 'X_URL', ...meta }),
    )
  }
  return catalogDir
}

async function catalogWithFreePorts(...slugs: string[]): Promise<{ catalogDir: string; ports: number[] }> {
  const ports: number[] = []
  while (ports.length < slugs.length) ports.push(await freePort())
  return {
    catalogDir: writeCatalog(Object.fromEntries(slugs.map((slug, i) => [slug, { port: ports[i] }]))),
    ports,
  }
}

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, [serveCjs], {
    cwd: dir,
    // Not process.env: an ambient BIND_ADDRESS or HOSTNAME would leak into the case.
    env: { PATH: process.env.PATH ?? '', BIND_ADDRESS: '127.0.0.1', ...env } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
}

describe('serve.cjs entry point', () => {
  it('hands Next the default address and ignores a platform-set HOSTNAME', async () => {
    const { catalogDir } = await catalogWithFreePorts('alpha')
    const result = run({ HOSTNAME: 'some-pod-name', BIND_ADDRESS: '', CATALOG_PATH: catalogDir })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('HOSTNAME=0.0.0.0 token=64')
  })

  it('hands Next the BIND_ADDRESS it was given', async () => {
    const { catalogDir } = await catalogWithFreePorts('alpha')
    const result = run({ HOSTNAME: 'some-pod-name', BIND_ADDRESS: '::1', CATALOG_PATH: catalogDir })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('HOSTNAME=::1')
  })

  it('logs one line per system with its port before handing over to Next', async () => {
    const { catalogDir, ports } = await catalogWithFreePorts('alpha', 'beta')
    const result = run({ CATALOG_PATH: catalogDir, PORT: '3999' })
    expect(result.status).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines).toEqual([
      'mock-server: admin UI and control API on http://127.0.0.1:3999/ui',
      `mock-server: system alpha on http://127.0.0.1:${ports[0]}`,
      `mock-server: system beta on http://127.0.0.1:${ports[1]}`,
      'HOSTNAME=127.0.0.1 token=64',
    ])
  })

  it('has every system listener accepting connections before Next starts', async () => {
    const { catalogDir, ports } = await catalogWithFreePorts('alpha', 'beta')
    const result = run({ CATALOG_PATH: catalogDir, PROBE_PORTS: ports.join(',') })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('probes=open,open')
  })

  it('hands Next an absolute catalog path, since its server.js changes directory', async () => {
    const { catalogDir } = await catalogWithFreePorts('alpha')
    const result = run({ CATALOG_PATH: path.relative(dir, catalogDir), SHOW_CATALOG: '1' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`catalog=${fs.realpathSync(catalogDir)}`)
  })

  it('exits 1 before loading the server when a system has no port', () => {
    const result = run({ CATALOG_PATH: writeCatalog({ alpha: {} }) })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('mock-server: cannot start:')
    expect(result.stderr).toContain('alpha: missing "port"')
    expect(result.stdout).not.toContain('HOSTNAME=')
  })

  it('exits 1 before loading the server when a system uses the admin port', () => {
    const result = run({ CATALOG_PATH: writeCatalog({ alpha: { port: 4123 } }), PORT: '4123' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('system "alpha": port 4123 is the admin port (PORT)')
    expect(result.stdout).not.toContain('HOSTNAME=')
  })

  it('exits 1 naming the system and port when the port is already taken', async () => {
    const taken = net.createServer()
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve))
    const { port } = taken.address() as net.AddressInfo
    try {
      const result = run({ CATALOG_PATH: writeCatalog({ alpha: { port } }) })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        `cannot listen on 127.0.0.1:${port} for system "alpha": the port is already in use`,
      )
      expect(result.stdout).not.toContain('HOSTNAME=')
    } finally {
      await new Promise((resolve) => taken.close(resolve))
    }
  })

  it('exits 1 with a message, before loading the server, for a non-IP BIND_ADDRESS', () => {
    const result = run({ BIND_ADDRESS: 'bogus' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('BIND_ADDRESS must be an IPv4 or IPv6 address')
    expect(result.stderr).toContain('"bogus"')
    expect(result.stdout).toBe('')
  })
})
