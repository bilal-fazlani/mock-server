# Schemas

## Schema validation

An endpoint directory may optionally contain a `_schema.json`: an **OpenAPI 3.1
operation object** describing the request and response bodies. Only two paths
inside it are read — everything else in the object is ignored:

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
| Runtime — mocked scenario | The incoming request body against `requestBody`; after placeholder resolution, the generated response body against the status-matched response schema. | Request: `400` with an `error` and a `details` array. Response: `500` with the same shape. |
| Runtime — `real` passthrough | The proxied response body, when its `content-type` is JSON, against the status-matched response schema. Requests are never validated for `real`. | Never blocks or alters the response — a mismatch is recorded as `drift_warning` in the decision trace and logs at console `warn` level. |

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
    `npm run validate:catalog` after adding or editing one.
