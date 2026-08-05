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

export type ParamLocation = 'path' | 'query' | 'header'

export interface DeclaredParam {
  location: ParamLocation
  name: string
  required: boolean
}

/** Structural subset of the router's RequestContext, so `ctx` passes directly. */
export interface RequestParamsInput {
  pathParams: Record<string, string>
  query: URLSearchParams
  headers: Record<string, string>
}

// OpenAPI: header parameters named Accept, Content-Type, or Authorization are
// ignored. The first two are HTTP mechanics, not API surface; the last is a
// credential this codebase refuses to touch anywhere else.
const IGNORED_HEADER_PARAMS = new Set(['accept', 'content-type', 'authorization'])

interface ParameterObject {
  name?: unknown
  in?: unknown
  required?: unknown
  schema?: unknown
}

interface CompiledParam {
  location: ParamLocation
  /** Header names are lower-cased at compile time; lookup is case-insensitive. */
  name: string
  required: boolean
  validate: ValidateFunction | null
}

interface MediaTypeObject {
  schema?: unknown
}

interface OperationObject {
  parameters?: unknown
  requestBody?: { required?: boolean; content?: Record<string, MediaTypeObject> }
  responses?: Record<string, { content?: Record<string, MediaTypeObject> }>
}

export interface CompiledEndpointSchema {
  validateRequestBody(body: unknown): SchemaIssue[]
  /** Validate declared `parameters` (path/query/header) against the request.
   *  Values arrive as strings and are validated with type coercion, so
   *  "42" satisfies `type: integer`. Issue paths are location-prefixed
   *  (`query/limit`), never colliding with body JSON pointers (`/amount`). */
  validateRequestParams(input: RequestParamsInput): SchemaIssue[]
  /** The operation's declared, non-ignored parameters, for startup cross-checks. */
  declaredParams(): DeclaredParam[]
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

  // Parameter values (path/query/header) arrive as strings, so they validate
  // through a second Ajv instance with type coercion: "42" satisfies
  // `type: integer`, and single values wrap to one-element arrays (and back)
  // as the schema demands — OpenAPI's default query serialization. The body
  // instance above must stay coercion-free: bodies are real JSON and a string
  // "42" must NOT satisfy an integer body field.
  const paramAjv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: 'array' })
  addFormats(paramAjv)

  const compile = (schema: unknown, where: string, instance = ajv): ValidateFunction => {
    try {
      return instance.compile(schema as object)
    } catch (err) {
      throw new SchemaCompileError(
        `${label}: invalid JSON Schema in ${where}: ${(err as Error).message}`,
      )
    }
  }

  const requestSchema = jsonSchema(op.requestBody?.content)
  const validateRequest = requestSchema !== undefined ? compile(requestSchema, 'requestBody') : null
  const requestRequired = op.requestBody?.required === true

  const params: CompiledParam[] = []
  if (op.parameters !== undefined) {
    if (!Array.isArray(op.parameters)) {
      throw new SchemaCompileError(`${label}: "parameters" must be an array`)
    }
    op.parameters.forEach((entry: unknown, i: number) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new SchemaCompileError(`${label}: parameters[${i}] must be an object`)
      }
      const p = entry as ParameterObject
      if (typeof p.name !== 'string' || p.name.length === 0) {
        throw new SchemaCompileError(`${label}: parameters[${i}] is missing a "name"`)
      }
      if (p.in !== 'path' && p.in !== 'query' && p.in !== 'header' && p.in !== 'cookie') {
        throw new SchemaCompileError(
          `${label}: parameters[${i}] ("${p.name}") needs "in": path, query, header, or cookie`,
        )
      }
      // Cookies are never parsed by the mock server; the three header names
      // are ignored per OpenAPI. Both are skipped wholesale, not validated.
      if (p.in === 'cookie') return
      const name = p.in === 'header' ? p.name.toLowerCase() : p.name
      if (p.in === 'header' && IGNORED_HEADER_PARAMS.has(name)) return
      params.push({
        location: p.in,
        name,
        // OpenAPI mandates required: true on path params; enforce it even
        // when the author omitted the field.
        required: p.in === 'path' ? true : p.required === true,
        validate:
          p.schema !== undefined
            ? compile(p.schema, `parameters[${i}] ("${p.name}")`, paramAjv)
            : null,
      })
    })
  }

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
    validateRequestParams(input: RequestParamsInput): SchemaIssue[] {
      const issues: SchemaIssue[] = []
      for (const p of params) {
        const value = paramValue(p, input)
        if (value === undefined) {
          if (p.required) {
            issues.push({
              path: `${p.location}/${p.name}`,
              message: `required ${p.location} parameter is missing`,
            })
          }
          continue
        }
        if (!p.validate) continue
        p.validate(value)
        for (const e of p.validate.errors ?? []) {
          issues.push({
            path: `${p.location}/${p.name}${e.instancePath}`,
            message: e.message ?? 'invalid',
          })
        }
      }
      return issues
    },
    declaredParams(): DeclaredParam[] {
      return params.map(({ location, name, required }) => ({ location, name, required }))
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

// A parameter's raw value, or undefined when the request does not carry it.
// One query occurrence stays a scalar so `coerceTypes: 'array'` can bridge it
// toward either a scalar or an array schema; repeats are already an array.
// Values passed in are strings / fresh arrays, so Ajv's in-place coercion
// never mutates request state the router later reads.
function paramValue(
  p: CompiledParam,
  input: RequestParamsInput,
): string | string[] | undefined {
  if (p.location === 'path') return input.pathParams[p.name]
  if (p.location === 'query') {
    const all = input.query.getAll(p.name)
    return all.length === 0 ? undefined : all.length === 1 ? all[0] : all
  }
  for (const [key, value] of Object.entries(input.headers)) {
    if (key.toLowerCase() === p.name) return value
  }
  return undefined
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
