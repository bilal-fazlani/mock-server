# Endpoints

## Endpoint fields

A system directory needs one `_system.json`:

| Field | Required | Purpose & rules |
| --- | --- | --- |
| `name` | yes | Human-readable system name (e.g. `"Hello System"`), used in the UI and in log/error labels. The **slug** used in paths and lookups is the directory name itself (e.g. `hello-system`), not derived from this field. |
| `baseUrlEnv` | yes | Name of the environment variable that holds this system's real upstream base URL, used for `real` passthrough. |

A system directory may also carry one optional `_spec.yaml` (or `_spec.yml` /
`_spec.json`) — a single OpenAPI document that supplies request/response schemas
for all of its endpoints, matched by method + path. It replaces per-endpoint
`_schema.json` files (the two can't be mixed in one system). See
[Schemas](schemas.md#system-level-_spec-file).

Each endpoint directory needs one `_endpoint.json`:

| Field | Required | Purpose & rules |
| --- | --- | --- |
| *(directory name)* | — | The endpoint's machine identifier is its **directory name**, not a field in the file. It's the key under which a profile stores its scenario pick, and shows up in log lines. |
| `displayName` | yes | Human-readable label shown in the UI (profile form and catalog viewer). Free text. |
| `method` | yes | HTTP method (`GET`, `POST`, …). Matched case-insensitively. |
| `path` | yes | Path template, must start with `/`. Literal segments plus `{param}` placeholders — see [Path templates](#path-templates). |
| `mockType` | no | `profiled` (default) means scenario selection comes from the resolved profile. `global` means one shared scenario applies to every caller and no profile lookup happens. |
| `profileIdSelector` | profiled only | How to pull the business ID from the request (body, path, query, or Bearer token). Required for profiled endpoints and forbidden for global endpoints — see [Profiles](profiles.md). |
| `captureProfileKeys` | no | Array of external keys to store against the resolved profile ID before serving the response. Each entry has `namespace` and `keySelector`. Only direct-profile endpoints may capture keys; global endpoints cannot — see [Profile key mappings](profiles.md#profile-key-mappings). |

There is no `scenarios` field to fill in. Scenarios are discovered from the
files sitting next to `_endpoint.json`: each `<scenario>.json` fixture or
`<scenario>.mjs` resolver (filename matching `[a-z0-9][a-z0-9_-]*`, one file per
slug — never both) becomes a scenario key. The endpoint **must** have a
`default` scenario, as either `default.json` or `default.mjs`, and **must not**
have a `real.json` or `real.mjs` — passthrough is implicit. At least one
scenario per endpoint must be fixture-backed. Each fixture may carry an
optional `description` string used as its UI label plus an optional `summary`
shown beneath it on the catalog page, and each resolver may export equivalent
`description` and `summary` constants — see [Fixtures](fixtures.md) and
[Code-backed scenario resolvers](dynamic.md).

To create a profile-less endpoint, set `"mockType": "global"` and omit
`profileIdSelector` and `captureProfileKeys`. It still appears in the catalog, but
its active scenario is edited on the separate `/ui/global-mocks` page instead of
inside each profile.

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
single named param.
