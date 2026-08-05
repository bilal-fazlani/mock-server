// tests/catalog/spec.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SpecError, bundleOperation, findSpecFile, parseSpec, resolveEndpointSchema } from '../../src/lib/catalog/spec'
import { compileEndpointSchema } from '../../src/lib/catalog/schema'

const responseOp = (schema: unknown) => ({
  responses: { '200': { content: { 'application/json': { schema } } } },
})

describe('bundleOperation', () => {
  it('rewrites a component ref to $defs and attaches the definition', () => {
    const bundled = bundleOperation(
      responseOp({ $ref: '#/components/schemas/Res' }),
      { Res: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } },
      'sys/ep',
    )
    expect(bundled).toEqual({
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                $ref: '#/$defs/Res',
                $defs: {
                  Res: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
                },
              },
            },
          },
        },
      },
    })
  })

  it('rewrites transitive refs inside copied definitions', () => {
    const bundled = bundleOperation(
      responseOp({ $ref: '#/components/schemas/Foo' }),
      {
        Foo: { type: 'object', properties: { bar: { $ref: '#/components/schemas/Bar' } } },
        Bar: { type: 'string' },
      },
      'sys/ep',
    )
    expect(bundled).toEqual({
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                $ref: '#/$defs/Foo',
                $defs: {
                  Foo: { type: 'object', properties: { bar: { $ref: '#/$defs/Bar' } } },
                  Bar: { type: 'string' },
                },
              },
            },
          },
        },
      },
    })
  })

  it('leaves an inline schema untouched and attaches no $defs when there are no components', () => {
    const bundled = bundleOperation(responseOp({ type: 'object' }), {}, 'sys/ep')
    expect(bundled).toEqual({
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      },
    })
  })

  it('throws on a ref to a missing schema', () => {
    expect(() => bundleOperation(responseOp({ $ref: '#/components/schemas/Missing' }), {}, 'sys/ep'))
      .toThrow(SpecError)
    expect(() => bundleOperation(responseOp({ $ref: '#/components/schemas/Missing' }), {}, 'sys/ep'))
      .toThrow(/unknown schema/)
  })

  it('throws on an external / unsupported ref', () => {
    const op = { requestBody: { content: { 'application/json': { schema: { $ref: './other.yaml#/X' } } } } }
    expect(() => bundleOperation(op, {}, 'sys/ep')).toThrow(/unsupported \$ref/)
  })

  it('is cycle-safe with mutually recursive schemas (does not infinite-loop)', () => {
    const bundled = bundleOperation(
      responseOp({ $ref: '#/components/schemas/Node' }),
      {
        Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } },
      },
      'sys/ep',
    )
    expect(bundled).toEqual({
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                $ref: '#/$defs/Node',
                $defs: {
                  Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } },
                },
              },
            },
          },
        },
      },
    })
  })

  it('produces a schema Ajv can compile and resolve through refs', () => {
    const compiled = compileEndpointSchema(
      bundleOperation(
        responseOp({ $ref: '#/components/schemas/Res' }),
        { Res: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
        'sys/ep',
      ),
      'sys/ep',
    )
    expect(compiled.validateResponseBody(200, { id: 'x' })).toEqual([])
    expect(compiled.validateResponseBody(200, {}).length).toBeGreaterThan(0)
  })
})

const specTmp: string[] = []
afterEach(() => {
  while (specTmp.length) fs.rmSync(specTmp.pop()!, { recursive: true, force: true })
})
function tmpDirWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-'))
  specTmp.push(dir)
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  return dir
}

describe('parseSpec', () => {
  it('parses YAML paths and component schemas', () => {
    const spec = parseSpec(
      ['paths:', '  /a:', '    get:', '      responses: {}', 'components:', '  schemas:', '    Foo:', '      type: string'].join('\n'),
      'sys/_spec.yaml',
    )
    expect(spec.paths['/a'].get).toEqual({ responses: {} })
    expect(spec.componentsSchemas.Foo).toEqual({ type: 'string' })
  })

  it('parses JSON (a subset of YAML)', () => {
    const spec = parseSpec('{"paths":{"/a":{"get":{"responses":{}}}}}', 'sys/_spec.json')
    expect(spec.paths['/a'].get).toEqual({ responses: {} })
    expect(spec.componentsSchemas).toEqual({})
  })

  it('throws when the document is not an object', () => {
    expect(() => parseSpec('- 1\n- 2', 'sys/_spec.yaml')).toThrow(SpecError)
    expect(() => parseSpec('42', 'sys/_spec.yaml')).toThrow(/must be a YAML\/JSON object/)
  })
})

describe('findSpecFile', () => {
  it('returns the single spec file, or null when absent', () => {
    const withYaml = tmpDirWith({ '_spec.yaml': 'paths: {}' })
    expect(findSpecFile(withYaml)).toBe(path.join(withYaml, '_spec.yaml'))
    expect(findSpecFile(tmpDirWith({}))).toBeNull()
  })

  it('throws when more than one spec file is present', () => {
    const dir = tmpDirWith({ '_spec.yaml': 'paths: {}', '_spec.json': '{"paths":{}}' })
    expect(() => findSpecFile(dir)).toThrow(/multiple spec files/)
  })
})

describe('resolveEndpointSchema', () => {
  const spec = parseSpec(
    ['paths:', '  /a:', '    post:', '      responses:', '        "200":', '          content:', '            application/json:', '              schema:', '                type: object'].join('\n'),
    'sys/_spec.yaml',
  )
  it('bundles the matched operation and lowercases the method', () => {
    const schema = resolveEndpointSchema(spec, 'POST', '/a', 'sys/ep')
    expect(schema).toEqual({
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      },
    })
  })
  it('returns null when the path or method is absent', () => {
    expect(resolveEndpointSchema(spec, 'GET', '/a', 'sys/ep')).toBeNull()
    expect(resolveEndpointSchema(spec, 'POST', '/missing', 'sys/ep')).toBeNull()
  })
})

describe('parameter schemas', () => {
  it('rewrites refs inside parameter schemas and attaches $defs', () => {
    const op = {
      parameters: [{ name: 'limit', in: 'query', schema: { $ref: '#/components/schemas/Limit' } }],
    }
    const bundled = bundleOperation(op, { Limit: { type: 'integer' } }, 'sys/ep')
    const schema = (bundled.parameters as Array<{ schema: Record<string, unknown> }>)[0].schema
    expect(schema.$ref).toBe('#/$defs/Limit')
    expect((schema.$defs as Record<string, unknown>).Limit).toEqual({ type: 'integer' })
  })

  it('compiles through compileEndpointSchema and validates via the ref', () => {
    const op = {
      parameters: [
        { name: 'limit', in: 'query', required: true, schema: { $ref: '#/components/schemas/Limit' } },
      ],
    }
    const compiled = compileEndpointSchema(
      bundleOperation(op, { Limit: { type: 'integer' } }, 'sys/ep'),
      'sys/ep',
    )
    const input = (search: string) => ({
      pathParams: {},
      query: new URLSearchParams(search),
      headers: {},
    })
    expect(compiled.validateRequestParams(input('limit=7'))).toEqual([])
    expect(compiled.validateRequestParams(input('limit=x')))
      .toEqual([{ path: 'query/limit', message: expect.stringMatching(/integer/) }])
  })

  it('throws a targeted error on a $ref in place of a parameter object', () => {
    const op = { parameters: [{ $ref: '#/components/parameters/Limit' }] }
    expect(() => bundleOperation(op, {}, 'sys/ep')).toThrow(SpecError)
    expect(() => bundleOperation(op, {}, 'sys/ep')).toThrow(/parameters/)
  })

  it('merges path-item parameters under the operation; operation wins on (name, in)', () => {
    const spec = parseSpec(
      [
        'paths:',
        '  /things/{thingId}:',
        '    parameters:',
        '      - name: thingId',
        '        in: path',
        '        required: true',
        '        schema: { type: string }',
        '      - name: limit',
        '        in: query',
        '        schema: { type: integer }',
        '    get:',
        '      parameters:',
        '        - name: limit',
        '          in: query',
        '          schema: { type: string }',
        '      responses: {}',
      ].join('\n'),
      'sys/_spec.yaml',
    )
    const op = resolveEndpointSchema(spec, 'GET', '/things/{thingId}', 'sys/ep')
    expect(op?.parameters).toEqual([
      { name: 'thingId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'string' } },
    ])
  })
})
