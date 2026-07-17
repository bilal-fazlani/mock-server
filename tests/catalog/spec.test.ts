// tests/catalog/spec.test.ts
import { describe, expect, it } from 'vitest'
import { SpecError, bundleOperation } from '../../src/lib/catalog/spec'
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
    ) as any
    const schema = bundled.responses['200'].content['application/json'].schema
    expect(schema.$ref).toBe('#/$defs/Res')
    expect(schema.$defs.Res.required).toEqual(['ok'])
  })

  it('rewrites transitive refs inside copied definitions', () => {
    const bundled = bundleOperation(
      responseOp({ $ref: '#/components/schemas/Foo' }),
      {
        Foo: { type: 'object', properties: { bar: { $ref: '#/components/schemas/Bar' } } },
        Bar: { type: 'string' },
      },
      'sys/ep',
    ) as any
    const schema = bundled.responses['200'].content['application/json'].schema
    expect(schema.$defs.Foo.properties.bar.$ref).toBe('#/$defs/Bar')
    expect(schema.$defs.Bar).toEqual({ type: 'string' })
  })

  it('leaves an inline schema untouched and attaches no $defs when there are no components', () => {
    const bundled = bundleOperation(responseOp({ type: 'object' }), {}, 'sys/ep') as any
    expect(bundled.responses['200'].content['application/json'].schema).toEqual({ type: 'object' })
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
    ) as any
    const schema = bundled.responses['200'].content['application/json'].schema
    expect(schema.$ref).toBe('#/$defs/Node')
    expect(schema.$defs.Node.properties.next.$ref).toBe('#/$defs/Node')
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
