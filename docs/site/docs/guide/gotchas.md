# Gotchas & worked example

## Worked example — a GET with a path parameter

An endpoint that identifies the caller from the URL rather than the body, with two
scenarios. The directory:

```text
catalog/hello-system/customer_status/
  _endpoint.json
  default.json
  frozen.json
```

`catalog/hello-system/customer_status/_endpoint.json`

```json
{
  "displayName": "Customer Status",
  "method": "GET",
  "path": "/customers/{customerId}/status",
  "profileIdSelector": "path:customerId"
}
```

`catalog/hello-system/customer_status/default.json`

```json
{
  "description": "Active",
  "status": 200,
  "body": {
    "customerId": "{{path:customerId}}",
    "status": "ACTIVE",
    "checkedAt": "{{now:iso}}"
  }
}
```

`catalog/hello-system/customer_status/frozen.json`

```json
{
  "description": "Frozen",
  "status": 200,
  "body": {
    "customerId": "{{path:customerId}}",
    "status": "FROZEN",
    "checkedAt": "{{now:iso}}"
  }
}
```

```bash
curl -s <origin>/customers/customer-123/status
# → profile ID "customer-123" comes straight from the path
```

## Gotchas & rules of thumb

- **The endpoint name is its directory name.** There's no separate identifier to
  keep in sync — but renaming the directory means every profile or global mock
  selection that stored a scenario pick under the old name needs re-picking (see
  below).
- **`default` and `real` are reserved filenames.** Every endpoint must have a
  `default.json`; no endpoint may have a `real.json` — validation enforces both.
- **Restart in production for catalog *or* fixture changes.** The whole tree is
  loaded once at startup. In development, fixture edits apply live.
- **Profiles and global mocks store deltas.** With `PASSTHROUGH_AS_DEFAULT=false`,
  picking `default` stores nothing. With `PASSTHROUGH_AS_DEFAULT=true`, picking
  `real` stores nothing. Removing a stored fixture-backed scenario makes that
  profile or global mock selection stale (loud `500`, flagged in the UI).
- **Profile key mappings are not profile settings.** They are captured from
  traffic and stored separately in MongoDB. Reusing the same external key for a
  different profile is treated as data corruption and returns `409`.
- **Changing what `default` does = editing `default.json`.** The change applies
  anywhere the endpoint resolves to `default` — that's the design, so make it a
  reviewed change.
- **`real` is always selectable.** If `PASSTHROUGH_AS_DEFAULT=false` and a system
  has no configured base URL, explicit `real` picks show a UI warning and return
  `500` at request time until the base URL is set.
- **Body selectors don't allow hyphens** in keys; path/query names do.
  `$.customer-id` is invalid — the JSON key would need to be `customer_id` (or use
  a path/query selector).
- **Bearer JWT selectors decode; they do not verify.** `bearer:sub` reads a
  top-level string/number claim for mock routing only. Missing or malformed
  credentials return `400`, and persisted `Authorization` headers are redacted.
- **Avoid ambiguous paths.** For a given method, don't declare both
  `/orders/{id}` and `/orders/latest` — a param position overlaps any literal, and
  validation will reject it.
- **Placeholders are string-only.** `"{{$.customerId}}"` is fine; you can't use a
  placeholder to inject a raw JSON object or number without quotes.
- **Run the validator before you ship.** It's the same gate the server applies on
  first request — catching it early beats a hard failure at runtime.

!!! note "Source of truth"

    `ui/src/lib/catalog/*` (schema, selectors, path templates, validation),
    `ui/src/lib/mock-engine/*` (fixtures, placeholders), and
    `ui/src/lib/router/route-request.ts` (request lifecycle).
