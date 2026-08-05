import { describe, expect, it } from 'vitest'
import {
  compileEndpointSchema,
  SchemaCompileError,
} from '../../src/lib/catalog/schema'
import type { Catalog } from '../../src/lib/catalog/types'
import { buildSchemaRegistry, schemaKey } from '../../src/lib/catalog/schema'

const REQUEST_OP = {
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['customerId'],
          properties: {
            customerId: { type: 'string' },
            amount: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
  },
}

describe('compileEndpointSchema', () => {
  it('rejects non-object schema files', () => {
    expect(() => compileEndpointSchema('nope', 'sys/ep')).toThrow(SchemaCompileError)
    expect(() => compileEndpointSchema([1], 'sys/ep')).toThrow(SchemaCompileError)
    expect(() => compileEndpointSchema(null, 'sys/ep')).toThrow(SchemaCompileError)
  })

  it('rejects an invalid JSON Schema with the endpoint label in the message', () => {
    const op = {
      requestBody: {
        content: { 'application/json': { schema: { type: 'not-a-type' } } },
      },
    }
    expect(() => compileEndpointSchema(op, 'sys/ep')).toThrow(/sys\/ep.*requestBody/)
  })

  it('ignores extra OpenAPI fields on the operation object', () => {
    const op = { ...REQUEST_OP, summary: 'says hello', operationId: 'hello', parameters: [] }
    expect(() => compileEndpointSchema(op, 'sys/ep')).not.toThrow()
  })
})

describe('validateRequestBody', () => {
  const compiled = compileEndpointSchema(REQUEST_OP, 'sys/ep')

  it('returns no issues for a valid body', () => {
    expect(compiled.validateRequestBody({ customerId: 'c1', amount: 5 })).toEqual([])
  })

  it('flags a missing required property', () => {
    const issues = compiled.validateRequestBody({ amount: 5 })
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.map((i) => i.message).join('\n')).toMatch(/customerId/)
  })

  it('flags a wrong type with the instance path', () => {
    const issues = compiled.validateRequestBody({ customerId: 'c1', amount: 'lots' })
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('/amount')
    expect(issues[0].message).toMatch(/number/)
  })

  it('flags a null body when requestBody.required is true', () => {
    const issues = compiled.validateRequestBody(null)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/required/)
  })

  it('accepts a null body when requestBody is not required', () => {
    const op = { requestBody: { ...REQUEST_OP.requestBody, required: false } }
    expect(compileEndpointSchema(op, 'sys/ep').validateRequestBody(null)).toEqual([])
  })

  it('validates nothing when the operation has no requestBody schema', () => {
    const compiledEmpty = compileEndpointSchema({}, 'sys/ep')
    expect(compiledEmpty.validateRequestBody({ anything: true })).toEqual([])
    expect(compiledEmpty.validateRequestBody(null)).toEqual([])
  })
})

const RESPONSE_OP = {
  responses: {
    '200': {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['customerId', 'ok'],
            properties: {
              customerId: { type: 'string' },
              ok: { type: 'boolean' },
              created: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    '5XX': {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['message'],
            properties: { message: { type: 'string' } },
          },
        },
      },
    },
  },
}

describe('response schema lookup', () => {
  const compiled = compileEndpointSchema(RESPONSE_OP, 'sys/ep')

  it('matches exact status, then range, then nothing', () => {
    expect(compiled.hasResponseFor(200)).toBe(true)
    expect(compiled.hasResponseFor(500)).toBe(true) // 5XX
    expect(compiled.hasResponseFor(503)).toBe(true) // 5XX
    expect(compiled.hasResponseFor(404)).toBe(false)
  })

  it('falls back to "default" when declared', () => {
    const op = {
      responses: { default: { content: { 'application/json': { schema: {} } } } },
    }
    const c = compileEndpointSchema(op, 'sys/ep')
    expect(c.hasResponseFor(200)).toBe(true)
    expect(c.hasResponseFor(418)).toBe(true)
    expect(c.validateResponseBody(418, { anything: 1 })).toEqual([])
  })

  it('prefers the exact key over a range key', () => {
    const op = {
      responses: {
        '500': {
          content: {
            'application/json': {
              schema: { type: 'object', required: ['exact'], properties: { exact: { type: 'boolean' } } },
            },
          },
        },
        '5XX': { content: { 'application/json': { schema: {} } } },
      },
    }
    const c = compileEndpointSchema(op, 'sys/ep')
    expect(c.validateResponseBody(500, {}).map((i) => i.message).join('\n')).toMatch(/exact/)
  })
})

describe('validateResponseBody', () => {
  const compiled = compileEndpointSchema(RESPONSE_OP, 'sys/ep')

  it('passes a valid body', () => {
    expect(compiled.validateResponseBody(200, { customerId: 'c1', ok: true })).toEqual([])
  })

  it('flags type violations with paths', () => {
    const issues = compiled.validateResponseBody(200, { customerId: 'c1', ok: 'yes' })
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('/ok')
  })

  it('reports an unmatched status as an issue', () => {
    const issues = compiled.validateResponseBody(404, {})
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/no response schema declared for status 404/)
  })
})

describe('validateFixtureBody (placeholders are wildcards)', () => {
  const compiled = compileEndpointSchema(RESPONSE_OP, 'sys/ep')

  it('does not flag placeholder values that violate type or format', () => {
    const body = {
      customerId: '{{$.customerId}}', // string per schema — fine either way
      ok: '{{$.flag}}',               // schema says boolean, placeholder is a wildcard
      created: '{{now:iso}}',         // format: date-time, wildcard
    }
    expect(compiled.validateFixtureBody(200, body)).toEqual([])
  })

  it('still flags literal violations next to placeholders', () => {
    const body = { customerId: '{{$.customerId}}', ok: 'yes' }
    const issues = compiled.validateFixtureBody(200, body)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('/ok')
  })

  it('still flags missing required properties', () => {
    const issues = compiled.validateFixtureBody(200, { customerId: '{{$.customerId}}' })
    expect(issues.map((i) => i.message).join('\n')).toMatch(/ok/)
  })

  it('returns no issues for an unmatched status (reported separately)', () => {
    expect(compiled.validateFixtureBody(404, {})).toEqual([])
  })
})

describe('buildSchemaRegistry', () => {
  function catalogWith(schema?: Record<string, unknown>): Catalog {
    return {
      systems: [
        {
          name: 'Test System',
          slug: 'test-system',
          baseUrlEnv: 'TEST_URL',
          endpoints: [
            {
              name: 'hello_world',
              displayName: 'Hello World',
              method: 'POST',
              path: '/hello/world',
              profileIdSelector: '$.customerId',
              scenarios: { default: { label: 'Success' } },
              resolverScenarios: [],
              ...(schema !== undefined ? { schema } : {}),
            },
          ],
        },
      ],
    }
  }

  it('compiles endpoints that declare a schema and skips those that do not', () => {
    const withSchema = buildSchemaRegistry(catalogWith(RESPONSE_OP))
    expect(withSchema.errors).toEqual([])
    expect(withSchema.schemas.get(schemaKey('test-system', 'hello_world'))).toBeDefined()

    const without = buildSchemaRegistry(catalogWith(undefined))
    expect(without.errors).toEqual([])
    expect(without.schemas.size).toBe(0)
  })

  it('collects compile failures as error strings instead of throwing', () => {
    const bad = {
      requestBody: { content: { 'application/json': { schema: { type: 'not-a-type' } } } },
    }
    const { schemas, errors } = buildSchemaRegistry(catalogWith(bad))
    expect(schemas.size).toBe(0)
    expect(errors.join('\n')).toMatch(/Test System\/hello_world.*requestBody/)
  })
})

describe('guaranteesPresence (#27)', () => {
  const req = (schema: unknown) =>
    compileEndpointSchema(
      { requestBody: { content: { 'application/json': { schema } } } },
      'sys/ep',
    )

  it('is true for a required field, false for an optional one', () => {
    const c = req({
      type: 'object',
      required: ['id'],
      properties: { id: {}, middleName: {} },
    })
    expect(c.guaranteesPresence(['id'])).toBe(true)
    expect(c.guaranteesPresence(['middleName'])).toBe(false)
  })

  it('is false for a field absent from properties (not required)', () => {
    const c = req({ type: 'object', required: ['id'], properties: { id: {} } })
    expect(c.guaranteesPresence(['other'])).toBe(false)
  })

  it('follows a required nested path and reports the first optional segment', () => {
    const c = req({
      type: 'object',
      required: ['a'],
      properties: {
        a: { type: 'object', required: ['b'], properties: { b: {}, maybe: {} } },
      },
    })
    expect(c.guaranteesPresence(['a', 'b'])).toBe(true)
    expect(c.guaranteesPresence(['a', 'maybe'])).toBe(false)
  })

  it('is undecidable for an array-index segment', () => {
    const c = req({
      type: 'object',
      required: ['xs'],
      properties: { xs: { type: 'array', items: {} } },
    })
    expect(c.guaranteesPresence(['xs', 0])).toBeUndefined()
  })

  it('is undecidable when a combinator is in the way', () => {
    const c = req({
      allOf: [{ type: 'object', required: ['id'], properties: { id: {} } }],
    })
    expect(c.guaranteesPresence(['id'])).toBeUndefined()
  })

  it('is false when descending through an unconstrained {} sub-schema', () => {
    // `a` is required but its schema is `{}` (any value), so `b` beneath it is
    // provably not guaranteed — a request can send `{ "a": {} }`.
    const c = req({ type: 'object', required: ['a'], properties: { a: {} } })
    expect(c.guaranteesPresence(['a', 'b'])).toBe(false)
  })

  it('is undecidable when a required field has no properties sub-schema at all', () => {
    const c = req({ type: 'object', required: ['a'] })
    expect(c.guaranteesPresence(['a', 'b'])).toBeUndefined()
  })

  it('resolves a plain #/$defs/ ref (the _spec-loader shape)', () => {
    const c = req({
      $ref: '#/$defs/Body',
      $defs: {
        Body: { type: 'object', required: ['id'], properties: { id: {}, note: {} } },
      },
    })
    expect(c.guaranteesPresence(['id'])).toBe(true)
    expect(c.guaranteesPresence(['note'])).toBe(false)
  })

  it('follows a recursive $defs schema without looping', () => {
    // A linked list: `next` is required at every level, so a two-hop path is
    // genuinely guaranteed — recursion here is legitimate, not a cycle.
    const c = req({
      $ref: '#/$defs/Node',
      $defs: {
        Node: {
          type: 'object',
          required: ['next'],
          properties: { next: { $ref: '#/$defs/Node' } },
        },
      },
    })
    expect(c.guaranteesPresence(['next', 'next'])).toBe(true)
  })

  it('is undecidable with no request schema', () => {
    const c = compileEndpointSchema({ responses: {} }, 'sys/ep')
    expect(c.guaranteesPresence(['anything'])).toBeUndefined()
  })
})

const PARAMS_OP = {
  parameters: [
    { name: 'thingId', in: 'path', required: true, schema: { type: 'string', pattern: '^t-' } },
    { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
    { name: 'tag', in: 'query', schema: { type: 'array', items: { type: 'string', minLength: 2 } } },
    { name: 'cursor', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'X-Priority', in: 'header', schema: { type: 'string', enum: ['low', 'high'] } },
    { name: 'Accept', in: 'header', schema: { type: 'string', enum: ['application/xml'] } },
    { name: 'session', in: 'cookie', schema: { type: 'string' } },
  ],
}

function paramsInput(
  overrides: {
    pathParams?: Record<string, string>
    search?: string
    headers?: Record<string, string>
  } = {},
) {
  return {
    pathParams: overrides.pathParams ?? { thingId: 't-1' },
    query: new URLSearchParams(overrides.search ?? '?cursor=abc'),
    headers: overrides.headers ?? {},
  }
}

describe('validateRequestParams', () => {
  const compiled = compileEndpointSchema(PARAMS_OP, 'sys/ep')

  it('passes when required params are present and typed correctly', () => {
    expect(compiled.validateRequestParams(paramsInput())).toEqual([])
  })

  it('coerces string values toward the declared type', () => {
    expect(compiled.validateRequestParams(paramsInput({ search: '?cursor=abc&limit=42' }))).toEqual([])
    const issues = compiled.validateRequestParams(paramsInput({ search: '?cursor=abc&limit=weeble' }))
    expect(issues).toEqual([{ path: 'query/limit', message: expect.stringMatching(/integer/) }])
  })

  it('applies schema constraints after coercion', () => {
    const issues = compiled.validateRequestParams(paramsInput({ search: '?cursor=abc&limit=500' }))
    expect(issues).toEqual([{ path: 'query/limit', message: expect.stringMatching(/100/) }])
  })

  it('validates repeated query keys as arrays, with item-level issue paths', () => {
    expect(compiled.validateRequestParams(paramsInput({ search: '?cursor=a&tag=aa&tag=bb' }))).toEqual([])
    // A single occurrence satisfies the array schema too (form + explode default).
    expect(compiled.validateRequestParams(paramsInput({ search: '?cursor=a&tag=aa' }))).toEqual([])
    const issues = compiled.validateRequestParams(paramsInput({ search: '?cursor=a&tag=aa&tag=x' }))
    expect(issues).toEqual([{ path: 'query/tag/1', message: expect.any(String) }])
  })

  it('flags a missing required param and skips missing optional ones', () => {
    const issues = compiled.validateRequestParams(paramsInput({ search: '' }))
    expect(issues).toEqual([{ path: 'query/cursor', message: 'required query parameter is missing' }])
  })

  it('treats path params as always required, even without required: true', () => {
    const c = compileEndpointSchema(
      { parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }] },
      'sys/ep',
    )
    expect(c.validateRequestParams({ pathParams: {}, query: new URLSearchParams(), headers: {} }))
      .toEqual([{ path: 'path/id', message: 'required path parameter is missing' }])
  })

  it('matches headers case-insensitively', () => {
    expect(compiled.validateRequestParams(paramsInput({ headers: { 'X-PRIORITY': 'high' } }))).toEqual([])
    const issues = compiled.validateRequestParams(paramsInput({ headers: { 'x-priority': 'urgent' } }))
    expect(issues).toEqual([{ path: 'header/x-priority', message: expect.any(String) }])
  })

  it('ignores cookie params and Accept/Content-Type/Authorization header params', () => {
    // "Accept" violates its declared enum and "session" is absent — both ignored.
    expect(compiled.validateRequestParams(paramsInput({ headers: { accept: 'text/html' } }))).toEqual([])
  })

  it('never rejects undeclared query params or headers', () => {
    expect(
      compiled.validateRequestParams(
        paramsInput({ search: '?cursor=a&undeclared=1', headers: { 'x-extra': 'v' } }),
      ),
    ).toEqual([])
  })

  it('returns [] when the operation declares no parameters', () => {
    expect(
      compileEndpointSchema(REQUEST_OP, 'sys/ep').validateRequestParams({
        pathParams: {},
        query: new URLSearchParams(),
        headers: {},
      }),
    ).toEqual([])
  })

  it('exposes declaredParams for startup cross-checks (header names lower-cased)', () => {
    const declared = compiled.declaredParams()
    expect(declared).toContainEqual({ location: 'path', name: 'thingId', required: true })
    expect(declared).toContainEqual({ location: 'query', name: 'limit', required: false })
    expect(declared).toContainEqual({ location: 'header', name: 'x-priority', required: false })
    expect(declared.some((p) => p.name === 'session' || p.name === 'accept')).toBe(false)
  })

  it('rejects malformed parameter entries at compile time', () => {
    expect(() => compileEndpointSchema({ parameters: 'nope' }, 'sys/ep')).toThrow(SchemaCompileError)
    expect(() => compileEndpointSchema({ parameters: [{ in: 'query' }] }, 'sys/ep')).toThrow(/name/)
    expect(() => compileEndpointSchema({ parameters: [{ name: 'x', in: 'body' }] }, 'sys/ep')).toThrow(/"in"/)
    expect(() =>
      compileEndpointSchema(
        { parameters: [{ name: 'x', in: 'query', schema: { type: 'not-a-type' } }] },
        'sys/ep',
      ),
    ).toThrow(/parameters\[0\]/)
  })
})
