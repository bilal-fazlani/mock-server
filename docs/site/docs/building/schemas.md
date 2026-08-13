---
description: "Validate requests and responses against an OpenAPI 3.1 operation object in _schema.json."
---

# Schemas

## Schema validation

An endpoint directory may optionally contain a `_schema.json`: an **OpenAPI 3.1
operation object** describing the request and response. Only three subtrees
inside it are read — everything else in the object is ignored:

- `parameters` — path/query/header inputs, see
  [Request parameters](#request-parameters)
- `requestBody.content['application/json'].schema`
- `responses.<key>.content['application/json'].schema`

Each `schema` is a plain **JSON Schema (2020-12)** object. Without a `_schema.json`
file, no validation of any kind happens for that endpoint — request bodies,
generated responses, and `real` responses all pass through unchecked, exactly as
before this feature existed.

`catalog/hello-system/hello_world/_schema.json`

```json
{
  "requestBody": {
    "required": true,
    "content": {
      "application/json": {
        "schema": {
          "type": "object",
          "required": ["customerId"],
          "properties": {
            "customerId": { "type": "string" }
          }
        }
      }
    }
  },
  "responses": {
    "200": {
      "content": {
        "application/json": {
          "schema": {
            "type": "object",
            "required": ["customerId", "status", "message"],
            "properties": {
              "customerId": { "type": "string" },
              "status": { "type": "string", "enum": ["success"] },
              "message": { "type": "string" }
            }
          }
        }
      }
    },
    "5XX": {
      "content": {
        "application/json": {
          "schema": {
            "type": "object",
            "required": ["status", "message"],
            "properties": {
              "status": { "type": "string", "enum": ["failure"] },
              "message": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

This `hello_world` schema requires a `customerId` string in the request, a `200`
response shaped like `default.json` (`customerId` / `status: "success"` /
`message`), and any `5xx` response shaped like `failure.json`
(`status: "failure"` / `message`).

**Response-status matching.** A response body is checked against the `responses`
entry chosen by its status, in this order: an exact key (`"200"`), then a range
key (`"2XX"`, `"5XX"`, …), then `"default"`. A status that matches none of them is
a validation error.

| When | What's checked | On mismatch |
| --- | --- | --- |
| Startup | Every scenario fixture's `body` against the response schema matched by its `status`. | Joins the catalog's startup error list — same as a structural or semantic validation error. |
| Startup | Every fixture placeholder against the schema: a `{{$.…}}` selector over a body field, or a `{{query:…}}` / `{{header:…}}` selector over a declared parameter, that the schema lets a caller **omit** — with no `default`/`omit` fallback. | Startup error — see [Optional inputs must have a fallback](#optional-inputs-must-have-a-fallback) below. |
| Runtime — mocked scenario | The incoming request — declared parameters (path/query/header) and the body — against `parameters` and `requestBody`; after placeholder resolution, the generated response body against the status-matched response schema. | Request: `400` with an `error` and a single `details` array covering parameter and body issues. Response: `500` with the same shape. |
| Runtime — `real` passthrough | The outgoing request — declared parameters and body — against `parameters` and `requestBody`; the proxied response body, when its `content-type` is JSON, against the status-matched response schema. | Never blocks or alters the request or response — either side mismatching is recorded as `drift_warning` (`request` and/or `response`) in the decision trace and logs at console `warn` level. |

Every runtime check records its outcome per side — `ok`, `failed`, or
`drift_warning` — plus the issues behind it, in the [request
log](../driving/request-logs.md#schema-validation-outcomes). That is where you
read *which* field drifted on a `real` call, and it is the only place a clean
check is visible at all: a passing request is served exactly as it would be
without a schema.

!!! note "Fixture bodies vs. live request/response bodies"

    At startup, string values in a fixture's `body` that contain a `{{…}}`
    placeholder are treated as wildcards — the field's presence and position are
    still checked, but its unresolved placeholder text isn't type-checked against
    the schema. At runtime, bodies are validated *after* placeholders have been
    resolved to real values, so the full schema applies.

!!! warning "`requestBody.required`"

    Setting `requestBody.required: true` makes a missing request body itself a
    `400`, even before the schema would otherwise have something to check.

!!! warning "A schema that won't compile is a startup error"

    An invalid JSON Schema anywhere in `_schema.json` (request or any response)
    fails catalog validation immediately, alongside fixture-body mismatches — run
    [`mock-server validate`](validate.md) after adding or editing one.

### Optional inputs must have a fallback

When an endpoint has a schema, a fixture placeholder that reads an input the
schema lets a caller **omit** — and supplies no fallback — is a **startup
error**. The schema says the input is optional; the placeholder makes it
de-facto required, because a request without it
[fails with a `500`](templating.md#typed-substitution).

This covers both **body fields** (against `requestBody`) and **declared
parameters** (against [`parameters`](#request-parameters)).

The `requestBody` schema — `id` required, `middleName` optional:

```json
{ "type": "object", "required": ["id"],
  "properties": { "id": {}, "middleName": {} } }
```

The fixture body, where the `{{$.middleName}}` placeholder is the error:

```json
{ "id": "{{$.id}}", "middleName": "{{$.middleName}}" }
```

`{{$.id}}` is fine — a request without `id` is already rejected with a `400`
before templating. `{{$.middleName}}` is flagged, with three ways to resolve it:

- `{{$.middleName | omit}}` — [drop the field](templating.md#dropping-a-field-when-its-source-is-absent) when the caller omits it
- `{{$.middleName | default:'N/A'}}` — [substitute a value](templating.md#fallbacks-for-missing-values)
- add `middleName` to the schema's `required` — if it was never really optional

The check is deliberately conservative: it flags only a field **provably**
optional under plain `object`/`required`/`properties` (following `#/$defs/`
references). Anything it can't decide — a field behind `anyOf`/`allOf`/`if`, an
array element, a `$ref` it can't resolve — is left alone, so it never blocks a
valid catalog.

#### Parameter selectors

A `query:` or `header:` selector is flagged the same way when it reads a
parameter the schema declares **optional**:

Given `parameters` that declare `cursor` with `"required": true` and `limit`
without it, this fixture body is the error:

```json
{ "next": "{{query:cursor}}", "size": "{{query:limit}}" }
```

`{{query:cursor}}` is fine — a request without it is already rejected with a
`400` before templating. `{{query:limit}}` is flagged, with the same three
remedies: `| omit`, `| default:…`, or mark the parameter `"required": true`.

Two limits keep this as conservative as the body check:

- **A parameter the schema doesn't declare is never flagged.** Schemas with
  partial parameter coverage are the norm, so only a *provably* optional
  parameter is an error.
- **`path:` selectors are never flagged** — `in: path` parameters are always
  required, so a request can't reach templating without one.

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
  parameter is simply not validated. A fixture placeholder that reads an
  optional parameter with no fallback is a startup error — see
  [Optional inputs must have a fallback](#optional-inputs-must-have-a-fallback).
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

## System-level `_spec` file

Instead of a `_schema.json` per endpoint, a **system** may carry one OpenAPI
document at `catalog/<system>/_spec.yaml` (or `_spec.yml` / `_spec.json`) that
supplies schemas for all of its endpoints. Each endpoint is matched to an
operation by **method + path**: the loader looks up
`paths[<endpoint path>][<endpoint method>]` in the document, using the `method`
and `path` already declared in the endpoint's `_endpoint.json`. Catalog paths
use the same `{param}` templating as OpenAPI (e.g. `/customers/{customerId}`),
so they line up directly.

Only the same three subtrees are read from each matched operation —
`parameters`, `requestBody.content['application/json'].schema`, and
`responses.<key>.content['application/json'].schema` — plus path-item-level
`parameters`, which are merged into each matched operation. So a `_spec`
operation and a standalone `_schema.json` are interchangeable in what they
contribute.

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
- **Not read from the spec.** `servers`, `security`, and `info` are ignored —
  base URLs still come from `_system.json`'s
  `baseUrlEnv`, and the spec never creates endpoints on its own (you still author
  each endpoint directory and its scenarios).

Run [`mock-server validate`](validate.md) after adding or editing a `_spec`
file — it reports the same errors as startup and prints any unmatched-endpoint
warnings.
