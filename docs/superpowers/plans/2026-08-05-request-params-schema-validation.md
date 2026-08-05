# Request parameter (path/query/header) schema validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend schema verification beyond the JSON body: validate **path params, query params, and headers** against OpenAPI `parameters` declared in an endpoint's `_schema.json` or resolved from a system `_spec` file. Mocked scenarios reject violations with the existing 400 flow; `real` passthrough records the existing warn-only `drift_warning`; a declared `in: path` parameter that doesn't exist in the endpoint's path template becomes a startup error.

**Architecture:** `compileEndpointSchema` (`src/lib/catalog/schema.ts`) gains a second Ajv instance with `coerceTypes: 'array'` (parameter values arrive as strings; bodies must stay strictly typed) and two new methods on `CompiledEndpointSchema`: `validateRequestParams(input)` and `declaredParams()`. The spec loader (`src/lib/catalog/spec.ts`) starts bundling `$ref`s inside `parameters[].schema` and merges **path-item-level** `parameters` into each operation (operation entries win on the same `name` + `in`). The router already holds `pathParams`/`query`/`headers` on `RequestContext` at the exact validation point, so runtime wiring is three small edits in `src/lib/router/route-request.ts`. Because `loadCatalog` funnels both `_schema.json` files and `_spec`-resolved operations into the same `EndpointDef.schema` field, implementing in `compileEndpointSchema` gives both sources the feature at once.

**Tech Stack:** TypeScript, Node ≥22, Ajv 2020 (`ajv/dist/2020`) + `ajv-formats`, Vitest. **No new dependencies.**

## Global Constraints

- **The body/response Ajv instance stays coercion-free.** Only the new parameter instance sets `coerceTypes: 'array'`. A string `"42"` must keep failing an integer **body** field; it must start passing an integer **query** field.
- **Supported locations: `path`, `query`, `header`.** `in: cookie` parameters are skipped (the server never parses cookies). Header parameters named `Accept`, `Content-Type`, or `Authorization` are ignored, per OpenAPI.
- **Never reject undeclared extras.** A query param or header the schema doesn't declare passes untouched — OpenAPI has no closed-world semantics for parameters, and real callers send tracing headers.
- **Serialization: defaults only.** Repeated query keys (`?tag=a&tag=b`) validate as arrays; a single occurrence satisfies a scalar or an array schema (`coerceTypes: 'array'` bridges both — this is OpenAPI's default `form` + `explode`). `style`/`explode`/`deepObject` etc. are not interpreted. A parameter declared with `content` instead of `schema` gets only its `required` presence checked.
- **Issue-path convention:** parameter issues are prefixed with their location — `query/limit`, `header/x-priority`, `path/thingId` (plus Ajv's instancePath for array items, e.g. `query/tag/1`). Body issues keep their plain JSON-pointer paths (`/amount`), so the two never collide.
- **The mocked-path 400 error string changes** from `request body does not match schema` to `request does not match schema` (one `details` array now carries body *and* parameter issues). Exactly two existing test assertions and one docs mermaid label reference the old string — this plan updates all three.
- **`EndpointDef.schema` stays a raw `Record<string, unknown>`** and `buildSchemaRegistry` is unchanged.
- **Out of scope (do not implement):** extending the #27 `guaranteesPresence` fixture-fallback analysis to `path:`/`query:`/`header:` selectors, response-header schemas, `$ref` to `#/components/parameters/…` (a targeted error instead), and `in: cookie` validation.
- **Before every commit** run the repo gate from `AGENTS.md`: `npm run typecheck && npm test && npm run lint` (plus `npm run build` at the end — Task 6). CI does not run lint.

---

### Task 1: Parameter compilation + `validateRequestParams` (`schema.ts`)

The core: parse `op.parameters`, compile each `schema` with a coercing Ajv instance, and expose `validateRequestParams` / `declaredParams` on `CompiledEndpointSchema`. Everything downstream (router, validator, both schema sources) builds on this.

**Files:**
- Modify: `src/lib/catalog/schema.ts`
- Test: `tests/catalog/schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from `src/lib/catalog/schema.ts`):
  - `type ParamLocation = 'path' | 'query' | 'header'`
  - `interface DeclaredParam { location: ParamLocation; name: string; required: boolean }`
  - `interface RequestParamsInput { pathParams: Record<string, string>; query: URLSearchParams; headers: Record<string, string> }` — deliberately a structural subset of the router's `RequestContext`, so `ctx` can be passed directly.
  - On `CompiledEndpointSchema`: `validateRequestParams(input: RequestParamsInput): SchemaIssue[]` and `declaredParams(): DeclaredParam[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/catalog/schema.test.ts` (top-level, after the existing `validateRequestBody` describe; `compileEndpointSchema`, `SchemaCompileError`, and `REQUEST_OP` are already in scope):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/catalog/schema.test.ts`
Expected: FAIL — `validateRequestParams is not a function` (and the malformed-entry cases don't throw).

- [ ] **Step 3: Implement in `src/lib/catalog/schema.ts`**

Add after the `PLACEHOLDER_RE` constant:

```ts
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
```

Add `parameters?: unknown` to the existing `OperationObject` interface:

```ts
interface OperationObject {
  parameters?: unknown
  requestBody?: { required?: boolean; content?: Record<string, MediaTypeObject> }
  responses?: Record<string, { content?: Record<string, MediaTypeObject> }>
}
```

Extend the `CompiledEndpointSchema` interface — add these two members after `validateRequestBody`:

```ts
  /** Validate declared `parameters` (path/query/header) against the request.
   *  Values arrive as strings and are validated with type coercion, so
   *  "42" satisfies `type: integer`. Issue paths are location-prefixed
   *  (`query/limit`), never colliding with body JSON pointers (`/amount`). */
  validateRequestParams(input: RequestParamsInput): SchemaIssue[]
  /** The operation's declared, non-ignored parameters, for startup cross-checks. */
  declaredParams(): DeclaredParam[]
```

In `compileEndpointSchema`, immediately after `addFormats(ajv)`, add the second instance:

```ts
  // Parameter values (path/query/header) arrive as strings, so they validate
  // through a second Ajv instance with type coercion: "42" satisfies
  // `type: integer`, and single values wrap to one-element arrays (and back)
  // as the schema demands — OpenAPI's default query serialization. The body
  // instance above must stay coercion-free: bodies are real JSON and a string
  // "42" must NOT satisfy an integer body field.
  const paramAjv = new Ajv2020({ strict: false, allErrors: true, coerceTypes: 'array' })
  addFormats(paramAjv)
```

Change the `compile` helper's signature to take an optional instance (body/response call sites stay as they are):

```ts
  const compile = (schema: unknown, where: string, instance = ajv): ValidateFunction => {
    try {
      return instance.compile(schema as object)
    } catch (err) {
      throw new SchemaCompileError(
        `${label}: invalid JSON Schema in ${where}: ${(err as Error).message}`,
      )
    }
  }
```

After the `const requestRequired = …` line, parse the parameters:

```ts
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
```

Add the two methods to the returned object (after `validateRequestBody`):

```ts
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
```

Add the module-level helper (next to `isPlaceholderValue` / `valueAtPointer`):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/schema.test.ts`
Expected: PASS — all new blocks plus every pre-existing test (the `parameters: []` case in "ignores extra OpenAPI fields" stays green: an empty array compiles to zero params).

- [ ] **Step 5: Gate + commit**

```bash
npm run typecheck && npx vitest run && npm run lint
git add src/lib/catalog/schema.ts tests/catalog/schema.test.ts
git commit -m "feat(catalog): compile and validate OpenAPI request parameters"
```

---

### Task 2: Spec loader — bundle parameter schemas, merge path-item parameters (`spec.ts`)

Spec-sourced operations must behave identically to `_schema.json`: `$ref`s inside `parameters[].schema` need the same `#/$defs/…` rewrite + `$defs` attachment, and OpenAPI's path-item-level `parameters` (shared across a path's methods) must be merged into each operation.

**Files:**
- Modify: `src/lib/catalog/spec.ts`
- Test: `tests/catalog/spec.test.ts`

**Interfaces:**
- Consumes: `validateRequestParams` from Task 1 (test-only, to prove refs resolve end-to-end).
- Produces: no new exports — `bundleOperation` and `resolveEndpointSchema` change behavior:
  - `bundleOperation` also rewrites refs in `parameters[].schema` nodes and throws `SpecError` on a `$ref` *in place of* a parameter object.
  - `resolveEndpointSchema` merges path-item `parameters` into the operation before bundling; an operation-level entry overrides a path-level one with the same (`name`, `in`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/catalog/spec.test.ts` (all needed imports — `bundleOperation`, `SpecError`, `parseSpec`, `resolveEndpointSchema`, `compileEndpointSchema` — are already imported at the top of the file):

```ts
describe('parameter schemas', () => {
  it('rewrites refs inside parameter schemas and attaches $defs', () => {
    const op = {
      parameters: [{ name: 'limit', in: 'query', schema: { $ref: '#/components/schemas/Limit' } }],
    }
    const bundled = bundleOperation(op, { Limit: { type: 'integer' } }, 'sys/ep') as any
    expect(bundled.parameters[0].schema.$ref).toBe('#/$defs/Limit')
    expect(bundled.parameters[0].schema.$defs.Limit).toEqual({ type: 'integer' })
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
    const op = resolveEndpointSchema(spec, 'GET', '/things/{thingId}', 'sys/ep') as any
    expect(op.parameters).toEqual([
      { name: 'thingId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'limit', in: 'query', schema: { type: 'string' } },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/catalog/spec.test.ts`
Expected: FAIL — refs in parameter schemas are left as `#/components/schemas/…` (first two tests), no `SpecError` on the parameter-level ref, and the merge test sees only the operation's own `parameters`.

- [ ] **Step 3: Implement in `src/lib/catalog/spec.ts`**

In `jsonSchemaNodes`, after the `responses` loop, collect parameter schema nodes:

```ts
  const params = op.parameters
  if (Array.isArray(params)) {
    for (const p of params) push((p as { schema?: unknown } | null)?.schema)
  }
```

In `bundleOperation`, immediately after `const op = clone(operation)`, guard against parameter-level refs:

```ts
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
```

Replace `resolveEndpointSchema` with a path-item-aware version and add the merge helper:

```ts
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
    return typeof name === 'string' && typeof loc === 'string' ? `${loc} ${name}` : null
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/spec.test.ts tests/catalog/load.test.ts`
Expected: PASS — new blocks green, and every pre-existing spec/load test unaffected (operations without `parameters` bundle byte-identically; a malformed non-array `parameters` in a path item is ignored by the merge and rejected later by `compileEndpointSchema`).

- [ ] **Step 5: Gate + commit**

```bash
npm run typecheck && npx vitest run && npm run lint
git add src/lib/catalog/spec.ts tests/catalog/spec.test.ts
git commit -m "feat(catalog): read parameter schemas from a system _spec file"
```

---

### Task 3: Runtime enforcement in the router

Wire `validateRequestParams` into both request-side call sites: the mocked path's 400 (combined with body issues into one `details` array) and the `real` passthrough's warn-only drift probe. `ctx` already carries everything needed.

**Files:**
- Modify: `src/lib/router/route-request.ts`
- Modify: `src/app/components/SchemaBadge.tsx` (tooltip copy only)
- Test: `tests/router/route-request.test.ts`, `tests/router/spec-schema.e2e.test.ts`

**Interfaces:**
- Consumes: `validateRequestParams` from Task 1.
- Produces: behavior only — the 400 body becomes `{ error: 'request does not match schema', endpoint, details }` where `details` mixes body and parameter issues; `warnOnRequestSchemaDrift` takes the full `RequestContext`.

- [ ] **Step 1: Extend the test catalog**

In `tests/router/route-request.test.ts`, inside the `CATALOG` literal:

(a) Add a `parameters` array to the existing `schema_checked` endpoint's `schema`, as a sibling of `requestBody` (optional params only — existing tests send neither, so they stay green):

```ts
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
              { name: 'x-priority', in: 'header', schema: { type: 'string', enum: ['low', 'high'] } },
            ],
```

(b) Add a new endpoint after `schema_checked` (global + GET, so no profile or body is involved; request validation runs before fixture load, so the 400 test needs no fixture file on disk):

```ts
        {
          name: 'param_gate',
          displayName: 'Param Gate',
          method: 'GET',
          path: '/param-gate',
          mockType: 'global',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
          schema: {
            parameters: [{ name: 'cursor', in: 'query', required: true, schema: { type: 'string' } }],
          },
        },
```

- [ ] **Step 2: Write the failing tests**

In the same file: first update the existing assertion at the `400s when the request body violates the schema` test — change

```ts
    expect(body.error).toMatch(/request body does not match schema/)
```

to

```ts
    expect(body.error).toMatch(/request does not match schema/)
```

Then append inside `describe('schema validation (mocked path)', …)` (helpers `p`, `post`, `get`, `json`, `deps`, `withProfile`, `profile` all exist):

```ts
  it('400s when a query parameter violates the schema, with location-prefixed details', async () => {
    const d = deps({ getProfile: p() })
    const res = await routeRequest(
      { ...post('/schema-checked', { customerId: 'c1' }), search: '?limit=weeble' },
      d,
    )
    expect(res.status).toBe(400)
    const body = json(res)
    expect(body.error).toMatch(/request does not match schema/)
    expect(JSON.stringify(body.details)).toMatch(/query\/limit/)
  })

  it('coerces string query and header values toward the declared types', async () => {
    const d = deps({ getProfile: p() })
    const res = await routeRequest(
      {
        ...post('/schema-checked', { customerId: 'c1' }),
        search: '?limit=42',
        headers: { 'content-type': 'application/json', 'X-Priority': 'high' },
      },
      d,
    )
    expect(res.status).toBe(200)
  })

  it('collects parameter and body issues into one 400', async () => {
    const d = deps({ getProfile: p() })
    const res = await routeRequest(
      { ...post('/schema-checked', { customerId: 'c1', amount: 'lots' }), search: '?limit=500' },
      d,
    )
    expect(res.status).toBe(400)
    const details = JSON.stringify(json(res).details)
    expect(details).toMatch(/query\/limit/)
    expect(details).toMatch(/\/amount/)
  })

  it('400s on a missing required query parameter before any fixture is loaded', async () => {
    const res = await routeRequest(get('/param-gate'), deps({}))
    expect(res.status).toBe(400)
    expect(JSON.stringify(json(res).details)).toMatch(/query\/cursor/)
  })

  it('records parameter drift on the real path without blocking', async () => {
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(
        profile({ profileId: 'c1', endpointScenarios: { schema_checked: 'real' } }),
      ),
      trace,
    })
    const res = await routeRequest(
      { ...post('/schema-checked', { customerId: 'c1' }), search: '?limit=weeble' },
      d,
    )
    expect(res.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
    expect(trace.validation?.request).toBe('drift_warning')
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/router/route-request.test.ts`
Expected: FAIL — the new param tests get 200/no-drift where 400/drift is expected, and the updated message assertion fails against the old string.

- [ ] **Step 4: Implement in `src/lib/router/route-request.ts`**

(a) Replace the mocked-path validation block (the `const compiled = …` / `if (compiled) { … }` block right after the `REAL_SCENARIO` early return) with:

```ts
  const compiled = deps.schemas?.get(schemaKey(system.slug, endpoint.name))
  if (compiled) {
    const issues = [
      ...compiled.validateRequestParams(ctx),
      ...compiled.validateRequestBody(ctx.body),
    ]
    if (issues.length > 0) {
      setValidation(trace, 'request', 'failed')
      traceError(trace, 'request_schema_invalid', 'request does not match schema')
      return jsonResult(400, {
        error: 'request does not match schema',
        endpoint: endpoint.name,
        details: issues,
      })
    }
    setValidation(trace, 'request', 'ok')
  }
```

(b) Change the drift probe to cover parameters — replace `warnOnRequestSchemaDrift`'s signature and body check:

```ts
// Warn-only drift probe: a real request that violates the schema (parameters
// or body) means the caller (or the schema) has drifted from what's
// documented. Mirrors warnOnResponseSchemaDrift below; never blocks the
// passthrough request.
function warnOnRequestSchemaDrift(
  system: SystemDef,
  endpoint: EndpointDef,
  ctx: RequestContext,
  deps: RouterDeps,
  trace: RouteTrace,
): void {
  const compiled = deps.schemas?.get(schemaKey(system.slug, endpoint.name))
  if (!compiled) return
  const issues = [...compiled.validateRequestParams(ctx), ...compiled.validateRequestBody(ctx.body)]
  if (issues.length > 0) {
    setValidation(trace, 'request', 'drift_warning')
  }
}
```

(c) Update its call site in `proxy()`: `warnOnRequestSchemaDrift(system, endpoint, ctx.body, deps, trace)` → `warnOnRequestSchemaDrift(system, endpoint, ctx, deps, trace)`.

No import changes are needed — `RequestContext` is already imported, and `validateRequestParams` accepts `ctx` structurally.

(d) The schema badge's tooltip says only bodies are validated — now stale. In `src/app/components/SchemaBadge.tsx`, replace the component doc comment and `title`:

```tsx
/**
 * Badge shown for endpoints that carry a schema (`_schema.json` or a system
 * `_spec` operation), i.e. whose requests — declared parameters and body —
 * and response bodies are validated at runtime.
 */
```

```tsx
      title="Requests (parameters and body) and response bodies are validated against a schema"
```

The visible badge label ("Schema verified") is what `tests/ui/*.test.tsx` assert — it stays unchanged, so no test edits.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/router/route-request.test.ts`
Expected: PASS.

- [ ] **Step 6: Extend the spec e2e test**

In `tests/router/spec-schema.e2e.test.ts`:

(a) In `SPEC_YAML`, insert directly after the `'    post:',` line:

```ts
  '      parameters:',
  '        - name: limit',
  '          in: query',
  '          schema: { type: integer }',
```

(b) Give `mockRequest` an optional query string — change its signature and URL to:

```ts
function mockRequest(body: unknown, search = ''): Request {
  return new Request(`http://localhost:3000/mock${search}`, {
```

(c) Update the existing assertion `expect(body.error).toMatch(/request body does not match schema/)` → `/request does not match schema/`.

(d) Append a new test inside the describe block (reuse the file-set from the first test verbatim):

```ts
  it('400s when a query parameter violates the spec-declared parameter schema', async () => {
    const dir = tmpCatalogDir({
      'sys/_system.json': SYSTEM_META,
      'sys/_spec.yaml': SPEC_YAML,
      'sys/mock/_endpoint.json': ENDPOINT_META,
      'sys/mock/default.json': { status: 200, body: { ok: true } },
    })
    const handle = handlerWith(dir, null)

    const res = await handle(mockRequest({ name: 'n' }, '?limit=weeble'), ['mock'])
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details: unknown }
    expect(body.error).toMatch(/request does not match schema/)
    expect(JSON.stringify(body.details)).toMatch(/query\/limit/)

    // A coercible value passes straight through to the fixture.
    const ok = await handle(mockRequest({ name: 'n' }, '?limit=5'), ['mock'])
    expect(ok.status).toBe(200)
  })
```

- [ ] **Step 7: Run the e2e + full suite**

Run: `npx vitest run tests/router/spec-schema.e2e.test.ts && npx vitest run`
Expected: PASS across the board (the only behavioral change visible elsewhere is the 400 error string, updated in Step 2/6).

- [ ] **Step 8: Gate + commit**

```bash
npm run typecheck && npm run lint
git add src/lib/router/route-request.ts src/app/components/SchemaBadge.tsx tests/router/route-request.test.ts tests/router/spec-schema.e2e.test.ts
git commit -m "feat(router): enforce request parameter schemas at runtime"
```

---

### Task 4: Startup cross-check — declared path params must exist in the endpoint path

A schema-declared `in: path` parameter with no matching `{name}` segment can never be supplied, so every request would 400. That's detectable at startup — make it a catalog validation error (this is the `/customers/{customerId}` vs `/customers/{id}` drift the docs currently can only warn about via the unmatched-operation warning). The reverse direction — a `{segment}` the schema doesn't declare — stays silent: schemas without full parameter coverage are the norm, not an error.

**Files:**
- Modify: `src/lib/catalog/validate.ts`
- Test: `tests/catalog/validate.test.ts`

**Interfaces:**
- Consumes: `declaredParams()` from Task 1 (`schemaKey` and the registry are already in scope in `validateCatalog`).
- Produces: a new startup error string: `<label>: schema declares path parameter "<name>" but the endpoint path "<path>" has no {<name>} segment`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/catalog/validate.test.ts` (helpers `tmpCatalogDir`, `loadCatalog`, `validateCatalog` are already imported):

```ts
describe('schema path parameters vs endpoint path', () => {
  const files = (endpointPath: string): Record<string, unknown> => ({
    'sys/_system.json': { name: 'Sys', baseUrlEnv: 'TEST_URL' },
    'sys/ep/_endpoint.json': {
      displayName: 'Ep',
      method: 'GET',
      path: endpointPath,
      mockType: 'global',
    },
    // Declares responses too: a schema-bearing endpoint's fixtures must match
    // a response status (existing rule, unchanged by this feature).
    'sys/ep/_schema.json': {
      parameters: [{ name: 'thingId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } },
    },
    'sys/ep/default.json': { status: 200, body: { ok: true } },
  })

  it('errors when a declared path parameter has no matching {segment}', () => {
    const dir = tmpCatalogDir(files('/things'))
    const { errors } = validateCatalog(loadCatalog(dir), dir)
    expect(errors).toEqual([
      expect.stringMatching(/path parameter "thingId".*no \{thingId\} segment/),
    ])
  })

  it('passes when the path template declares the parameter', () => {
    const dir = tmpCatalogDir(files('/things/{thingId}'))
    const { errors } = validateCatalog(loadCatalog(dir), dir)
    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/catalog/validate.test.ts`
Expected: FAIL — the mismatch case reports zero errors.

- [ ] **Step 3: Implement in `src/lib/catalog/validate.ts`**

In `validateCatalog`, directly after the `const declaredParams = new Set(…)` statement, add:

```ts
      const compiledSchema = schemas.get(schemaKey(system.slug, endpoint.name))
      if (template && compiledSchema) {
        for (const p of compiledSchema.declaredParams()) {
          if (p.location === 'path' && !declaredParams.has(p.name)) {
            errors.push(
              `${label}: schema declares path parameter "${p.name}" but the endpoint path ` +
                `"${endpoint.path}" has no {${p.name}} segment`,
            )
          }
        }
      }
```

(`schemaKey` is already imported; the fixture loop's own `const compiled = …` further down is a different scope — leave it untouched.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/validate.test.ts && npm run validate:catalog`
Expected: tests PASS; the repo's own catalog still validates clean (it declares no `parameters` anywhere yet).

- [ ] **Step 5: Gate + commit**

```bash
npm run typecheck && npx vitest run && npm run lint
git add src/lib/catalog/validate.ts tests/catalog/validate.test.ts
git commit -m "feat(catalog): cross-check declared path parameters against endpoint paths"
```

---

### Task 5: Documentation

Per `AGENTS.md`, docs ship with the feature — invoke the `maintaining-project-docs` skill and keep its structural review in mind; the concrete edits below are the expected outcome (all in existing pages; no nav changes needed).

**Files:**
- Modify: `docs/site/docs/building/schemas.md`
- Modify: `docs/site/docs/reference/request-lifecycle.md`

- [ ] **Step 1: Update the `_schema.json` intro in `schemas.md`**

Change the opening "Only two paths inside it are read" list to three subtrees:

```markdown
An endpoint directory may optionally contain a `_schema.json`: an **OpenAPI 3.1
operation object** describing the request and response. Only three subtrees
inside it are read — everything else in the object is ignored:

- `parameters` — path/query/header inputs, see
  [Request parameters](#request-parameters)
- `requestBody.content['application/json'].schema`
- `responses.<key>.content['application/json'].schema`
```

- [ ] **Step 2: Update the validation table's runtime rows**

In the `When | What's checked | On mismatch` table:

- *Runtime — mocked scenario* row, "What's checked": `The incoming request — declared parameters (path/query/header) and the body — against `parameters` and `requestBody`; after placeholder resolution, the generated response body against the status-matched response schema.` and its "On mismatch": `Request: `400` with an `error` and a single `details` array covering parameter and body issues. Response: `500` with the same shape.`
- *Runtime — `real` passthrough* row, "What's checked": prepend the same "declared parameters and body" phrasing for the outgoing request.

- [ ] **Step 3: Add the `## Request parameters` section**

Insert after the "Optional fields must have a fallback" subsection (before "## System-level `_spec` file"):

````markdown
## Request parameters

Alongside the body, an operation may declare OpenAPI **`parameters`** — path,
query, and header inputs — and they are verified the same way, from either
schema source (`_schema.json` or a system `_spec` file):

```json
{
  "parameters": [
    { "name": "thingId", "in": "path", "required": true,
      "schema": { "type": "string" } },
    { "name": "limit", "in": "query",
      "schema": { "type": "integer", "maximum": 100 } },
    { "name": "x-priority", "in": "header",
      "schema": { "type": "string", "enum": ["low", "high"] } }
  ]
}
```

- **Where they apply.** Mocked scenarios reject a violating request with the
  same `400` as a body mismatch — parameter and body issues share one
  `details` array. `real` passthrough never blocks: mismatches are recorded
  as a `request` `drift_warning`, exactly like body drift. Parameter issue
  paths are prefixed with the location (`query/limit`, `header/x-priority`,
  `path/thingId`); body issues keep their plain JSON-pointer paths
  (`/amount`).
- **Values are strings on the wire, typed in the schema.** Path, query, and
  header values arrive as strings and are *coerced* toward the declared type
  before validation: `?limit=42` satisfies `{ "type": "integer" }`,
  `?limit=weeble` fails it. A repeated query key (`?tag=a&tag=b`) validates
  as an array; a single occurrence satisfies either a scalar or an array
  schema (OpenAPI's default `form` + `explode` serialization). Other
  serialization styles (`deepObject`, `pipeDelimited`, …) are not
  interpreted. This coercion is parameters-only — body fields keep strict
  JSON types.
- **Required.** `in: path` parameters are always required. Query and header
  parameters are required only with `"required": true`; a missing optional
  parameter is simply not validated.
- **Headers match case-insensitively**, and — per OpenAPI — header
  parameters named `Accept`, `Content-Type`, or `Authorization` are ignored.
- **Ignored.** `in: cookie` parameters (the server never parses cookies) and
  parameters declared with `content` instead of `schema` (only their
  `required` presence is checked). Undeclared query parameters and headers
  are never rejected — extras always pass.
- **Startup cross-check.** A declared `in: path` parameter whose name has no
  `{name}` segment in the endpoint's `path` is a startup error — it could
  never be supplied, so every request would fail.

In a system [`_spec` file](#system-level-_spec-file), `parameters` may sit on
the operation **or on the path item** (shared by all of that path's methods);
the loader merges them, operation-level entries winning on the same (`name`,
`in`) pair. `$ref`s inside a parameter's `schema` resolve against
`#/components/schemas/…` as usual; a `$ref` *in place of* the parameter
object itself (`#/components/parameters/…`) is a startup error asking you to
inline it.
````

- [ ] **Step 4: Sync the `_spec` section**

- Change "Only the same two subtrees are read from each matched operation" to name the three subtrees (`parameters`, `requestBody…`, `responses…`) and add: "plus path-item-level `parameters`, which are merged into each matched operation."
- In **Rules and limits**, update the "**Not read from the spec.**" bullet: drop "and path-level `parameters`" from the ignored list (it now reads `servers`, `security`, and `info` only — the rest of the sentence about `baseUrlEnv` and endpoints stays).
- In the "Optional fields must have a fallback" subsection, the closing note "`header:`, `path:`, and `query:` selectors are out of scope: the request schema describes only the JSON body." — append: "(declared `parameters` are validated at runtime, but this startup fallback analysis does not read them yet)."

- [ ] **Step 5: Update `request-lifecycle.md`**

- Mermaid node: `RRequestSchema["400 - request body does not match schema"]` → `RRequestSchema["400 - request does not match schema"]`.
- In the "Reading the branches" bullet "**Mock schemas** are enforced: request failures return 400…" → "**Mock schemas** are enforced: request failures (declared parameters or body) return 400…".

- [ ] **Step 6: Verify and commit**

Docs-only change — no CI-relevant code, but build the guide if the environment allows (see `docs/site/` README steps); otherwise a markdown read-through suffices.

```bash
git add docs/site/docs/building/schemas.md docs/site/docs/reference/request-lifecycle.md
git commit -m "docs: document request parameter validation"
```

---

### Task 6: Full verification gate

- [ ] **Step 1: Run the complete pre-merge gate** (per `AGENTS.md` — CI never runs lint):

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run validate:catalog
```

Expected: all clean. `validate:catalog` is belt-and-braces — the shipped catalog declares no `parameters`, so its behavior must be byte-identical to before.

- [ ] **Step 2: Push**

```bash
git push -u origin claude/schema-verify-request-params-jkilkn
```

---

## Notes for the implementer

- **Why two Ajv instances:** `coerceTypes` is instance-wide. If the body validators shared it, `"42"` would satisfy an integer *body* field and Ajv's in-place coercion would silently rewrite request bodies that later get logged and templated. Parameters are validated as detached strings/fresh arrays (`paramValue` never hands Ajv a `ctx`-owned structure), so coercion there mutates nothing the router reads afterward.
- **Root-scalar coercion:** Ajv computes the verdict on the coerced value even for a top-level scalar passed by value (the caller's variable is unmodified — irrelevant here, only pass/fail and `errors` are read). The Task 1 tests (`?limit=42` ⇒ `[]`) prove this; if a future Ajv major changes it, wrap the value in `{ value }` and the schema in `{ properties: { value: … } }`.
- **Validation ordering is unchanged:** profile resolution and resolvers still run *before* request validation; key capture and fixture loading still run *after* it. The 400 simply covers more of the request.
- **An operation with only `parameters` (no `responses`)** still triggers the existing "fixture has status N with no matching response schema" startup rule — that rule predates this feature and is unchanged. Real-world operations declare responses; tests must too (see Task 4's `_schema.json`).
- **`declaredParams()` reflects post-filter reality:** cookie params and the three ignored header names are absent from it, header names come back lower-cased. The validate.ts cross-check reads only `location === 'path'` entries today; query/header entries are there for the follow-up below.
- **Natural follow-ups (deliberately not in this plan):** extend the #27 optional-field-needs-a-fallback analysis to `path:`/`query:`/`header:` fixture selectors using `declaredParams()` `required` info; response-header schemas; `#/components/parameters` ref support.
