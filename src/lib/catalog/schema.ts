import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import type { Catalog } from './types'

export class SchemaCompileError extends Error {}

export interface SchemaIssue {
  path: string
  message: string
}

export type SchemaRegistry = Map<string, CompiledEndpointSchema>

export function schemaKey(systemSlug: string, endpointName: string): string {
  return `${systemSlug}/${endpointName}`
}

const PLACEHOLDER_RE = /\{\{.+?\}\}/

interface MediaTypeObject {
  schema?: unknown
}

interface OperationObject {
  requestBody?: { required?: boolean; content?: Record<string, MediaTypeObject> }
  responses?: Record<string, { content?: Record<string, MediaTypeObject> }>
}

export interface CompiledEndpointSchema {
  validateRequestBody(body: unknown): SchemaIssue[]
  hasResponseFor(status: number): boolean
  validateResponseBody(status: number, body: unknown): SchemaIssue[]
  /** Like validateResponseBody, but placeholder-valued nodes are wildcards
   *  and an unmatched status returns [] (reported separately at startup). */
  validateFixtureBody(status: number, body: unknown): SchemaIssue[]
  /**
   * Does the request body schema *guarantee* a value at this selector path is
   * present? (#27) Tri-state, and deliberately conservative:
   *   - `true`  — every segment is in its parent's `required`, plain object
   *               parents throughout: a caller cannot omit it.
   *   - `false` — reachable but provably optional under plain
   *               object/`required`/`properties`: a caller *can* omit it, so a
   *               fixture reading it with no fallback will 500 on those requests.
   *   - `undefined` — cannot decide (no request schema, any combinator, a
   *               non-object parent, an array-index segment, or a `$ref` shape
   *               other than a resolvable same-document `#/$defs/<name>`).
   * Only `false` is actionable; `undefined` means "skip, stay silent".
   */
  guaranteesPresence(segments: Array<string | number>): boolean | undefined
}

function jsonSchema(content: Record<string, MediaTypeObject> | undefined): unknown {
  return content?.['application/json']?.schema
}

function toIssues(errors: ErrorObject[]): SchemaIssue[] {
  return errors.map((e) => ({ path: e.instancePath || '/', message: e.message ?? 'invalid' }))
}

export function compileEndpointSchema(raw: unknown, label: string): CompiledEndpointSchema {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SchemaCompileError(
      `${label}: _schema.json must be a JSON object (an OpenAPI 3.1 operation object)`,
    )
  }
  const op = raw as OperationObject
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)

  const compile = (schema: unknown, where: string): ValidateFunction => {
    try {
      return ajv.compile(schema as object)
    } catch (err) {
      throw new SchemaCompileError(
        `${label}: invalid JSON Schema in ${where}: ${(err as Error).message}`,
      )
    }
  }

  const requestSchema = jsonSchema(op.requestBody?.content)
  const validateRequest = requestSchema !== undefined ? compile(requestSchema, 'requestBody') : null
  const requestRequired = op.requestBody?.required === true

  const responses: Array<{ key: string; validate: ValidateFunction }> = []
  for (const [key, res] of Object.entries(op.responses ?? {})) {
    const schema = jsonSchema(res?.content)
    if (schema !== undefined) responses.push({ key, validate: compile(schema, `responses.${key}`) })
  }

  const responseFor = (status: number): ValidateFunction | null => {
    const exact = responses.find((r) => r.key === String(status))
    if (exact) return exact.validate
    const range = responses.find((r) => r.key.toUpperCase() === `${Math.floor(status / 100)}XX`)
    if (range) return range.validate
    return responses.find((r) => r.key === 'default')?.validate ?? null
  }

  return {
    validateRequestBody(body: unknown): SchemaIssue[] {
      if (!validateRequest) return []
      if (body === null) {
        return requestRequired ? [{ path: '/', message: 'request body is required' }] : []
      }
      validateRequest(body)
      return toIssues(validateRequest.errors ?? [])
    },
    hasResponseFor(status: number): boolean {
      return responseFor(status) !== null
    },
    validateResponseBody(status: number, body: unknown): SchemaIssue[] {
      const validate = responseFor(status)
      if (!validate) {
        return [{ path: '/', message: `no response schema declared for status ${status}` }]
      }
      validate(body)
      return toIssues(validate.errors ?? [])
    },
    validateFixtureBody(status: number, body: unknown): SchemaIssue[] {
      const validate = responseFor(status)
      if (!validate) return []
      validate(body)
      const errors = (validate.errors ?? []).filter(
        (e) => !isPlaceholderValue(valueAtPointer(body, e.instancePath)),
      )
      return toIssues(errors)
    },
    guaranteesPresence(segments: Array<string | number>): boolean | undefined {
      return guaranteesPresence(requestSchema, segments)
    },
  }
}

function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// Combinators and conditional keywords whose presence means we cannot decide
// required-ness by a plain `required`/`properties` walk (#27). Seeing any of
// them makes the walk return undefined (skip) rather than guess.
const COMBINATOR_KEYS = [
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'dependentRequired', 'dependentSchemas', 'patternProperties',
]

// Follow a chain of plain same-document `#/$defs/<name>` refs to the schema
// object they name, resolving against the request-schema root's `$defs` (the
// spec loader attaches `$defs` there). Returns undefined — meaning "undecidable,
// skip" — for a ref with adjacent schema keywords (2020-12 merges those, which
// this walk won't attempt), a non-`#/$defs/` ref shape, an unknown name, or a
// reference cycle.
function deref(
  node: unknown,
  defs: Record<string, unknown>,
  seen: Set<string>,
): Record<string, unknown> | undefined {
  let cur = node
  while (isObjectRecord(cur) && '$ref' in cur) {
    const adjacent = Object.keys(cur).filter(
      (k) => k !== '$ref' && k !== '$defs' && k !== 'title' && k !== 'description',
    )
    if (adjacent.length > 0) return undefined
    const ref = cur.$ref
    if (typeof ref !== 'string') return undefined
    const m = /^#\/\$defs\/(.+)$/.exec(ref)
    if (!m) return undefined
    const name = m[1]
    if (seen.has(name)) return undefined
    seen.add(name)
    cur = defs[name]
  }
  return isObjectRecord(cur) ? cur : undefined
}

function guaranteesPresence(
  requestSchema: unknown,
  segments: Array<string | number>,
): boolean | undefined {
  if (!isObjectRecord(requestSchema)) return undefined
  const defs = isObjectRecord(requestSchema.$defs) ? requestSchema.$defs : {}
  let node: unknown = requestSchema
  for (const seg of segments) {
    const schema = deref(node, defs, new Set())
    if (schema === undefined) return undefined
    if (COMBINATOR_KEYS.some((k) => k in schema)) return undefined
    // A non-object parent can't have a named property; an array index is never
    // guaranteed present. Either way we can't prove presence — skip.
    if (typeof seg === 'number') return undefined
    if ('type' in schema && schema.type !== 'object') return undefined
    const required = Array.isArray(schema.required) ? schema.required : []
    if (!required.includes(seg)) return false
    node = isObjectRecord(schema.properties) ? schema.properties[seg] : undefined
  }
  return true
}

function isPlaceholderValue(v: unknown): boolean {
  return typeof v === 'string' && PLACEHOLDER_RE.test(v)
}

// Resolves an Ajv instancePath (RFC 6901 JSON pointer) against the document.
function valueAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root
  let cur: unknown = root
  for (const seg of pointer.slice(1).split('/')) {
    const key = seg.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(cur)) cur = cur[Number(key)]
    else if (cur !== null && typeof cur === 'object') cur = (cur as Record<string, unknown>)[key]
    else return undefined
  }
  return cur
}

export function buildSchemaRegistry(catalog: Catalog): {
  schemas: SchemaRegistry
  errors: string[]
} {
  const schemas: SchemaRegistry = new Map()
  const errors: string[] = []
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      if (endpoint.schema === undefined) continue
      try {
        schemas.set(
          schemaKey(system.slug, endpoint.name),
          compileEndpointSchema(endpoint.schema, `${system.name}/${endpoint.name}`),
        )
      } catch (err) {
        if (err instanceof SchemaCompileError) errors.push(err.message)
        else throw err
      }
    }
  }
  return { schemas, errors }
}
