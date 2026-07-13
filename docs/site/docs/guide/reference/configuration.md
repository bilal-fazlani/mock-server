# Configuration

## App configuration

Environment variables govern app-wide behavior. Values are case-insensitive. This
is the canonical reference for each setting; [Request lifecycle](../../request-lifecycle.md)
shows how they steer routing.

| Variable | Values | Meaning |
| --- | --- | --- |
| `PASSTHROUGH_AS_DEFAULT` | `false` (default)<br>`true` | Controls what an omitted selection means. `false`: `default` is the implicit scenario, appears first in pickers, and is not stored when selected. `true`: `real` is the implicit scenario, appears first in pickers, and is not stored when selected. Passthrough itself is always allowed. |
| `UNMOCKED_USERS` | `ERROR` (default)<br>`DEFAULT_MOCK`<br>`REAL` | What happens when a profiled endpoint extracts a profile ID but **no profile exists** for it. `ERROR`: loud `404`. `DEFAULT_MOCK`: serve the endpoint's `default` fixture. `REAL`: proxy to the live upstream — the classic "mock a few curated users, pass everyone else through" setup. |
| `PASSTHROUGH_TIMEOUT_MS` | Number of milliseconds<br>(default `30000`) | Timeout for `real` upstream requests. A timeout returns `504`. |
| `MOCK_CONSOLE_LOG_LEVEL` | `info` (default)<br>`warn`<br>`error` | Controls one-line console request logs. `info` logs every matched or unmatched mock request. `warn` logs warnings and errors. `error` logs only framework/routing/setup failures. See [Request logs](request-logs.md). |

!!! note "Scope"

    `UNMOCKED_USERS` applies *only* to the profile-lookup miss on profiled
    endpoints. Malformed requests — invalid JSON body, a selector that doesn't
    resolve — are always loud `400`s, in every configuration. Global endpoints do
    not use `UNMOCKED_USERS`.

!!! warning "Startup and runtime checks"

    `PASSTHROUGH_AS_DEFAULT=true` requires every system's `baseUrlEnv` to be set
    at startup. With `PASSTHROUGH_AS_DEFAULT=false`, missing base URLs are allowed
    until a request actually resolves to `real`; then the mock API returns `500`.

## Validation rules

`npm run validate:catalog` (and the server at startup) run two passes. The first
walks the tree looking for **structural** problems; if it finds any, it stops
there and reports *all of them at once* as a single startup error — nothing else
runs until the tree itself is well-formed:

- Every entry directly under `catalog/` is a directory (a system) — anything else
  is a stray entry.
- Every system directory has a `_system.json` that parses as a JSON object with
  non-empty `name` and `baseUrlEnv` strings.
- Every entry inside a system directory (other than `_system.json`) is a directory
  (an endpoint) — anything else is a stray entry.
- Every endpoint directory has an `_endpoint.json` that parses as a JSON object
  with non-empty `displayName`, `method`, and `path` strings. If present,
  `mockType` is `profiled` or `global`; `profileIdSelector` is a non-empty string;
  and `captureProfileKeys` is an array of objects with non-empty `namespace` and
  `keySelector` strings.
- Every entry inside an endpoint directory (other than `_endpoint.json`) is a file
  named `<scenario>.json`, where `<scenario>` matches `[a-z0-9][a-z0-9_-]*` —
  anything else (wrong case, bad characters, a sub-directory) is a stray entry.
- Dotfiles anywhere in the tree are silently ignored, not flagged.

Once the tree parses structurally, a second pass checks **semantics** against the
now-known catalog and reports its own list of errors:

- Every `path` is a well-formed template starting with `/`.
- Profiled endpoints must declare `profileIdSelector`; global endpoints must not
  declare `profileIdSelector` or `captureProfileKeys`.
- Every profiled `profileIdSelector` is valid. It may use body/path/query, a
  `profileKey` lookup, `bearer`, or `bearer:<claim>`. Bearer claim names match
  `[a-zA-Z_][a-zA-Z0-9_-]*`. A `path:` selector, including one nested inside
  `profileKey`, must reference a `{param}` that exists in the template.
- Every `captureProfileKeys` namespace matches `[a-z0-9][a-z0-9_-]*`; every
  `keySelector` is a valid reusable body/path/query selector (not Bearer); and
  `captureProfileKeys` is allowed only when a profiled endpoint's
  `profileIdSelector` resolves the profile directly.
- Every endpoint has a `default.json` scenario file, and **must not** have a
  `real.json`.
- Each scenario file is valid JSON with a numeric `status` and a `body` key.
  Fixtures are loaded into memory as part of this pass.
- Every placeholder inside a fixture is either `now:iso` / `now:YYYYMMDD` or a
  valid body/path/query selector (never Bearer), and any `path:` placeholder
  references a declared param.
- No two endpoints of the same method have **overlapping** path templates (which
  would make matching ambiguous).
- If an endpoint has a `_schema.json`, it must compile as valid JSON Schema, and
  every scenario fixture's `body` must match its status-matched response schema —
  see [Schemas](schemas.md).
- `PASSTHROUGH_AS_DEFAULT=true` → every system's `baseUrlEnv` is set.

Since scenarios are now just the files present on disk, there's no such thing as
an "orphan" fixture anymore — every `<scenario>.json` that structurally belongs in
an endpoint directory automatically *is* a declared scenario.
