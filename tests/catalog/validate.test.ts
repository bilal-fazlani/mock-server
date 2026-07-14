import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCatalog } from '../../src/lib/catalog/load'
import type { Catalog, EndpointDef } from '../../src/lib/catalog/types'
import { validateAppConfig, validateCatalog } from '../../src/lib/catalog/validate'

const tmpDirs: string[] = []

function tmpCatalogDir(files: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-fixtures-'))
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

function endpoint(overrides: Partial<EndpointDef> = {}): EndpointDef {
  return {
    name: 'hello_world',
    displayName: 'Hello World',
    method: 'POST',
    path: '/hello/world',
    profileIdSelector: '$.customerId',
    scenarios: { default: 'Success' },
    ...overrides,
  }
}

function catalog(endpoints: EndpointDef[]): Catalog {
  return { systems: [{ name: 'Test System', slug: 'test-system', baseUrlEnv: 'TEST_URL', endpoints }] }
}

const GOOD_FIXTURE = { status: 200, body: { ok: true } }
const globalEndpoint = (overrides: Partial<EndpointDef> = {}) =>
  ({
    name: 'oauth_token',
    displayName: 'OAuth Token',
    method: 'POST',
    path: '/oauth/token',
    mockType: 'global',
    scenarios: { default: 'Token' },
    ...overrides,
  }) as EndpointDef

describe('validateCatalog', () => {
  it('passes a valid catalog + fixtures', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(validateCatalog(catalog([endpoint()]), dir).errors).toEqual([])
  })

  it('flags a missing fixture for a declared scenario', () => {
    const dir = tmpCatalogDir()
    const { errors } = validateCatalog(catalog([endpoint()]), dir)
    expect(errors.join('\n')).toMatch(/missing fixture.*default/)
  })

  it('flags an invalid selector and a path: selector without a template param', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(
      validateCatalog(catalog([endpoint({ profileIdSelector: 'nope' })]), dir).errors.join('\n'),
    ).toMatch(/selector/)
    expect(
      validateCatalog(catalog([endpoint({ profileIdSelector: 'path:customerId' })]), dir).errors.join(
        '\n',
      ),
    ).toMatch(/path:customerId.*no matching/)
  })

  it('allows bearer profile selectors and rejects malformed bearer claims', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(
      validateCatalog(catalog([endpoint({ profileIdSelector: 'bearer' })]), dir).errors,
    ).toEqual([])
    expect(
      validateCatalog(catalog([endpoint({ profileIdSelector: 'bearer:sub' })]), dir).errors,
    ).toEqual([])
    expect(
      validateCatalog(catalog([endpoint({ profileIdSelector: 'bearer:sub.name' })]), dir).errors.join(
        '\n',
      ),
    ).toMatch(/invalid bearer claim selector/)
  })

  it('keeps bearer selectors out of captures and profile-key nesting', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(
      validateCatalog(
        catalog([
          endpoint({
            captureProfileKeys: [{ namespace: 'token', keySelector: 'bearer' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/keySelector/)
    expect(
      validateCatalog(
        catalog([endpoint({ profileIdSelector: 'profileKey:token:bearer' })]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/selector/)
  })

  it('allows a global endpoint without a profile selector', () => {
    const dir = tmpCatalogDir({ 'test-system/oauth_token/default.json': GOOD_FIXTURE })
    expect(validateCatalog(catalog([globalEndpoint()]), dir).errors).toEqual([])
  })

  it('rejects profile-only configuration on a global endpoint', () => {
    const dir = tmpCatalogDir({ 'test-system/oauth_token/default.json': GOOD_FIXTURE })
    const errors = validateCatalog(
      catalog([
        globalEndpoint({
          profileIdSelector: '$.customerId',
          captureProfileKeys: [{ namespace: 'event-id', keySelector: '$.eventID' }],
        } as Partial<EndpointDef>),
      ]),
      dir,
    ).errors.join('\n')
    expect(errors).toMatch(/global.*profileIdSelector/)
    expect(errors).toMatch(/global.*captureProfileKeys/)
  })

  it('requires profiled endpoints to have a profile selector', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    const profiledWithoutSelector = {
      ...endpoint(),
      mockType: 'profiled',
      profileIdSelector: undefined,
    } as unknown as EndpointDef
    expect(validateCatalog(catalog([profiledWithoutSelector]), dir).errors.join('\n')).toMatch(
      /profileIdSelector/,
    )
  })

  it('validates captureProfileKeys selectors and namespaces', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(
      validateCatalog(
        catalog([
          endpoint({
            captureProfileKeys: [{ namespace: 'event-id', keySelector: '$.eventID' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors,
    ).toEqual([])

    expect(
      validateCatalog(
        catalog([
          endpoint({
            captureProfileKeys: [{ namespace: 'EventID', keySelector: '$.eventID' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/namespace/)

    expect(
      validateCatalog(
        catalog([
          endpoint({
            captureProfileKeys: [{ namespace: 'event-id', keySelector: 'header:eventID' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/keySelector/)
  })

  it('validates path selectors inside profileKey and captureProfileKeys', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })

    expect(
      validateCatalog(
        catalog([
          endpoint({
            path: '/events/{eventId}',
            profileIdSelector: 'profileKey:event-id:path:eventId',
          }),
        ]),
        dir,
      ).errors,
    ).toEqual([])

    expect(
      validateCatalog(
        catalog([endpoint({ profileIdSelector: 'profileKey:event-id:path:eventId' })]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/path:eventId.*no matching/)

    expect(
      validateCatalog(
        catalog([
          endpoint({
            captureProfileKeys: [{ namespace: 'event-id', keySelector: 'path:eventId' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/path:eventId.*no matching/)
  })

  it('rejects captureProfileKeys on endpoints resolved through profileKey mappings', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(
      validateCatalog(
        catalog([
          endpoint({
            profileIdSelector: 'profileKey:event-id:$.eventID',
            captureProfileKeys: [{ namespace: 'other-id', keySelector: '$.otherID' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/captureProfileKeys.*direct profile/)
  })

  it('flags an invalid path template and ambiguous endpoints', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(
      validateCatalog(catalog([endpoint({ path: 'hello/world' })]), dir).errors.join('\n'),
    ).toMatch(/path template/)
    const dir2 = tmpCatalogDir({
      'test-system/a/default.json': GOOD_FIXTURE,
      'test-system/b/default.json': GOOD_FIXTURE,
    })
    const { errors } = validateCatalog(
      catalog([
        endpoint({ name: 'a', path: '/customers/{id}' }),
        endpoint({ name: 'b', path: '/customers/recent' }),
      ]),
      dir2,
    )
    expect(errors.join('\n')).toMatch(/ambiguous endpoints/)
  })

  it('flags scenarios missing the required "default" key', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/success.json': GOOD_FIXTURE })
    const { errors } = validateCatalog(
      catalog([endpoint({ scenarios: { success: 'Success' } })]),
      dir,
    )
    expect(errors.join('\n')).toMatch(/missing required "default" scenario/)
  })

  it('flags a "real" scenario fixture', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': GOOD_FIXTURE,
      'test-system/hello_world/real.json': GOOD_FIXTURE,
    })
    const { errors } = validateCatalog(
      catalog([endpoint({ scenarios: { default: 'Success', real: 'Passthrough' } })]),
      dir,
    )
    expect(errors.join('\n')).toMatch(/"real" must not exist/)
  })

  it('rejects a scenario named "dynamic"', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': GOOD_FIXTURE,
    })
    const { errors } = validateCatalog(
      catalog([endpoint({ scenarios: { default: 'Success', dynamic: 'Nope' } })]),
      dir,
    )
    expect(errors.some((e) => e.includes('"dynamic" must not exist'))).toBe(true)
  })

  it('flags invalid fixture shape, malformed placeholders, and undeclared path placeholders', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': { body: {} }, // no status
    })
    expect(validateCatalog(catalog([endpoint()]), dir).errors.join('\n')).toMatch(/numeric "status"/)

    const dir2 = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { x: '{{banana}}' } },
    })
    expect(validateCatalog(catalog([endpoint()]), dir2).errors.join('\n')).toMatch(/invalid placeholder/)

    const dir3 = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { x: '{{path:cid}}' } },
    })
    expect(validateCatalog(catalog([endpoint()]), dir3).errors.join('\n')).toMatch(
      /undeclared path param/,
    )
  })

  it('builds a fixture cache keyed by file path', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    const { errors, fixtures } = validateCatalog(catalog([endpoint()]), dir)
    expect(errors).toEqual([])
    expect(fixtures.get(path.join(dir, 'test-system', 'hello_world', 'default.json'))).toEqual(
      GOOD_FIXTURE,
    )
  })

  it('validates the real catalog tree', () => {
    const catalogRoot = path.join(__dirname, '../../catalog')
    expect(validateCatalog(loadCatalog(catalogRoot), catalogRoot).errors).toEqual([])
  })
})

describe('validateCatalog with _schema.json', () => {
  const OP = {
    responses: {
      '200': {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['ok'],
              properties: { ok: { type: 'boolean' }, customerId: { type: 'string' } },
            },
          },
        },
      },
    },
  }

  it('passes fixtures that satisfy the response schema', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    const { errors, schemas } = validateCatalog(catalog([endpoint({ schema: OP })]), dir)
    expect(errors).toEqual([])
    expect(schemas.get('test-system/hello_world')).toBeDefined()
  })

  it('flags a fixture whose literal body violates the schema', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { ok: 'yes' } },
    })
    const { errors } = validateCatalog(catalog([endpoint({ schema: OP })]), dir)
    expect(errors.join('\n')).toMatch(/does not match _schema\.json/)
    expect(errors.join('\n')).toMatch(/\/ok/)
  })

  it('treats placeholder values as wildcards', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': {
        status: 200,
        body: { ok: '{{$.flag}}', customerId: '{{$.customerId}}' },
      },
    })
    expect(validateCatalog(catalog([endpoint({ schema: OP })]), dir).errors).toEqual([])
  })

  it('flags a fixture status with no matching response key', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': GOOD_FIXTURE,
      'test-system/hello_world/failure.json': { status: 500, body: { message: 'boom' } },
    })
    const { errors } = validateCatalog(
      catalog([endpoint({ schema: OP, scenarios: { default: 'Success', failure: 'Failure' } })]),
      dir,
    )
    expect(errors.join('\n')).toMatch(/status 500.*no matching response schema/)
  })

  it('reports schema compile failures as startup errors', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    const bad = {
      requestBody: { content: { 'application/json': { schema: { type: 'not-a-type' } } } },
    }
    const { errors, schemas } = validateCatalog(catalog([endpoint({ schema: bad })]), dir)
    expect(errors.join('\n')).toMatch(/invalid JSON Schema/)
    expect(schemas.size).toBe(0)
  })

  it('does nothing without a _schema.json (schemas registry is empty)', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { ok: 'not-even-a-boolean' } },
    })
    const { errors, schemas } = validateCatalog(catalog([endpoint()]), dir)
    expect(errors).toEqual([])
    expect(schemas.size).toBe(0)
  })
})

describe('validateAppConfig', () => {
  const system = { name: 'Test System', slug: 'test-system', baseUrlEnv: 'TEST_URL', endpoints: [endpoint()] }
  const cat: Catalog = { systems: [system] }

  it('passes when PASSTHROUGH_AS_DEFAULT is false, regardless of env', () => {
    expect(validateAppConfig(cat, {}, false)).toEqual([])
  })

  it('flags a missing base URL when PASSTHROUGH_AS_DEFAULT is true', () => {
    const errors = validateAppConfig(cat, {}, true)
    expect(errors.join('\n')).toMatch(/TEST_URL/)
  })

  it('passes when PASSTHROUGH_AS_DEFAULT is true and the base URL is set', () => {
    expect(validateAppConfig(cat, { TEST_URL: 'http://x' }, true)).toEqual([])
  })
})
