# Endpoints

## Endpoint fields

A system directory needs one `_system.json`:

| Field | Required | Purpose & rules |
| --- | --- | --- |
| `name` | yes | Human-readable system name (e.g. `"Hello System"`), used in the UI and in log/error labels. The **slug** used in paths and lookups is the directory name itself (e.g. `hello-system`), not derived from this field. |
| `baseUrlEnv` | yes | Name of the environment variable that holds this system's real upstream base URL, used for `real` passthrough. |

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
`<scenario>.json` files sitting next to `_endpoint.json`: each filename (matching
`[a-z0-9][a-z0-9_-]*`) becomes a scenario key. The endpoint **must** have a
`default.json` and **must not** have a `real.json` — passthrough is implicit. Each
scenario fixture may carry an optional `description` string used as its UI label —
see [Fixtures](fixtures.md).

An endpoint directory may also hold an optional `_dynamic.ts` — a code-driven
scenario picker, sitting alongside the same `_endpoint.json`. Its presence adds
a reserved `dynamic` scenario to the endpoint (also never a `<scenario>.json`
file) that defers the pick to that code at request time. See
[Dynamic scenarios](dynamic.md) for the full contract.

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
