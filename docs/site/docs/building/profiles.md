---
description: "Per-caller scenario selections, and the selectors that extract a profile ID from an incoming request."
---

# Profiles

Profiles are edited in the UI at `/`, and can also be read, created, updated,
and deleted programmatically over the
[Runtime-control API](../driving/api.md) — the way automated tests set up a
caller's scenarios before exercising the code under test.

## Profile-ID extraction (selectors)

Profiled endpoints use `profileIdSelector` to tell the engine how to resolve the
caller's business ID. It can read the ID directly from the request, or it can
resolve another key through a stored [profile key mapping](#profile-key-mappings).
Global endpoints skip this entire step.

Profile-ID selectors have five request sources, chosen by prefix:

| Form | Reads from | Examples |
| --- | --- | --- |
| `$.…`<br>`$['…']` | Parsed JSON request body | `$.customerId`, `$.items[0].id`, `$['assessment-request']['transaction-id']` |
| `path:name` | A path parameter | `path:customerId` (requires `{customerId}` in the template) |
| `query:name` | A query-string parameter | `query:customerId` → `?customerId=…` |
| `header:name` | A request header, matched case-insensitively | `header:x-customer-id` → `X-Customer-Id: customer-123` |
| `bearer`<br>`bearer:<claim>` | The `Authorization: Bearer …` header | `bearer` uses the opaque token itself; `bearer:sub` reads the top-level `sub` claim from a JWT |

!!! note "Must resolve to a string or number"

    Extraction returns the value only if it's a string or number; anything else
    (object, array, boolean, missing), a missing/malformed Bearer header, an
    invalid JWT, or a missing/non-scalar JWT claim counts as "did not resolve" and
    returns a `400`. The extracted value is coerced to a string for the profile
    lookup, so numeric IDs work too.

### Body path grammar

This grammar applies wherever a body selector is accepted: `profileIdSelector`,
`captureProfileKeys[].keySelector`, the selector nested in
`profileKey:<namespace>:…`, and `{{$…}}`
[placeholders](templating.md#placeholder-expressions) in fixtures.

A body selector starts with `$`, then a chain of one or more segments, mixed in
any order:

| Segment | Selects | Rules |
| --- | --- | --- |
| `.key` | An object key | The key must match `[a-zA-Z_][a-zA-Z0-9_]*` — letters, digits, underscore. |
| `['key']`<br>`["key"]` | An object key | Any key at all, including hyphens, dots, spaces, and `:` — everything up to the matching quote. |
| `[n]` | An array element | `n` is a non-negative integer: `$.orders[0].id`. |

Use the bracket form for any key the dot form can't spell. For a request body
whose keys are kebab-case:

```json
{ "assessment-request": { "transaction-id": "abc-123" } }
```

`$['assessment-request']['transaction-id']` resolves to `abc-123`. The forms mix
freely, so `$.data['line-items'][0].sku` is valid too.

The quoted key is taken **verbatim**, with no escape sequences — a backslash is
an ordinary character. To use one quote character in a key, quote with the
other: `$["customer's-id"]`, `$['say "hi"']`. A key containing both quote
characters can't be addressed.

A quoted key always names an object key, never an array position: `$['0']`
reads the key `"0"` of an object, while `$[0]` reads the first element of an
array.

These are catalog errors at startup, each reported with the reason:

- an unterminated key — `$['assessment-request`
- an empty key — `$['']`
- a key not closed by `]` right after its quote — `$['a'b']`
- anything else inside `[ ]` that is neither a quoted key nor an index —
  `$[a-b]`, `$[ 'a' ]`, `$[-1]`

### Path, query, and header selectors

Path, query, and header names match `[a-zA-Z_][a-zA-Z0-9_-]*` — the `.key`
characters plus hyphens — so `path:customer-id` and `header:x-customer-id` need
no quoting.

Header selectors match the header name case-insensitively, so
`header:x-customer-id` resolves whatever casing the caller sent. Credential
headers — `authorization`, `proxy-authorization`, `cookie`, and `set-cookie` —
are rejected wherever a header selector is accepted, and using one is a catalog
error at startup. Read a Bearer credential with `bearer` / `bearer:<claim>`
instead, which is purpose-built for it.

### Bearer selectors

The authorization scheme is matched case-insensitively and
the credential after `Bearer` must match `[a-zA-Z0-9\-._~+/]+=*` (one or more
token characters, with optional trailing `=` padding). With `bearer`, that
credential becomes the profile ID directly:

```json
{
  "profileIdSelector": "bearer"
}
```

```bash
curl http://localhost:4001/accounts/balance \
  -H 'authorization: Bearer customer-123'
```

With `bearer:<claim>`, the credential must be a three-part JWT whose payload is
base64url-decoded as JSON; the named **top-level** claim becomes the profile ID.
Claim names match `[a-zA-Z_][a-zA-Z0-9_-]*`, so `bearer:sub` and
`bearer:customer_id` are valid, but nested claim paths are not. The selected claim
must be a string or number.

!!! warning "JWT decoding is not authentication"

    Bearer JWTs are decoded only to choose a mock profile. The mock does not
    verify the signature, algorithm, issuer, audience, expiry, or any other
    claim. Put real authentication in the system responsible for it; do not treat
    this selector as an authorization check.

!!! note "Profile-ID only"

    `bearer` and `bearer:<claim>` are valid only in `profileIdSelector`. They
    cannot be used in fixture placeholders, `captureProfileKeys.keySelector`, or
    inside `profileKey:<namespace>:…`. An endpoint resolved directly from a Bearer
    token may still capture other body/path/query/header keys. The catalog page's
    **Copy as cURL** action includes a placeholder authorization header for
    Bearer-profiled endpoints.

## Callers with no profile

Resolving an ID and finding a profile for it are two steps, and the second one
can miss — a caller you have not set up yet, or one you never will. What happens
then is [`UNMOCKED_USERS`](../reference/configuration.md), and out of the box it
is `DEFAULT_MOCK`: the endpoint serves its `default` fixture.

That is why a freshly authored catalog answers the first request you send it. You
do not need a profile to get a response; you need one when you want *this* caller
to see something other than `default`. Profiles are how you vary a response per
caller, not how you unlock one.

| `UNMOCKED_USERS` | An unknown caller gets |
| --- | --- |
| `DEFAULT_MOCK` (default) | The endpoint's `default` fixture |
| `ERROR` | `404`, with `profile "<id>" not found` |
| `REAL` | Proxied to the live upstream — see [the `real` passthrough](scenarios.md#scenarios-the-real-passthrough) |

The served-anyway cases stay visible rather than silent. The console line is
raised to `warn` and carries `source=unmocked_policy` alongside the selector that
produced the unmatched ID:

```text
[mock] POST /charge -> 200 3ms payments/charge profile=cust-42 scenario=default source=unmocked_policy selector=$.customerId outcome=fixture
```

and the request log records `scenarioSource: "unmocked_policy"` on the entry's
decision trace, so "no profile matched" is still tellable from "the profile
matched and selected `default`" long after the run. See
[Console logs](../driving/console-logs.md) and
[Request logs](../driving/request-logs.md).

!!! note "Set `ERROR` when an unknown caller is a bug"

    A test suite that sets up a profile per test is a suite where an unmatched
    caller means the *test* is wrong, and a `404` is the fastest way to be told
    so. `UNMOCKED_USERS=ERROR` restores that. The trade is deliberate: the default
    optimises for a catalog you are still writing, this setting for one you are
    relying on.

## Profile expiry

A profile created through the [Runtime-control API](../driving/api.md#get-apiprofilesprofileid-put-delete)
expires after a day without use; a profile created in the UI never expires. Test
suites create a profile per run and rarely clean up, so API-created profiles clean
up after themselves while the ones you curate by hand stay put.

| How the profile was created | Expiry |
| --- | --- |
| UI (`/profiles/new`) | None |
| API `PUT` with no `ttl` | [`PROFILE_API_TTL_DURATION`](../reference/configuration.md) (default `1d`; `off` for none) |
| API `PUT` with `"ttl": "2h"` | `2h` |
| API `PUT` with `"ttl": false` | None |
| Before the server supported expiry | None — existing profiles are never given one |

The expiry **slides**: it restarts from now on every mocked request that resolves
to the profile, every API `PUT`, every UI save and every reset. A profile in
steady use never expires; one left idle for its `ttl` does. Each restart is a
database write, so every mocked request to an expiring profile costs one; a profile
without an expiry costs none. A `ttl` is a whole number of minutes, hours or days,
from `1m` to `365d`. There is no maximum lifetime: a profile in use keeps going
past its `ttl`.

Each profile stores the `ttl` it was given and always restarts by that, so
changing `PROFILE_API_TTL_DURATION` affects only profiles created afterwards. A UI
save or reset keeps the profile's `ttl` and never adds an expiry to a profile
without one. To change it, `PUT` the profile with a new `ttl`, or with
`"ttl": false` to keep it for good. The dashboard shows the remaining time
("Expires in 3h") on the profile list and in the profile's header.

**An expired profile is gone.** From the moment it expires, the profile reads as
absent everywhere: a request for it is handled like any [caller with no
profile](#callers-with-no-profile), `GET` answers `404`, and it drops out of the
dashboard. A sweep that runs at startup and once a minute then deletes it, with its
[key mappings](#profile-key-mappings), sequence progress and resolver history. Its
request logs are kept and age out through `REQUEST_LOG_TTL_DURATION`. A key
captured by an expired profile can be captured by another profile straight away,
with no `409`.

A `PUT` for the ID of an expired profile creates a new one. Nothing carries over
from the old profile: no sequence progress, no key mappings, no resolver history.

## Profile key mappings

Some workflows have an early request that contains both the canonical profile ID
and another request key, then later callbacks that contain only that other key.
Use `captureProfileKeys` on the early endpoint and
`profileKey:<namespace>:<selector>` on the later endpoint.

Early request: resolve the profile ID directly and capture the order ID:

```json
{
  "displayName": "Create Order",
  "method": "POST",
  "path": "/orders",
  "profileIdSelector": "$.customer.customerId",
  "captureProfileKeys": [
    {
      "namespace": "order-id",
      "keySelector": "$.orderId"
    }
  ]
}
```

Later callback: resolve the profile ID through the stored order mapping:

```json
{
  "displayName": "Order Webhook",
  "method": "POST",
  "path": "/orders/webhook",
  "profileIdSelector": "profileKey:order-id:$.orderId"
}
```

!!! note "Fold shared upstream routes"

    If one upstream method + path carries multiple business events, model it as
    one catalog endpoint. The router matches an endpoint before it reads the
    request body, and validation rejects same-method path overlaps as ambiguous.

The nested selector after `profileKey:<namespace>:` uses the reusable direct
selector grammar: body, path, query, or header. Both `profileIdSelector` and
`keySelector` accept the [bracket form](#body-path-grammar), so a callback whose
body keys are kebab-case resolves through
`"profileKey:event-id:$['assessment-request']['transaction-id']"`. Bearer selectors are
profile-ID-only and cannot be nested here. Namespaces must match `[a-z0-9][a-z0-9_-]*`. The mapping is
stored in MongoDB in `profileKeyMappings` with `namespace`, `key`, `profileId`,
`capturedBy`, `createdAt`, and `modifiedAt`.

!!! warning "Conflicts are loud"

    Capturing the same namespace/key for the same profile is idempotent.
    Capturing the same namespace/key for a different profile returns
    `409 profile_key_mapping_conflict`. A later `profileKey` request whose key has
    never been captured returns `404 profile_key_mapping_not_found`.

### Retention for callers with no profile

Capturing happens whether or not the resolved profile ID names a real profile.
Under `UNMOCKED_USERS=DEFAULT_MOCK` or `REAL`, an unknown caller still completes
the early request, so its keys are still captured — otherwise the later callback
would `404` and those policies would silently not apply to `profileKey` endpoints.

A mapping captured for an ID with no profile expires after
`PROFILE_KEY_TTL_DURATION` (default `1d`), and the clock restarts each time that
key is captured again. A mapping owned by a real profile carries no expiry and is
kept until the profile is deleted or [expires](#profile-expiry).

This matters more than storage: `namespace` + `key` is unique, so a mapping left
by a throwaway caller would otherwise hold that key forever and answer a real
profile's capture with `409`. Load-testing with random IDs leaves nothing
permanent behind.

If the profile is created later, its mappings stop being temporary at that moment
— creating the profile clears the expiry on every mapping already captured for
its ID, so nothing expires out from under a profile that now exists.
