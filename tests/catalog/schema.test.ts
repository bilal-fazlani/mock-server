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
              scenarios: { default: 'Success' },
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
