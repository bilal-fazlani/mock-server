import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectCatalog, runValidate, type ValidateIo } from '../../src/cli/validate'

const tmpDirs: string[] = []

function tmpCatalogDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-validate-'))
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

function capture(): { io: ValidateIo; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err }
}

describe('runValidate', () => {
  it('exits 0 on the repository catalog', () => {
    const { io, out } = capture()
    expect(runValidate(path.join(__dirname, '../../catalog'), io)).toBe(0)
    expect(out).toEqual(['Catalog validation passed.'])
  })

  it('exits 0 on a valid catalog', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': { status: 200, body: { ok: true } },
    })
    const { io, out, err } = capture()
    expect(runValidate(dir, io)).toBe(0)
    expect(out).toEqual(['Catalog validation passed.'])
    expect(err).toEqual([])
  })

  it('exits 1 and lists every semantic error at once', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': { ...ENDPOINT_META, path: '/hello/{missing}' },
      // `real` may never be a fixture — passthrough reads no file.
      'sys/ep/real.json': { status: 200, body: {} },
    })
    const { io, out, err } = capture()
    expect(runValidate(dir, io)).toBe(1)
    expect(out).toEqual([])
    expect(err[0]).toBe('Catalog validation FAILED:')
    expect(err.slice(1).every((line) => line.startsWith(' - '))).toBe(true)
    expect(err.length).toBeGreaterThan(2)
  })

  it('exits 1 on a structural failure, printing the load error verbatim', () => {
    const dir = tmpCatalogDir({ 'sys/stray.txt': 'not a system' })
    const { io, err } = capture()
    expect(runValidate(dir, io)).toBe(1)
    expect(err[0]).toBe('Catalog validation FAILED:')
    expect(err[1]).toContain('invalid catalog structure:')
  })

  it('exits 1 when the catalog directory does not exist', () => {
    const { io, err } = capture()
    expect(runValidate(path.join(os.tmpdir(), 'mock-validate-absent'), io)).toBe(1)
    expect(err[1]).toContain('catalog directory not found')
  })

  it('exits 1 when a resolver fails to compile', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': { status: 200, body: {} },
      'sys/ep/broken.mjs': 'export default function ( {',
    })
    const { io, err } = capture()
    expect(runValidate(dir, io)).toBe(1)
    expect(err.join('\n')).toContain('broken.mjs')
  })

  it('prefixes catalog warnings with "!" and still passes', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': { status: 200, body: {} },
      // A spec whose operations match no endpoint warns rather than fails.
      'sys/_spec.yaml': [
        'openapi: 3.0.0',
        'info: { title: t, version: "1" }',
        'paths:',
        '  /unmatched:',
        '    get:',
        '      responses:',
        '        "200": { description: ok }',
      ].join('\n'),
    })
    const { io, out, err } = capture()
    expect(runValidate(dir, io)).toBe(0)
    expect(out).toEqual(['Catalog validation passed.'])
    expect(err.every((line) => line.startsWith(' ! '))).toBe(true)
    expect(err.length).toBeGreaterThan(0)
  })

  it('does not check environment config — a missing base URL is not an error', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': { name: 'Test System', baseUrlEnv: 'DEFINITELY_UNSET_BASE_URL' },
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': { status: 200, body: {} },
    })
    delete process.env.DEFINITELY_UNSET_BASE_URL
    // The env-dependent pass is startup's job (#40): validate runs in consumer
    // CI and image builds, where upstream base URLs are legitimately unset.
    expect(runValidate(dir, capture().io)).toBe(0)
  })
})

describe('inspectCatalog', () => {
  it('returns the loaded catalog so callers can layer extra checks on it', () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/ep/_endpoint.json': ENDPOINT_META,
      'sys/ep/default.json': { status: 200, body: {} },
    })
    const report = inspectCatalog(dir)
    expect(report.fatal).toBeNull()
    expect(report.errors).toEqual([])
    expect(report.catalog?.systems.map((s) => s.slug)).toEqual(['sys'])
  })

  it('reports a structural failure without a catalog', () => {
    const report = inspectCatalog(tmpCatalogDir({ 'sys/stray.txt': 'x' }))
    expect(report.catalog).toBeNull()
    expect(report.fatal).toContain('invalid catalog structure')
  })
})

// The subcommand's whole point is running where the server cannot: a consumer's
// CI job and a `docker build` layer, with no MongoDB and no Next runtime. That
// is a property of the bundle's import graph, so assert it there rather than
// trusting the entry point to stay clean by inspection.
describe('the validate bundle is Next-free and MongoDB-free', () => {
  it('pulls in neither next nor a mongo driver', async () => {
    const result = await build({
      entryPoints: [path.join(__dirname, '../../src/cli/validate-main.ts')],
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'cjs',
      external: ['esbuild'],
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    const forbidden = Object.keys(result.metafile.inputs).filter((input) =>
      /node_modules\/(next|mongodb|mongodb-memory-server)\//.test(input),
    )
    expect(forbidden).toEqual([])
  }, 60_000)
})
