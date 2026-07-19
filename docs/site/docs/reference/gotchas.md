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
- **`default` and `real` are reserved slugs.** Every endpoint must have a
  `default` scenario — either `default.json` or `default.ts`; no endpoint may have
  a `real.json` or `real.ts` — validation enforces both.
- **Restart in production for catalog, fixture, *or* resolver changes.** The whole
  tree is loaded once at startup, and every `<scenario>.ts` is compiled up front —
  a resolver that doesn't compile fails the boot. In development, fixture edits and
  resolver edits both apply live, and a broken resolver is a request-time
  `500 resolver_compile_error` instead of a crash.
- **A resolver must return a *fixture-backed* slug, or `"real"`.** Returning
  another resolver-backed slug is a `500 resolver_bad_return` — there is no
  resolver chaining, so an endpoint whose scenarios are all resolvers is rejected
  by validation. See [Code-backed scenario
  resolvers](../building/dynamic.md#the-resolver-contract).
- **Resolver history is per slug, per owner, and it persists.** It lives in
  MongoDB, not in the request logs, so it outlives log expiry — a "pending twice,
  then success" resolver keeps counting across restarts until you press **Reset
  resolver history** (or delete the profile). Two resolver-backed scenarios on the
  same endpoint keep independent windows, capped at `RESOLVER_HISTORY_LIMIT`.
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
- **Placeholders are written as strings, but they don't stay strings.** A
  placeholder must sit inside a quoted JSON string (`"{{$.amount}}"`) — that's
  syntax, not the result. When the string is *exactly one* placeholder the value
  is emitted raw, so `"{{$.amount}}"` yields `42`, not `"42"`, and a `$.…`
  selector can pull out a boolean, `null`, or a whole object or array subtree.
  Interpolate a placeholder into surrounding text and the value is coerced back to
  a string; header values are always strings. See [Typed
  substitution](../building/fixtures.md#typed-substitution).
- **Run the validator before you ship.** It's the same gate the server applies on
  first request — catching it early beats a hard failure at runtime.

!!! note "Source of truth"

    `src/lib/catalog/*` (schema, selectors, path templates, validation),
    `src/lib/mock-engine/*` (fixtures, placeholders),
    `src/lib/dynamic/*` (resolver history windows), and
    `src/lib/router/route-request.ts` (request lifecycle, resolver invocation).
