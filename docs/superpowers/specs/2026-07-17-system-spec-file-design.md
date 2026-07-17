# System-level `_spec.yaml` schema source — design

## Problem

Schemas today are per-endpoint: each endpoint directory may carry an optional
`_schema.json`, shaped like a single OpenAPI 3.1 **operation object**, from which
only two subtrees are read — `requestBody.content['application/json'].schema` and
`responses.<status>.content['application/json'].schema` (see
`src/lib/catalog/schema.ts`). An OpenAPI document is essentially a *collection* of
those operation objects keyed by path + method, so users who already have an
`openapi.yaml` must hand-split it into one `_schema.json` per endpoint.

Let a system supply schemas for all its endpoints from a single OpenAPI document
placed at the **system** level, so the existing spec can be dropped in directly.

## Scope

- **In:** an optional `catalog/<system>/_spec.{yaml,yml,json}` OpenAPI document;
  auto-matching each endpoint to its operation by method + path; using the
  operation's `requestBody`/`responses` JSON Schemas as that endpoint's schema;
  bundling internal `$ref`s into a self-contained schema; a non-fatal
  startup-warning channel for unmatched endpoints; a fatal error when a
  spec-backed system also has per-endpoint `_schema.json` files; docs.
- **Out:** generating endpoint directories or scenarios from the spec (schemas
  only — you still author `_endpoint.json` + scenario fixtures by hand); reading
  `servers`, `security`, `info`, path-level `parameters`, or non-JSON content
  types; external/remote `$ref`s (only in-document `#/...` refs are resolved);
  a `_spec` at the endpoint level; validating that the document is fully valid
  OpenAPI (only the read subtrees matter, matching today's `_schema.json`).

## Decisions (resolved during brainstorming)

1. **Role — schema source only.** The spec replaces `_schema.json` as the schema
   source. Endpoint directories remain the unit of truth for method/path, mock
   config, and scenarios.
2. **Lookup — auto-match on method + path.** No new field on `_endpoint.json`.
   The catalog already uses OpenAPI-style `{param}` path templating (e.g.
   `/customers/{customerId}/status`), so endpoint paths string-match the spec's
   `paths` keys directly.
3. **Precedence — forbid mixing.** If a system has a `_spec.*` file, any
   `_schema.json` under that system is a fatal load error. One schema source per
   system.
4. **Missing operation — warn and continue.** An endpoint whose method + path has
   no matching operation loads with no schema (no validation, exactly like an
   endpoint with no `_schema.json` today) and emits a startup warning.
5. **File formats — `.yaml`, `.yml`, `.json`.** One parser (`yaml`) handles all
   three (YAML is a JSON superset).
6. **`$ref` resolution — bundle into standalone `$defs`.** Each endpoint schema
   stays a self-contained object; the spec's definitions are attached under
   `$defs` with refs kept internal, so Ajv resolves them within a single schema.
   Cycle-safe, and no change to `buildSchemaRegistry`.

## Data model

`EndpointDef.schema?: Record<string, unknown>` stays exactly as today — a raw,
**standalone** operation object (`{ requestBody?, responses? }`). Whether it came
from a `_schema.json` file or was assembled from `_spec.*`, downstream code is
identical: `buildSchemaRegistry` (`src/lib/catalog/schema.ts`), the startup
fixture checks in `validateCatalog`, and the router's request/response/passthrough
validation all keep operating on `EndpointDef.schema` unchanged.

The spec document is consumed entirely inside the loader and does **not** need to
live on `SystemDef` — refs are bundled into each endpoint's `schema` at load time,
so nothing about the spec has to survive past `loadCatalog`.

## The bundling step

The operation's `requestBody`/`responses` JSON Schemas may contain
`$ref: '#/components/schemas/Foo'`. Rather than compile a fragment that Ajv can't
resolve (approach: register whole doc with Ajv) or naively inline copies (breaks
on circular refs), each endpoint schema is **bundled** into a self-contained
object:

- Copy the spec's `components/schemas` into a `$defs` block on the endpoint
  schema.
- Rewrite `#/components/schemas/X` refs (in the operation's schemas *and* within
  the copied definitions) to `#/$defs/X`.
- Result per endpoint:

  ```json
  {
    "requestBody": { "content": { "application/json": { "schema": { "$ref": "#/$defs/CustomerStatusRequest" } } } },
    "responses":   { "200": { "content": { "application/json": { "schema": { "$ref": "#/$defs/CustomerStatus" } } } } },
    "$defs": { "CustomerStatus": { ... }, "CustomerStatusRequest": { ... }, "StatusEnum": { ... } }
  }
  ```

Ajv resolves `#/$defs/...` natively within a single compiled schema — cycle-safe,
because refs stay refs and nothing is expanded. Only in-document `#/...` refs are
supported; an external/remote `$ref` (a filename or URL) is a fatal load error
with a clear message.

Implementation note: attaching the full `components/schemas` under `$defs` on
every endpoint over-includes (an endpoint may reference only a couple of the
definitions). That is correct and harmless — Ajv only follows reachable refs.
A reachability trim is a possible later optimization, out of scope here.

## Data flow

1. **`src/lib/catalog/load.ts` — detect & parse.** After reading `_system.json`,
   probe for `_spec.yaml` / `_spec.yml` / `_spec.json` (at most one; two is a
   fatal error). Parse with the new `yaml` dependency. Keep the parsed document
   and its `components/schemas` in scope for the endpoint walk.

2. **`load.ts` — forbid mixing.** While walking the system's endpoints, if the
   system has a spec and any endpoint directory contains a `_schema.json`, push a
   fatal problem naming the system + endpoint. Aggregated into the existing
   `CatalogLoadError` alongside other structural problems.

3. **`load.ts` — per-endpoint resolution.** For each endpoint, if the system has a
   spec: look up `spec.paths?.[endpoint.path]?.[endpoint.method.toLowerCase()]`.
   - **Found** → bundle its `requestBody`/`responses` schemas against
     `components/schemas` (see above) and set `endpoint.schema`.
   - **Not found** → leave `endpoint.schema` undefined and record a **warning**
     (non-fatal) naming the unmatched endpoint.
   Systems without a spec keep today's behavior (read the optional per-endpoint
   `_schema.json`).

4. **`load.ts` — warning channel.** `loadCatalog` today only produces *fatal*
   problems. Add a non-fatal warnings list to its return (e.g.
   `{ catalog, warnings }`, or a `warnings` field on the result) and surface it
   via the existing console logger at startup. This is the one intentional
   departure from the "all catalog problems are fatal" pattern (decision #4).
   `scripts/validate-catalog.ts` prints the same warnings.

5. **Downstream — unchanged.** `buildSchemaRegistry`, `validateCatalog`, and the
   router consume `EndpointDef.schema` exactly as before. Because bundled schemas
   are self-contained standalone objects, Ajv compilation needs no change.

## Error & warning summary

- **Fatal (load error):** two `_spec.*` files in one system; a `_spec.*` file
  that is not valid YAML/JSON or not an object; a `_schema.json` present under a
  spec-backed system; an operation schema containing an external/remote `$ref`;
  an in-document `$ref` that points at a missing definition.
- **Warning (continue):** an endpoint whose method + path has no matching
  operation in the spec (loads with no schema).
- **Silent / allowed:** operations in the spec that have no corresponding
  endpoint directory (the spec may be a superset — only referenced operations are
  read).

## Caveat surfaced by the warning

OpenAPI path keys include the *param name*: `/customers/{customerId}` ≠
`/customers/{id}`. If a spec author names a path parameter differently from the
catalog directory's `path`, auto-match misses and the endpoint gets the
"no matching operation" warning — the signal to reconcile the two.

## Dependency

Add `yaml` (parses YAML and JSON). No OpenAPI-specific parser, no
`json-schema-ref-parser` — bundling is a small in-house walk over
`#/components/schemas` refs, and the read surface (`requestBody`/`responses` JSON
subtrees) is unchanged from today.

## Docs & tooling

- `docs/site/docs/building/schemas.md` gains a `_spec.*` section: what it is, the
  auto-match rule, the forbid-mixing rule, the unmatched-endpoint warning, and the
  in-document-refs-only limitation.
- `scripts/validate-catalog.ts` inherits everything through the shared loader and
  prints warnings in addition to fatal errors.

## Testing

- **Loader:** spec-backed system with matching operations → endpoints get bundled
  schemas; `$ref` to components resolves and validates; unmatched endpoint →
  warning + no schema; `_schema.json` under spec-backed system → fatal; two
  `_spec.*` files → fatal; external `$ref` → fatal; `.yaml`, `.yml`, and `.json`
  variants all parse.
- **Bundling:** nested refs, a circular ref (must not infinite-loop), and a ref to
  a missing definition (fatal).
- **End-to-end:** a spec-backed endpoint validates an incoming request body (400
  on mismatch) and its generated response (500 on mismatch), matching the
  existing `_schema.json` behavior.
