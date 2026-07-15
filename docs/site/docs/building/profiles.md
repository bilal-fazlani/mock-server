# Profiles

Profiles are edited in the UI at `/ui`, and can also be read, created, updated,
and deleted programmatically over the
[Runtime-control API](../driving/api.md) — the way automated tests set up a
caller's scenarios before exercising the code under test.

## Profile-ID extraction (selectors)

Profiled endpoints use `profileIdSelector` to tell the engine how to resolve the
caller's business ID. It can read the ID directly from the request, or it can
resolve another key through a stored [profile key mapping](#profile-key-mappings).
Global endpoints skip this entire step.

Profile-ID selectors have four request sources, chosen by prefix:

| Form | Reads from | Examples |
| --- | --- | --- |
| `$.…` | Parsed JSON request body | `$.customerId`, `$.data.customer.id`, `$.items[0].id` |
| `path:name` | A path parameter | `path:customerId` (requires `{customerId}` in the template) |
| `query:name` | A query-string parameter | `query:customerId` → `?customerId=…` |
| `bearer`<br>`bearer:<claim>` | The `Authorization: Bearer …` header | `bearer` uses the opaque token itself; `bearer:sub` reads the top-level `sub` claim from a JWT |

**Body path grammar.** Starts with `$`, then a chain of `.key` and `[index]`
tokens. Object keys must match `[a-zA-Z_][a-zA-Z0-9_]*` (letters, digits,
underscore — *no hyphens*). Array indices are numeric: `$.orders[0].id`.

**Path / query names** may additionally contain hyphens
(`[a-zA-Z_][a-zA-Z0-9_-]*`).

**Bearer selectors.** The authorization scheme is matched case-insensitively and
the credential after `Bearer` must match `[a-zA-Z0-9\-._~+/]+=*` (one or more
token characters, with optional trailing `=` padding). With `bearer`, that
credential becomes the profile ID directly:

```json
{
  "profileIdSelector": "bearer"
}
```

```bash
curl <origin>/accounts/balance \
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
    token may still capture other body/path/query keys. The catalog page's
    **Copy as cURL** action includes a placeholder authorization header for
    Bearer-profiled endpoints.

!!! note "Must resolve to a string or number"

    Extraction returns the value only if it's a string or number; anything else
    (object, array, boolean, missing), a missing/malformed Bearer header, an
    invalid JWT, or a missing/non-scalar JWT claim counts as "did not resolve" and
    returns a `400`. The extracted value is coerced to a string for the profile
    lookup, so numeric IDs work too.

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
selector grammar: body, path, or query. Bearer selectors are profile-ID-only and
cannot be nested here. Namespaces must match `[a-z0-9][a-z0-9_-]*`. The mapping is
stored in MongoDB in `profileKeyMappings` with `namespace`, `key`, `profileId`,
`capturedBy`, `createdAt`, and `modifiedAt`. There is no TTL index.

!!! warning "Conflicts are loud"

    Capturing the same namespace/key for the same profile is idempotent.
    Capturing the same namespace/key for a different profile returns
    `409 profile_key_mapping_conflict`. A later `profileKey` request whose key has
    never been captured returns `404 profile_key_mapping_not_found`.
