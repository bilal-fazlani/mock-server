---
description: "A worked GET example with a path parameter, plus the mistakes that most often produce a surprising response."
---

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

That answers with `default.json` before you have created any profile at all —
[`UNMOCKED_USERS`](configuration.md) defaults to `DEFAULT_MOCK` — and the server
logs it at `warn` with `source=unmocked_policy selector=path:customerId`. Give
`customer-123` a profile pinning `frozen`, and the same curl returns
`frozen.json` instead.

## Gotchas & rules of thumb

- **The endpoint name is its directory name.** There's no separate identifier to
  keep in sync — but renaming the directory means every profile or global mock
  selection that stored a scenario pick under the old name needs re-picking (see
  below).
- **`default` and `real` are reserved slugs.** Every endpoint must have a
  `default` scenario — either `default.json` or `default.mjs`; no endpoint may have
  a `real.json` or `real.mjs` — validation enforces both.
- **A caller with no profile is served, not refused.**
  [`UNMOCKED_USERS`](configuration.md) defaults to `DEFAULT_MOCK`, so a profiled
  endpoint answers with its `default` fixture for an ID it has never seen. The
  request logs at `warn` with `source=unmocked_policy`, and the entry's decision
  trace carries `scenarioSource: "unmocked_policy"` — so a test asserting
  `default` passes whether or not profile resolution worked. Set
  `UNMOCKED_USERS=ERROR` where that distinction has to be fatal.
- **Restart in production for catalog, fixture, *or* resolver changes.** The whole
  tree is loaded once at startup, and every `<scenario>.mjs` is compiled up front —
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
- **History for a caller with *no* profile expires; history for a real profile
  doesn't.** Under `UNMOCKED_USERS=DEFAULT_MOCK` an unknown ID still runs a
  resolver-backed `default`, and its window would otherwise live forever — so it
  expires after `RESOLVER_HISTORY_TTL_DURATION` (default `1d`) of no calls from
  that ID. Load-testing with random IDs leaves nothing permanent behind. See
  [Retention for callers with no
  profile](../building/dynamic.md#retention-for-callers-with-no-profile).
- **Profiles and global mocks store deltas.** With `PASSTHROUGH_AS_DEFAULT=false`,
  picking `default` stores nothing. With `PASSTHROUGH_AS_DEFAULT=true`, picking
  `real` stores nothing. Removing a stored fixture-backed scenario makes that
  profile or global mock selection stale (loud `500`, flagged in the UI).
- **Profile key mappings are not profile settings.** They are captured from
  traffic and stored separately in MongoDB. Reusing the same external key for a
  different profile is treated as data corruption and returns `409`.
- **A mapping captured for a caller with *no* profile expires too.** Same shape as
  the resolver-history rule above, and for a sharper reason: `namespace` + `key` is
  unique, so a mapping left behind by an unknown caller would hold that key forever
  and answer a real profile's capture with `409`. It expires after
  `PROFILE_KEY_TTL_DURATION` (default `1d`) instead. Creating the profile clears the
  expiry on mappings already captured for its ID. See [Retention for callers with no
  profile](../building/profiles.md#retention-for-callers-with-no-profile).
- **Changing what `default` does = editing `default.json`.** The change applies
  anywhere the endpoint resolves to `default` — that's the design, so make it a
  reviewed change.
- **`real` is always selectable.** If `PASSTHROUGH_AS_DEFAULT=false` and a system
  has no configured base URL, explicit `real` picks show a UI warning and return
  `500` at request time until the base URL is set.
- **Body selectors don't allow hyphens** in keys; path/query/header names do.
  `$.customer-id` is invalid — the JSON key would need to be `customer_id` (or use
  a path/query/header selector).
- **Credential headers can't be read by a `header:` selector.** `authorization`,
  `proxy-authorization`, `cookie`, and `set-cookie` are rejected at startup, so a
  fixture can never echo a credential back. Route on a Bearer token with
  `bearer` / `bearer:<claim>` instead.
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
  substitution](../building/templating.md#typed-substitution).
- **Run the validator before you ship.** It's the same gate the server applies on
  first request — catching it early beats a hard failure at runtime.
- **The server speaks HTTP/1.1, and ignores requests to switch protocol.** A client
  that opens with the cleartext HTTP/2 handshake — `Upgrade: h2c`, which
  `java.net.http.HttpClient` sends by default on an `http://` URL — gets an ordinary
  HTTP/1.1 response rather than a refusal, and stays on HTTP/1.1 for that connection.
  Every request is answered that way, not just the first on a connection: a client
  that re-sends the handshake on a connection it reuses is served exactly as one
  that sends it once. The same goes for any other `Upgrade` token, `websocket`
  included — the request is routed and answered normally, so a websocket handshake
  gets this server's ordinary `404`, never a silently closed socket. There is
  nothing to configure and no reason to pin a client's protocol version for the
  mock's sake; a pin added as a workaround against an earlier version can go. See
  [Things that bite](../sdk/spring-boot.md#things-that-bite) in the Spring Boot
  guide.

!!! note "Source of truth"

    `src/lib/catalog/*` (schema, selectors, path templates, validation),
    `src/lib/mock-engine/*` (fixtures, placeholders),
    `src/lib/dynamic/*` (resolver history windows),
    `src/lib/router/route-request.ts` (request lifecycle, resolver invocation), and
    `src/server/ignore-unsupported-upgrades.ts` (protocol-upgrade handling).
