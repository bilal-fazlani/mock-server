# System-level `_spec.yaml` schema source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a system supply request/response JSON Schemas for all its endpoints from one OpenAPI document at `catalog/<system>/_spec.{yaml,yml,json}`, replacing per-endpoint `_schema.json` files.

**Architecture:** A new `src/lib/catalog/spec.ts` module parses the system spec, resolves each endpoint's operation by method + path, and *bundles* the operation's schemas into a self-contained object (component `$ref`s rewritten to internal `#/$defs/…`). `loadCatalog` calls it, storing the result on the existing `EndpointDef.schema` field so every downstream consumer (`buildSchemaRegistry`, `validateCatalog`, the router) is unchanged. Endpoints unmatched by the spec produce a non-fatal warning carried on a new `Catalog.warnings` field and printed at startup.

**Tech Stack:** TypeScript, Node ≥22, Ajv 2020 (`ajv/dist/2020`) + `ajv-formats`, the `yaml` package (new), Vitest.

## Global Constraints

- **Node ≥22** (`package.json` `engines`).
- **Schema read surface is unchanged:** only `requestBody.content['application/json'].schema` and `responses.<key>.content['application/json'].schema` are ever read (see `src/lib/catalog/schema.ts`). Do not read `servers`, `security`, `info`, or path-level `parameters`.
- **In-document `$ref`s only:** only `#/components/schemas/…` references are supported; any other `$ref` (external file, URL, or a non-schema component) is a fatal load error.
- **One schema source per system:** a `_spec.*` file and any per-endpoint `_schema.json` under the same system is a fatal load error.
- **`EndpointDef.schema` stays a raw, standalone operation object** (`Record<string, unknown>`) — do not change its type or how `compileEndpointSchema`/`buildSchemaRegistry` consume it.
- **`Catalog.warnings` must be optional** (`warnings?: string[]`) — `Catalog` is constructed as a `{ systems: [...] }` literal in ~20 test files and passed around widely; a required field would break all of them.
- **Dependency install must use npm 11** to match the pinned lockfile layout in CI/publish/Dockerfile (npm 10 vs 11 produce incompatible `package-lock.json` major versions). Verify with `npm --version` before `npm install`.

---

### Task 1: Ref-bundling core (`bundleOperation`)

Create the pure, dependency-free part of the spec module: rewrite `#/components/schemas/X` refs to `#/$defs/X` and attach a self-contained `$defs` block to each schema-bearing node, so each inner schema compiles standalone through the existing `compileEndpointSchema`.

**Files:**
- Create: `src/lib/catalog/spec.ts`
- Test: `tests/catalog/spec.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. Cross-checks against `compileEndpointSchema` from `src/lib/catalog/schema.ts` (existing, unchanged).
- Produces:
  - `class SpecError extends Error`
  - `function bundleOperation(operation: Record<string, unknown>, componentsSchemas: Record<string, unknown>, label: string): Record<string, unknown>` — returns a deep copy of `operation` with every `#/components/schemas/X` ref rewritten to `#/$defs/X` and a `$defs` block (all of `componentsSchemas`, refs rewritten) attached to each `application/json` schema under `requestBody` and `responses`. Throws `SpecError` on an unsupported `$ref` or a ref to a missing schema.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/catalog/spec.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/catalog/spec'` (or "bundleOperation is not a function").

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/catalog/spec.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/catalog/spec.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog/spec.ts tests/catalog/spec.test.ts
git commit -m "feat(catalog): bundle OpenAPI component refs into standalone \$defs"
```

---

### Task 2: Spec parsing & endpoint resolution

Add YAML/JSON parsing (`parseSpec`), spec-file discovery (`findSpecFile`), and the lookup-and-bundle convenience (`resolveEndpointSchema`) to `spec.ts`. This is where the `yaml` dependency enters.

**Files:**
- Modify: `src/lib/catalog/spec.ts`
- Modify: `package.json`, `package-lock.json` (add `yaml`)
- Test: `tests/catalog/spec.test.ts`

**Interfaces:**
- Consumes: `SpecError`, `bundleOperation` from Task 1.
- Produces:
  - `interface ParsedSpec { paths: Record<string, Record<string, unknown>>; componentsSchemas: Record<string, unknown> }`
  - `function parseSpec(text: string, label: string): ParsedSpec` — parses YAML or JSON; throws `SpecError` if the document is not an object.
  - `function findSpecFile(systemDir: string): string | null` — returns the absolute path of the one `_spec.{yaml,yml,json}` in `systemDir`, `null` if none; throws `SpecError` if more than one.
  - `function resolveEndpointSchema(spec: ParsedSpec, method: string, endpointPath: string, label: string): Record<string, unknown> | null` — returns the bundled operation schema for `paths[endpointPath][method.toLowerCase()]`, or `null` when there is no such operation. (Param is named `endpointPath`, not `path`, to avoid shadowing the imported `node:path` module.)

- [ ] **Step 1: Install the `yaml` dependency**

Run:
```bash
npm --version   # confirm 11.x before installing (see Global Constraints)
npm install yaml
```
Expected: `package.json` gains `"yaml"` under `dependencies`; `package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

```ts
// tests/catalog/spec.test.ts — append these imports and blocks
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import { findSpecFile, parseSpec, resolveEndpointSchema } from '../../src/lib/catalog/spec'

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
    const schema = resolveEndpointSchema(spec, 'POST', '/a', 'sys/ep') as any
    expect(schema.responses['200'].content['application/json'].schema).toEqual({ type: 'object' })
  })
  it('returns null when the path or method is absent', () => {
    expect(resolveEndpointSchema(spec, 'GET', '/a', 'sys/ep')).toBeNull()
    expect(resolveEndpointSchema(spec, 'POST', '/missing', 'sys/ep')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/catalog/spec.test.ts`
Expected: FAIL — `parseSpec`/`findSpecFile`/`resolveEndpointSchema` are not exported.

- [ ] **Step 4: Write minimal implementation**

Add to the top of `src/lib/catalog/spec.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
```

Append to `src/lib/catalog/spec.ts`:

```ts
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

// `endpointPath` (not `path`) avoids shadowing the imported `node:path` module.
export function resolveEndpointSchema(
  spec: ParsedSpec,
  method: string,
  endpointPath: string,
  label: string,
): Record<string, unknown> | null {
  const operation = spec.paths[endpointPath]?.[method.toLowerCase()]
  if (!isObject(operation)) return null
  return bundleOperation(operation, spec.componentsSchemas, label)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/catalog/spec.test.ts`
Expected: PASS (all spec.test.ts blocks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog/spec.ts tests/catalog/spec.test.ts package.json package-lock.json
git commit -m "feat(catalog): parse system OpenAPI spec and resolve endpoint schemas"
```

---

### Task 3: Loader integration + `Catalog.warnings`

Wire the spec module into `loadCatalog`: detect a system spec, forbid mixing it with `_schema.json`, resolve each endpoint's schema from the spec (or warn), and carry warnings on a new optional `Catalog.warnings` field.

**Files:**
- Modify: `src/lib/catalog/types.ts` (add `warnings?` to `Catalog`)
- Modify: `src/lib/catalog/load.ts`
- Test: `tests/catalog/load.test.ts`

**Interfaces:**
- Consumes: `SpecError`, `findSpecFile`, `parseSpec`, `resolveEndpointSchema`, `ParsedSpec` from Task 2.
- Produces: `Catalog.warnings?: string[]`, always populated by `loadCatalog` (possibly `[]`). Per-endpoint schema resolution behavior described below.

- [ ] **Step 1: Add the `warnings` field to `Catalog`**

In `src/lib/catalog/types.ts`, change the `Catalog` interface:

```ts
export interface Catalog {
  systems: SystemDef[]
  /** Non-fatal load diagnostics (e.g. an endpoint with no matching spec
   *  operation). Populated by loadCatalog; empty when there are none. */
  warnings?: string[]
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/catalog/load.test.ts — append inside describe('loadCatalog', ...)
const SPEC_YAML = [
  'paths:',
  '  /hello/world:',
  '    post:',
  '      responses:',
  '        "200":',
  '          content:',
  '            application/json:',
  '              schema:',
  '                $ref: "#/components/schemas/Res"',
  'components:',
  '  schemas:',
  '    Res:',
  '      type: object',
  '      required: [ok]',
  '      properties:',
  '        ok: { type: boolean }',
].join('\n')

it('resolves an endpoint schema from a system _spec.yaml', () => {
  const dir = tmpCatalogDir({
    'sys/_system.json': SYSTEM_META,
    'sys/_spec.yaml': SPEC_YAML,
    'sys/ep/_endpoint.json': ENDPOINT_META, // POST /hello/world
    'sys/ep/default.json': FIXTURE,
  })
  const catalog = loadCatalog(dir)
  const schema = catalog.systems[0].endpoints[0].schema as any
  expect(schema.responses['200'].content['application/json'].schema.$ref).toBe('#/$defs/Res')
  expect(schema.responses['200'].content['application/json'].schema.$defs.Res.required).toEqual(['ok'])
  expect(catalog.warnings).toEqual([])
})

it('supports a _spec.json variant', () => {
  const dir = tmpCatalogDir({
    'sys/_system.json': SYSTEM_META,
    'sys/_spec.json': {
      paths: { '/hello/world': { post: { responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } } } } },
    },
    'sys/ep/_endpoint.json': ENDPOINT_META,
    'sys/ep/default.json': FIXTURE,
  })
  expect(loadCatalog(dir).systems[0].endpoints[0].schema).toBeDefined()
})

it('warns and applies no schema when no operation matches', () => {
  const dir = tmpCatalogDir({
    'sys/_system.json': SYSTEM_META,
    'sys/_spec.yaml': 'paths: {}\n',
    'sys/ep/_endpoint.json': ENDPOINT_META,
    'sys/ep/default.json': FIXTURE,
  })
  const catalog = loadCatalog(dir)
  expect(catalog.systems[0].endpoints[0].schema).toBeUndefined()
  expect(catalog.warnings).toEqual([expect.stringContaining('no operation for POST /hello/world')])
})

it('fails hard when a spec-backed system also has a _schema.json', () => {
  const dir = tmpCatalogDir({
    'sys/_system.json': SYSTEM_META,
    'sys/_spec.yaml': 'paths: {}\n',
    'sys/ep/_endpoint.json': ENDPOINT_META,
    'sys/ep/_schema.json': { responses: {} },
    'sys/ep/default.json': FIXTURE,
  })
  expect(() => loadCatalog(dir)).toThrow(CatalogLoadError)
  expect(() => loadCatalog(dir)).toThrow(/_schema\.json is not allowed/)
})

it('fails hard on two spec files in one system', () => {
  const dir = tmpCatalogDir({
    'sys/_system.json': SYSTEM_META,
    'sys/_spec.yaml': 'paths: {}\n',
    'sys/_spec.json': { paths: {} },
    'sys/ep/_endpoint.json': ENDPOINT_META,
    'sys/ep/default.json': FIXTURE,
  })
  expect(() => loadCatalog(dir)).toThrow(/multiple spec files/)
})

it('fails hard on an unsupported external $ref in the spec', () => {
  const dir = tmpCatalogDir({
    'sys/_system.json': SYSTEM_META,
    'sys/_spec.yaml': [
      'paths:',
      '  /hello/world:',
      '    post:',
      '      responses:',
      '        "200":',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "./other.yaml#/X"',
    ].join('\n'),
    'sys/ep/_endpoint.json': ENDPOINT_META,
    'sys/ep/default.json': FIXTURE,
  })
  expect(() => loadCatalog(dir)).toThrow(/unsupported \$ref/)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/catalog/load.test.ts`
Expected: FAIL — schema is `undefined`/unresolved, no `warnings`, no forbid-mixing error.

- [ ] **Step 4: Implement the loader changes**

In `src/lib/catalog/load.ts`, add the import near the top:

```ts
import { type ParsedSpec, SpecError, findSpecFile, parseSpec, resolveEndpointSchema } from './spec'
```

Add a warnings accumulator next to `problems` (after `const systems: SystemDef[] = []`):

```ts
  const warnings: string[] = []
```

Replace the system loop body from the `const slug = sysEntry.name` line through the `systems.push({...})` call (current lines ~28–105) with:

```ts
    const slug = sysEntry.name
    const systemDir = path.join(catalogDir, slug)
    const sysMeta = readMetaFile(path.join(systemDir, SYSTEM_META), problems)
    if (!sysMeta) continue

    let spec: ParsedSpec | null = null
    try {
      const specFile = findSpecFile(systemDir)
      if (specFile) {
        spec = parseSpec(fs.readFileSync(specFile, 'utf8'), `${slug}/${path.basename(specFile)}`)
      }
    } catch (err) {
      if (err instanceof SpecError) problems.push(`${slug}: ${err.message}`)
      else throw err
    }

    const endpoints: EndpointDef[] = []
    for (const epEntry of sortedEntries(systemDir)) {
      if (epEntry.name === SYSTEM_META) continue
      if (epEntry.isFile() && SPEC_FILE.test(epEntry.name)) continue
      if (!epEntry.isDirectory()) {
        problems.push(`${slug}: unexpected entry (endpoints are directories): ${epEntry.name}`)
        continue
      }
      const endpointName = epEntry.name
      const endpointDir = path.join(systemDir, endpointName)
      const epMeta = readMetaFile(path.join(endpointDir, ENDPOINT_META), problems)
      if (!epMeta) continue

      const label = `${slug}/${endpointName}`
      const displayName = requireString(epMeta, 'displayName', label, problems)
      const method = requireString(epMeta, 'method', label, problems)
      const endpointPath = requireString(epMeta, 'path', label, problems)

      const schemaFile = path.join(endpointDir, SCHEMA_META)
      const hasSchemaFile = fs.existsSync(schemaFile)
      let schemaMeta: Record<string, unknown> | null = null
      if (spec) {
        if (hasSchemaFile) {
          problems.push(`${label}: _schema.json is not allowed when the system has a _spec file`)
        }
        if (method && endpointPath) {
          try {
            const resolved = resolveEndpointSchema(spec, method, endpointPath, label)
            if (resolved) schemaMeta = resolved
            else {
              warnings.push(
                `${label}: no operation for ${method.toUpperCase()} ${endpointPath} in the system spec — no schema applied`,
              )
            }
          } catch (err) {
            if (err instanceof SpecError) problems.push(err.message)
            else throw err
          }
        }
      } else if (hasSchemaFile) {
        schemaMeta = readMetaFile(schemaFile, problems)
      }

      const scenarios: Record<string, ScenarioMeta> = {}
      const fixtureSlugs = new Set<string>()
      const resolverSlugs = new Set<string>()
      for (const fixEntry of sortedEntries(endpointDir)) {
        if (fixEntry.name === ENDPOINT_META || fixEntry.name === SCHEMA_META) continue
        const match = fixEntry.isFile() ? SCENARIO_FILE.exec(fixEntry.name) : null
        if (!match) {
          problems.push(
            `${slug}/${endpointName}: unexpected entry (scenarios are <name>.json fixtures or ` +
              `<name>.ts resolvers, name matching [a-z0-9][a-z0-9_-]*): ${fixEntry.name}`,
          )
          continue
        }
        const [, scenario, ext] = match
        if (ext === 'ts') {
          resolverSlugs.add(scenario)
          scenarios[scenario] ??= { label: scenario }
        } else {
          fixtureSlugs.add(scenario)
          const meta = parseScenarioFile(path.join(endpointDir, fixEntry.name))
          scenarios[scenario] = {
            label: meta.description ?? scenario,
            ...(meta.summary ? { summary: meta.summary } : {}),
          }
        }
      }
      for (const scenario of resolverSlugs) {
        if (fixtureSlugs.has(scenario)) {
          problems.push(
            `${slug}/${endpointName}: scenario "${scenario}" is backed by both ` +
              `${scenario}.json and ${scenario}.ts — pick one`,
          )
        }
      }

      endpoints.push({
        name: endpointName,
        displayName,
        method,
        path: endpointPath,
        ...optionalMockType(epMeta, label, problems),
        ...optionalProfileIdSelector(epMeta),
        ...optionalCaptureProfileKeys(epMeta, label, problems),
        scenarios: orderDefaultFirst(scenarios),
        resolverScenarios: [...resolverSlugs].sort(),
        ...(schemaMeta ? { schema: schemaMeta } : {}),
      })
    }

    systems.push({
      name: requireString(sysMeta, 'name', slug, problems),
      slug,
      baseUrlEnv: requireString(sysMeta, 'baseUrlEnv', slug, problems),
      endpoints,
    })
```

Add the `SPEC_FILE` constant next to the other filename constants at the top of the file:

```ts
const SPEC_FILE = /^_spec\.(ya?ml|json)$/
```

Finally, change the successful return (current `return { systems }`) to:

```ts
  return { systems, warnings }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/catalog/load.test.ts`
Expected: PASS — new spec tests pass and the existing `_schema.json` tests (attaches / absent / malformed) still pass.

- [ ] **Step 6: Run the full suite for regressions**

Run: `npx vitest run`
Expected: PASS — no regressions (the new optional `Catalog.warnings` doesn't affect existing literals).

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog/types.ts src/lib/catalog/load.ts tests/catalog/load.test.ts
git commit -m "feat(catalog): load endpoint schemas from a system-level _spec file"
```

---

### Task 4: Surface warnings at startup and in the validator

Print `catalog.warnings` at runtime startup and in the standalone catalog validator, so unmatched-endpoint warnings are visible without failing the load.

**Files:**
- Modify: `src/lib/runtime.ts:112` (right after `loadCatalog`)
- Modify: `scripts/validate-catalog.ts` (right after `loadCatalog`)

**Interfaces:**
- Consumes: `Catalog.warnings` from Task 3.
- Produces: no new exports — console output only.

- [ ] **Step 1: Print warnings at runtime startup**

In `src/lib/runtime.ts`, immediately after `const catalog = loadCatalog(catalogDir)` (line 112), add:

```ts
  for (const warning of catalog.warnings ?? []) {
    console.warn(`catalog warning: ${warning}`)
  }
```

- [ ] **Step 2: Print warnings in the validator**

In `scripts/validate-catalog.ts`, after the `try/catch` that assigns `catalog` (right before `const { errors: catalogErrors } = ...`), add:

```ts
for (const warning of catalog.warnings ?? []) {
  console.warn(` ! ${warning}`)
}
```

- [ ] **Step 3: Verify the validator still passes on the real catalog**

Run: `npm run validate:catalog`
Expected: prints `Catalog validation passed.` with no `!` warning lines (the shipped `catalog/` has no `_spec` files, so nothing changes).

- [ ] **Step 4: Verify warnings print for a spec-backed catalog with an unmatched endpoint**

`scripts/validate-catalog.ts` reads `./catalog` under the current working directory (it does not honor `CATALOG_PATH`), so create a throwaway spec-backed system inside the real catalog, run, then delete it:

```bash
mkdir -p catalog/spectest/ep \
  && printf '{"name":"SpecTest","baseUrlEnv":"SPECTEST_URL"}' > catalog/spectest/_system.json \
  && printf 'paths: {}\n' > catalog/spectest/_spec.yaml \
  && printf '{"displayName":"E","method":"POST","path":"/hello/world"}' > catalog/spectest/ep/_endpoint.json \
  && printf '{"status":200,"body":{}}' > catalog/spectest/ep/default.json \
  && SPECTEST_URL=http://x npm run validate:catalog; \
  rm -rf catalog/spectest
```
Expected: a line containing `! spectest/ep: no operation for POST /hello/world …` prints (warnings are emitted right after load, before config/fixture validation), followed by `Catalog validation passed.`. The final `rm -rf` removes the throwaway system — confirm `git status` is clean afterward.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runtime.ts scripts/validate-catalog.ts
git commit -m "feat(catalog): surface spec load warnings at startup and in validator"
```

---

### Task 5: Documentation

Document the system-level `_spec` file in the schemas guide: what it is, auto-match, forbid-mixing, the unmatched-endpoint warning, and the in-document-refs-only limit.

**Files:**
- Modify: `docs/site/docs/building/schemas.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add the `_spec` section**

At the end of `docs/site/docs/building/schemas.md`, append:

````markdown
## System-level `_spec` file

Instead of a `_schema.json` per endpoint, a **system** may carry one OpenAPI
document at `catalog/<system>/_spec.yaml` (or `_spec.yml` / `_spec.json`) that
supplies schemas for all of its endpoints. Each endpoint is matched to an
operation by **method + path**: the loader looks up
`paths[<endpoint path>][<endpoint method>]` in the document, using the `method`
and `path` already declared in the endpoint's `_endpoint.json`. Catalog paths
use the same `{param}` templating as OpenAPI (e.g. `/customers/{customerId}`),
so they line up directly.

Only the same two subtrees are read from each matched operation —
`requestBody.content['application/json'].schema` and
`responses.<key>.content['application/json'].schema` — so a `_spec` operation
and a standalone `_schema.json` are interchangeable in what they contribute.

```yaml
# catalog/hello-system/_spec.yaml
paths:
  /hello/world:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/HelloRequest' }
      responses:
        '200':
          content:
            application/json:
              schema: { $ref: '#/components/schemas/HelloResponse' }
components:
  schemas:
    HelloRequest:
      type: object
      required: [customerId]
      properties:
        customerId: { type: string }
    HelloResponse:
      type: object
      required: [customerId, status, message]
      properties:
        customerId: { type: string }
        status: { type: string, enum: [success] }
        message: { type: string }
```

**Rules and limits**

- **One schema source per system.** If a system has a `_spec` file, a
  `_schema.json` in any of its endpoint directories is a startup error — choose
  one or the other per system.
- **Unmatched endpoints warn, they don't fail.** An endpoint whose method + path
  has no matching operation gets no schema (no validation, exactly as if it had
  no `_schema.json`) and logs a startup warning. Watch for this if a path
  parameter is named differently in the spec than in the catalog directory —
  `/customers/{customerId}` and `/customers/{id}` do not match.
- **In-document references only.** `$ref`s must point at
  `#/components/schemas/…` within the same file; the loader inlines them into
  each endpoint's schema. External or remote `$ref`s (other files, URLs) are a
  startup error.
- **Not read from the spec.** `servers`, `security`, `info`, and path-level
  `parameters` are ignored — base URLs still come from `_system.json`'s
  `baseUrlEnv`, and the spec never creates endpoints on its own (you still author
  each endpoint directory and its scenarios).

Run `npm run validate:catalog` after adding or editing a `_spec` file — it
reports the same errors as startup and prints any unmatched-endpoint warnings.
````

- [ ] **Step 2: Commit**

```bash
git add docs/site/docs/building/schemas.md
git commit -m "docs: document the system-level _spec schema source"
```

---

## Notes for the implementer

- **Why `$defs` is attached per inner schema, not per operation:** `compileEndpointSchema` (`src/lib/catalog/schema.ts`) compiles the *inner* `application/json` schema object standalone (not the whole operation object), so `#/…` refs resolve against that inner object. Attaching `$defs` to each inner schema is what makes refs resolve without changing `schema.ts`.
- **Over-inclusion is intentional:** every endpoint schema carries all of the spec's `components/schemas` under `$defs`. Ajv only follows reachable refs, so this is correct; a reachability trim is a possible later optimization, deliberately out of scope.
- **Do not change `EndpointDef.schema`'s type or `buildSchemaRegistry`** — the whole design hinges on the bundled schema being a drop-in for a `_schema.json` operation object.
