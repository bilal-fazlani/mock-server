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
    scenarios: { default: { label: 'Success' } },
    resolverScenarios: [],
    ...overrides,
  }
}

function catalog(endpoints: EndpointDef[]): Catalog {
  return { systems: [{ name: 'Test System', slug: 'test-system', baseUrlEnv: 'TEST_URL', endpoints }] }
}

function validateCatalogWith(
  fixture: { body: unknown; headers?: unknown },
  opts: { endpointFunctions?: string } = {},
): string[] {
  const sys = 'test-system'
  const ep = 'hello_world'
  const files: Record<string, unknown> = {
    [`${sys}/_system.json`]: { name: 'Test System', baseUrlEnv: 'TEST_URL' },
    [`${sys}/${ep}/_endpoint.json`]: {
      displayName: 'Hello World',
      method: 'POST',
      path: '/hello/world',
      mockType: 'global',
    },
    [`${sys}/${ep}/default.json`]: { status: 200, ...fixture },
  }
  if (opts.endpointFunctions !== undefined) {
    files[`${sys}/${ep}/_functions.mjs`] = opts.endpointFunctions
  }
  const dir = tmpCatalogDir(files)
  return validateCatalog(loadCatalog(dir), dir).errors
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
    resolverScenarios: [],
    ...overrides,
  }) as EndpointDef

describe('validateCatalog', () => {
  it('passes a valid catalog + fixtures', () => {
    const dir = tmpCatalogDir({ 'test-system/hello_world/default.json': GOOD_FIXTURE })
    expect(validateCatalog(catalog([endpoint()]), dir).errors).toEqual([])
  })

  it('accepts a fixture with a valid delay', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, delay: '400ms', body: { ok: true } },
    })
    expect(validateCatalog(catalog([endpoint()]), dir).errors).toEqual([])
  })

  it('rejects a fixture with a malformed delay', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, delay: '400', body: { ok: true } },
    })
    expect(validateCatalog(catalog([endpoint()]), dir).errors.join('\n')).toMatch(
      /invalid delay "400"/,
    )
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
            captureProfileKeys: [{ namespace: 'event-id', keySelector: 'bearer' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors.join('\n'),
    ).toMatch(/keySelector/)

    expect(
      validateCatalog(
        catalog([
          endpoint({
            captureProfileKeys: [{ namespace: 'event-id', keySelector: 'header:x-event-id' }],
          } as Partial<EndpointDef>),
        ]),
        dir,
      ).errors,
    ).toEqual([])
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
      catalog([endpoint({ scenarios: { success: { label: 'Success' } } })]),
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
      catalog([endpoint({ scenarios: { default: { label: 'Success' }, real: { label: 'Passthrough' } } })]),
      dir,
    )
    expect(errors.join('\n')).toMatch(/"real" must not exist/)
  })

  it('skips fixture checks for resolver-backed scenario slugs', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': GOOD_FIXTURE,
    })
    const { errors } = validateCatalog(
      catalog([
        endpoint({
          scenarios: { default: { label: 'Success' }, 'by-amount': { label: 'Routes by amount' } },
          resolverScenarios: ['by-amount'],
        }),
      ]),
      dir,
    )
    // "by-amount" is resolver-backed, so no missing-fixture error is raised.
    expect(errors).toEqual([])
  })

  it('accepts default.ts as the required default scenario', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/success.json': GOOD_FIXTURE,
    })
    const { errors } = validateCatalog(
      catalog([
        endpoint({
          scenarios: { default: { label: 'Default (resolver)' }, success: { label: 'Success' } },
          resolverScenarios: ['default'],
        }),
      ]),
      dir,
    )
    expect(errors).toEqual([])
  })

  it('rejects real.ts the same as real.json', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': GOOD_FIXTURE,
    })
    const { errors } = validateCatalog(
      catalog([
        endpoint({
          scenarios: { default: { label: 'Success' }, real: { label: 'Passthrough (resolver)' } },
          resolverScenarios: ['real'],
        }),
      ]),
      dir,
    )
    expect(errors).toContainEqual(expect.stringContaining('scenario "real" must not exist'))
  })

  it('rejects an endpoint whose scenarios are all resolver-backed', () => {
    const dir = tmpCatalogDir()
    const { errors } = validateCatalog(
      catalog([
        endpoint({
          scenarios: { default: { label: 'Default (resolver)' } },
          resolverScenarios: ['default'],
        }),
      ]),
      dir,
    )
    expect(errors).toContainEqual(
      expect.stringContaining('declare at least one fixture-backed scenario'),
    )
  })

  it('flags invalid fixture shape, malformed placeholders, and undeclared path placeholders', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': { body: {} }, // no status
    })
    expect(validateCatalog(catalog([endpoint()]), dir).errors.join('\n')).toMatch(/numeric "status"/)

    // "banana" parses fine as a zero-arg call — it's now scoped-function
    // validation that rejects it (see "placeholder function scoping" below).
    // A malformed function name is what still fails to parse at all.
    const dir2 = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { x: '{{123bad}}' } },
    })
    expect(validateCatalog(catalog([endpoint()]), dir2).errors.join('\n')).toMatch(/invalid placeholder/)

    const dir3 = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { x: '{{path:cid}}' } },
    })
    expect(validateCatalog(catalog([endpoint()]), dir3).errors.join('\n')).toMatch(
      /undeclared path param/,
    )
  })

  it('accepts a valid now offset placeholder and rejects a malformed one', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { x: '{{now+3d:iso}}' } },
    })
    const { errors } = validateCatalog(catalog([endpoint()]), dir)
    expect(errors).toEqual([])

    const dir2 = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { x: '{{now+3x:iso}}' } },
    })
    expect(
      validateCatalog(catalog([endpoint()]), dir2).errors.some((e) =>
        e.includes('invalid placeholder "{{now+3x:iso}}"'),
      ),
    ).toBe(true)
  })

  it('accepts a header placeholder and rejects one reading a credential header', () => {
    const dir = tmpCatalogDir({
      'test-system/hello_world/default.json': {
        status: 200,
        headers: { 'x-request-id': '{{header:x-request-id}}' },
        body: { trace: '{{header:traceparent}}' },
      },
    })
    expect(validateCatalog(catalog([endpoint()]), dir).errors).toEqual([])

    const dir2 = tmpCatalogDir({
      'test-system/hello_world/default.json': { status: 200, body: { x: '{{header:cookie}}' } },
    })
    expect(validateCatalog(catalog([endpoint()]), dir2).errors.join('\n')).toMatch(
      /invalid placeholder "\{\{header:cookie\}\}"/,
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

describe('validateCatalog placeholder function scoping', () => {
  it('rejects a placeholder calling an unknown function', () => {
    const errors = validateCatalogWith({ body: { x: '{{bogusFn:$.a}}' } })
    expect(errors.join('\n')).toMatch(/unknown function "bogusFn"/)
  })

  it('accepts a placeholder calling a function defined in that endpoint scope', () => {
    const errors = validateCatalogWith(
      { body: { x: '{{mine:$.a}}' } },
      { endpointFunctions: `export function mine(c, a) { return a }` },
    )
    expect(errors).toEqual([])
  })

  it('still flags an undeclared path param', () => {
    const errors = validateCatalogWith({ body: { x: '{{path:missing}}' } })
    expect(errors.join('\n')).toMatch(/undeclared path param/)
  })

  it('rejects a syntactic form used as a call (piped now)', () => {
    const errors = validateCatalogWith({ body: { x: '{{$.a | now:iso}}' } })
    expect(errors.join('\n')).toMatch(/unknown function "now"/)
  })

  it('rejects bare {{now}} (reserved, but not callable)', () => {
    const errors = validateCatalogWith({ body: { x: '{{now}}' } })
    expect(errors.join('\n')).toMatch(/unknown function "now"/)
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
      catalog([endpoint({ schema: OP, scenarios: { default: { label: 'Success' }, failure: { label: 'Failure' } } })]),
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
