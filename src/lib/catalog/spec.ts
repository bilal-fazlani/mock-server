import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export class SpecError extends Error {}

const COMPONENTS_PREFIX = '#/components/schemas/'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// Deep-walk a JSON value, rewriting every {$ref} in place. Refs under
// #/components/schemas/ become #/$defs/ and their schema name is recorded in
// `seen`; any other $ref is a SpecError.
function rewriteRefs(node: unknown, label: string, seen: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item, label, seen)
    return
  }
  if (node === null || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  const ref = obj.$ref
  if (typeof ref === 'string') {
    if (!ref.startsWith(COMPONENTS_PREFIX)) {
      throw new SpecError(
        `${label}: unsupported $ref "${ref}" — only in-document ` +
          `"#/components/schemas/…" references are supported`,
      )
    }
    const rest = ref.slice(COMPONENTS_PREFIX.length)
    seen.add(rest.split('/')[0])
    obj.$ref = `#/$defs/${rest}`
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref') continue
    rewriteRefs(value, label, seen)
  }
}

function jsonSchemaNodes(op: Record<string, unknown>): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  const push = (schema: unknown) => {
    if (schema !== null && typeof schema === 'object' && !Array.isArray(schema)) {
      nodes.push(schema as Record<string, unknown>)
    }
  }
  const jsonSchema = (content: unknown): unknown =>
    (content as Record<string, { schema?: unknown }> | undefined)?.['application/json']?.schema
  const requestBody = op.requestBody as { content?: unknown } | undefined
  push(jsonSchema(requestBody?.content))
  const responses = (op.responses ?? {}) as Record<string, { content?: unknown }>
  for (const res of Object.values(responses)) push(jsonSchema(res?.content))
  const params = op.parameters
  if (Array.isArray(params)) {
    for (const p of params) push((p as { schema?: unknown } | null)?.schema)
  }
  return nodes
}

export function bundleOperation(
  operation: Record<string, unknown>,
  componentsSchemas: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const op = clone(operation)
  const seen = new Set<string>()

  // A $ref in place of a parameter object (#/components/parameters/…) is not
  // supported — only schema refs are. Catch it here with a targeted message
  // rather than letting compileEndpointSchema fail on a missing name/in later.
  if (Array.isArray(op.parameters)) {
    for (const p of op.parameters) {
      if (p !== null && typeof p === 'object' && '$ref' in p) {
        throw new SpecError(
          `${label}: unsupported $ref in "parameters" — write parameter objects inline ` +
            `(only "#/components/schemas/…" refs inside a parameter's "schema" are supported)`,
        )
      }
    }
  }

  const nodes = jsonSchemaNodes(op)
  for (const node of nodes) rewriteRefs(node, label, seen)

  const defs = clone(componentsSchemas)
  for (const def of Object.values(defs)) rewriteRefs(def, label, seen)

  for (const name of seen) {
    if (!(name in defs)) {
      throw new SpecError(`${label}: $ref to unknown schema "#/components/schemas/${name}"`)
    }
  }

  if (Object.keys(defs).length > 0) {
    for (const node of nodes) node.$defs = defs
  }
  return op
}

export interface ParsedSpec {
  paths: Record<string, Record<string, unknown>>
  componentsSchemas: Record<string, unknown>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseSpec(text: string, label: string): ParsedSpec {
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch (err) {
    throw new SpecError(`${label}: not valid YAML/JSON: ${(err as Error).message}`)
  }
  if (!isObject(doc)) {
    throw new SpecError(`${label}: spec must be a YAML/JSON object`)
  }
  const paths = isObject(doc.paths)
    ? (doc.paths as Record<string, Record<string, unknown>>)
    : {}
  const components = isObject(doc.components) ? doc.components : {}
  const componentsSchemas = isObject(components.schemas) ? components.schemas : {}
  return { paths, componentsSchemas }
}

const SPEC_NAMES = ['_spec.yaml', '_spec.yml', '_spec.json']

export function findSpecFile(systemDir: string): string | null {
  const present = SPEC_NAMES.filter((name) => fs.existsSync(path.join(systemDir, name)))
  if (present.length > 1) {
    throw new SpecError(
      `system spec: multiple spec files (${present.join(', ')}) — keep only one`,
    )
  }
  return present.length === 1 ? path.join(systemDir, present[0]) : null
}

// OpenAPI allows `parameters` on the path item, shared by all its operations;
// an operation-level parameter overrides a path-level one with the same
// (name, in). Merge here so bundleOperation and compileEndpointSchema only
// ever see one flat operation-level list.
function mergePathParameters(
  operation: Record<string, unknown>,
  pathItem: Record<string, unknown>,
): Record<string, unknown> {
  const pathParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
  if (pathParams.length === 0) return operation
  const opParams = Array.isArray(operation.parameters) ? operation.parameters : []
  const key = (p: unknown): string | null => {
    if (p === null || typeof p !== 'object') return null
    const { name, in: loc } = p as { name?: unknown; in?: unknown }
    return typeof name === 'string' && typeof loc === 'string' ? `${loc} ${name}` : null
  }
  const overridden = new Set(opParams.map(key).filter((k): k is string => k !== null))
  const inherited = pathParams.filter((p) => {
    const k = key(p)
    return k === null || !overridden.has(k)
  })
  return { ...operation, parameters: [...inherited, ...opParams] }
}

// `endpointPath` (not `path`) avoids shadowing the imported `node:path` module.
export function resolveEndpointSchema(
  spec: ParsedSpec,
  method: string,
  endpointPath: string,
  label: string,
): Record<string, unknown> | null {
  const pathItem = spec.paths[endpointPath]
  if (!isObject(pathItem)) return null
  const operation = pathItem[method.toLowerCase()]
  if (!isObject(operation)) return null
  return bundleOperation(mergePathParameters(operation, pathItem), spec.componentsSchemas, label)
}
