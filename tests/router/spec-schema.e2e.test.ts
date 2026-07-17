import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSchemaRegistry } from '../../src/lib/catalog/schema'
import { loadCatalog } from '../../src/lib/catalog/load'
import { loadFixture } from '../../src/lib/mock-engine/fixtures'
import type { MockProfile } from '../../src/lib/profiles/store'
import { createMockHandler } from '../../src/lib/router/handler'
import type { RouterDeps } from '../../src/lib/router/route-request'

const NOW = new Date('2026-07-02T00:00:00.000Z')

const tmpDirs: string[] = []

function tmpCatalogDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-spec-schema-e2e-'))
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
// Global mock endpoint (no profile involved) — keeps the test focused on
// spec-backed request/response schema validation rather than profile wiring.
const ENDPOINT_META = {
  displayName: 'Mock Endpoint',
  method: 'POST',
  path: '/mock',
  mockType: 'global',
}
const SPEC_YAML = [
  'paths:',
  '  /mock:',
  '    post:',
  '      requestBody:',
  '        required: true',
  '        content:',
  '          application/json:',
  '            schema:',
  '              type: object',
  '              required: [name]',
  '              properties:',
  '                name: { type: string }',
  '      responses:',
  '        "200":',
  '          content:',
  '            application/json:',
  '              schema:',
  '                type: object',
  '                required: [ok]',
  '                properties:',
  '                  ok: { type: boolean }',
].join('\n')

// Mirrors handlerWith() in handler.e2e.test.ts / the deps() builder in
// route-request.test.ts, but wires `schemas` from the real buildSchemaRegistry
// output for a catalog loaded (via the real loadCatalog) from a temp dir
// whose schema comes from a system _spec.yaml rather than a _schema.json.
function handlerWith(dir: string, globalScenario: string | null) {
  const catalog = loadCatalog(dir)
  const { schemas } = buildSchemaRegistry(catalog)
  const deps: RouterDeps = {
    catalog,
    schemas,
    passthroughAsDefault: false,
    unmockedUsers: 'ERROR',
    timeoutMs: 1000,
    env: {},
    getProfile: async (): Promise<MockProfile | null> => null,
    getProfileKeyMapping: async () => null,
    getGlobalMockScenario: async () => globalScenario,
    captureProfileKeyMapping: async () => {},
    advanceScenarioProgress: async () => 1,
    getCompiledResolver: () => null,
    getDynamicHistory: async () => [],
    appendDynamicHistory: async () => {},
    passthrough: async () => ({
      status: 299,
      headers: { 'x-proxied': '1' },
      bodyBytes: Buffer.from('proxied'),
    }),
    loadFixture: (systemSlug, endpointName, scenario) =>
      loadFixture(dir, systemSlug, endpointName, scenario),
    now: () => NOW,
  }
  return createMockHandler(deps)
}

function mockRequest(body: unknown): Request {
  return new Request('http://localhost:3000/mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('spec-backed schema validation end-to-end (system _spec.yaml, real loadCatalog + real schema registry)', () => {
  it('400s when the request body violates the schema resolved from the system _spec', async () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/_spec.yaml': SPEC_YAML,
      'sys/mock/_endpoint.json': ENDPOINT_META,
      'sys/mock/default.json': { status: 200, body: { ok: true } },
    })
    const handle = handlerWith(dir, null) // implicit "default" scenario

    // Missing the required "name" field declared by the spec's requestBody schema.
    const res = await handle(mockRequest({}), ['mock'])

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/request body does not match schema/)
  })

  it('500s when the generated response violates the schema resolved from the system _spec', async () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/_spec.yaml': SPEC_YAML,
      'sys/mock/_endpoint.json': ENDPOINT_META,
      'sys/mock/default.json': { status: 200, body: { ok: true } },
      // "ok" must be a boolean per the spec's 200 response schema.
      'sys/mock/bad_response.json': { status: 200, body: { ok: 'not-a-boolean' } },
    })
    const handle = handlerWith(dir, 'bad_response')

    const res = await handle(mockRequest({ name: 'irrelevant' }), ['mock'])

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/generated response does not match schema/)
  })
})
