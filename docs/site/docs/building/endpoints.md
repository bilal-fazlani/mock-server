---
description: "The _system.json and _endpoint.json metadata that maps a request method and path to a catalog directory."
---

# Endpoints

## Endpoint fields

A system directory needs one `_system.json`:

| Field | Required | Purpose & rules |
| --- | --- | --- |
| `displayName` | yes | Human-readable system name (e.g. `"Hello System"`), used in the UI and in log/error labels. The **slug** used in paths and lookups is the directory name itself (e.g. `hello-system`), not derived from this field. |
| `baseUrlEnv` | yes | Name of the environment variable that holds this system's real upstream base URL, used for `real` passthrough. |
| `port` | yes | The port this system's endpoints are served on — see [System ports](#system-ports). An integer from `1024` to `65535`, unique across systems, and not the admin `PORT`. |
| `clientCertEnv` | with `clientKeyEnv` | Name of the environment variable that holds the PEM client certificate presented to an upstream that requires mutual TLS. Set it together with `clientKeyEnv` or not at all — one without the other fails validation. See [Upstreams that require mTLS](scenarios.md#upstreams-that-require-mtls). |
| `clientKeyEnv` | with `clientCertEnv` | Name of the environment variable that holds the unencrypted PEM private key for that certificate. |

A system directory may also carry one optional `_spec.yaml` (or `_spec.yml` /
`_spec.json`) — a single OpenAPI document that supplies request/response schemas
for all of its endpoints, matched by method + path. It replaces per-endpoint
`_schema.json` files (the two can't be mixed in one system). See
[Schemas](schemas.md#system-level-_spec-file).

Each endpoint directory needs one `_endpoint.json`:

| Field | Required | Purpose & rules |
| --- | --- | --- |
| *(directory name)* | — | The endpoint's `slug` is its **directory name**, not a field in the file. It's the key under which a profile stores its scenario pick, and shows up in log lines. |
| `displayName` | yes | Human-readable name shown in the UI (profile form and catalog viewer). Free text. |
| `method` | yes | HTTP method (`GET`, `POST`, …). Matched case-insensitively. |
| `path` | yes | Path template, must start with `/`. Literal segments plus `{param}` placeholders — see [Path templates](#path-templates). |
| `mockType` | no | `profiled` (default) means scenario selection comes from the resolved profile. `global` means one shared scenario applies to every caller and no profile lookup happens. |
| `profileIdSelector` | profiled only | How to pull the business ID from the request (body, path, query, header, Bearer token, or a captured key). Required for profiled endpoints and forbidden for global endpoints — see [Profiles](profiles.md). |
| `captureProfileKeys` | no | Array of external keys to store against the resolved profile ID before serving the response. Each entry has `namespace` and `keySelector`. Only direct-profile endpoints may capture keys; global endpoints cannot — see [Profile key mappings](profiles.md#profile-key-mappings). |

There is no `scenarios` field to fill in. Scenarios are discovered from the
files sitting next to `_endpoint.json`: each `<scenario>.json` fixture or
`<scenario>.mjs` resolver (filename matching `[a-z0-9][a-z0-9_-]*`, one file per
slug — never both) becomes a scenario key. The endpoint **must** have a
`default` scenario, as either `default.json` or `default.mjs`, and **must not**
have a `real.json` or `real.mjs` — passthrough is implicit. At least one
scenario per endpoint must be fixture-backed. Each fixture may carry an
optional `displayName` string used as its UI name plus an optional `summary`
shown beneath it on the catalog page, and each resolver may export equivalent
`displayName` and `summary` constants — see [Fixtures](fixtures.md) and
[Code-backed scenario resolvers](dynamic.md).

To create a profile-less endpoint, set `"mockType": "global"` and omit
`profileIdSelector` and `captureProfileKeys`. It still appears in the catalog, but
its active scenario is edited on the separate `/ui/global-mocks` page instead of
inside each profile.

## System ports

Every system is served on its own port, and the admin port serves only the
dashboard and the control API:

```json
{
  "displayName": "Hello System",
  "baseUrlEnv": "HELLO_SYSTEM_URL",
  "port": 4001
}
```

- **Each port is its own path space.** A request on a system's port is matched
  against that system's endpoints only, so two systems may both declare
  `GET /health` or `POST /v1/customers/{id}`. The [overlap
  check](#path-templates) applies within one system.
- **The whole path belongs to the system.** On a system port, `/ui/…` is an
  ordinary path like any other; a system may declare endpoints under it.
- **A request matching none of the system's endpoints** answers `404` naming the
  system:

    ```json
    { "error": "no matching endpoint", "system": "hello-system", "method": "GET", "path": "/nope" }
    ```

- **A mocked path sent to the admin port** answers `404` with a body listing
  where each system lives:

    ```json
    {
      "error": "not a mocked API port",
      "message": "This port serves only the admin UI (/ui) and the control API (/ui/api). Each catalog system's mocked API is served on its own port.",
      "systems": [{ "slug": "hello-system", "port": 4001 }]
    }
    ```

The port is checked when the catalog loads, so [`mock-server
validate`](validate.md) catches a missing, out-of-range or shared one. The server
also refuses to start when a system's port equals `PORT`, or when the port is
already in use, naming the system and the port either way. Ports below `1024`
are rejected because the image runs as an unprivileged user that cannot bind
them. How to publish the ports is on [Install & run](../get-started/install.md#ports).

## Path templates

A template is `/`-separated segments. Each segment is either a **literal**
(`accounts`) or a **parameter** written as `{name}`. Matching requires the *same
number of segments*; parameter values are URL-decoded and exposed to `path:`
selectors and `{{path:name}}` placeholders.

```text
# template        /accounts/{customerId}/cards/{cardId}
# matches         /accounts/cust-9/cards/4  →  { customerId: "cust-9", cardId: "4" }
# does NOT match  /accounts/cust-9/cards       (segment count differs)
```

There are no wildcard or catch-all segments — every position is a literal or a
single named param. Within one system, no two endpoints of the same method may
have templates that can match the same path; validation rejects them as
ambiguous. Endpoints of different systems never clash, because each system has
[its own port](#system-ports).
