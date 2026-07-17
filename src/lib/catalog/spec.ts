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
  return nodes
}

export function bundleOperation(
  operation: Record<string, unknown>,
  componentsSchemas: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  const op = clone(operation)
  const seen = new Set<string>()

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
