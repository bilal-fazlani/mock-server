# Fixtures

## Fixtures

Not every scenario is a fixture — a scenario can instead be backed by a
`<slug>.mjs` resolver that computes its outcome at request time; see
[Code-backed scenario resolvers](dynamic.md). This page covers the
fixture-backed (`<slug>.json`) case.

A fixture is a JSON file with this shape:

```json
{
  "description": "Balance available", // optional, shown as the scenario's label in the UI
  "summary": "200 with the settled balance", // optional, shown under the label in the catalog viewer
  "status": 200,                       // required, numeric HTTP status
  "delay": "400ms",                    // optional, wait this long before responding
  "headers": { "x-foo": "bar" },       // optional
  "body": { /* any JSON */ }           // required (key must be present; value may be any JSON)
}
```

- `description` is optional free text used as the scenario's label wherever the UI
  lists scenarios (profile form, catalog viewer). If omitted, the UI falls back to
  showing the filename (the scenario key) instead.
- `summary` is optional free text shown as a secondary line beneath the label on
  the catalog viewer's endpoint page — room for a sentence of context the short
  label can't carry. It appears only there (not in the profile form or logs), and
  an empty string is treated as absent.
- `status` is required and must be a number.
- `delay` is optional; see [Response delay](#response-delay) below.
- The `body` key must be present (its value can be an object, array, string,
  number, etc.).
- `content-type: application/json` is added to the response automatically; any
  headers you declare merge over it.
- String values in `body` and `headers` may contain [placeholders](#placeholders).
- Fixtures are loaded into memory at startup and served from that cache in
  production (re-read per request in development).

## Response delay

A fixture can declare a `delay` to make the mock wait before it responds — for
exercising client timeouts, spinners, retry/backoff, and circuit breakers
against a slow dependency:

```json
{
  "status": 200,
  "delay": "400ms",
  "body": { "ok": true }
}
```

- The value is a duration string: a non-negative integer followed by a unit,
  one of `ms`, `s`, or `m` (e.g. `"400ms"`, `"2s"`, `"1m"`). `"0ms"` is a valid
  no-op. A malformed `delay` is a catalog error caught at startup, not a runtime
  surprise.
- The delay applies only when the fixture is served — error responses and `real`
  passthrough are never delayed.
- Because a delay lives on a single scenario's fixture, and fixtures are selected
  per profile, you can make *one caller's* endpoint slow while everyone else stays
  fast — set `delay` on that profile's fixture.
- The injected wait is folded into the request's total duration and also recorded
  separately; see [Request logs](../driving/request-logs.md).

## Placeholders

Anywhere inside a fixture *string* (in `body` or `headers`), `{{ … }}` is
substituted at request time. Two kinds:

| Placeholder | Resolves to |
| --- | --- |
| `{{now:iso}}` | Current timestamp, ISO-8601 (e.g. `2026-07-03T10:15:00.000Z`) |
| `{{now:YYYYMMDD}}` | Current date, compact (e.g. `20260703`) |
| `{{now:date}}` | Current date, `YYYY-MM-DD` (e.g. `2026-07-03`) |
| `{{now:time}}` | Current wall-clock time, `HH:MM:SS` (e.g. `10:15:00`) |
| `{{now:epoch}}` | Unix time in seconds (e.g. `1782987630`) |
| `{{now:epochMillis}}` | Unix time in milliseconds (e.g. `1782987630000`) |
| `{{now+3d:iso}}` | ISO-8601 timestamp offset by `+3` days from request time |
| `{{now-15m:iso}}` | ISO-8601 timestamp offset by `-15` minutes from request time |
| `{{$.path.in.body}}` | A value pulled from the request body |
| `{{path:name}}` | A path parameter from the URL |
| `{{query:name}}` | A query-string parameter |
| `{{header:name}}` | A request header, matched case-insensitively |

The `now` placeholder takes the form `now[±<n><unit>]:<format>`. The `<format>`
is one of a fixed, named set — `iso`, `YYYYMMDD`, `date`, `time`, `epoch`, or
`epochMillis` — and the offset is optional, with `unit` being `s` (seconds),
`m` (minutes), `h` (hours), or `d` (days). Offsets and formats compose freely:
`{{now+1h:iso}}`, `{{now-7d:YYYYMMDD}}`, or `{{now+1h:epoch}}` for a timestamp
one hour in the future as Unix seconds. Both the offset and the format name are
statically validated, so an invalid `now` expression is a catalog error, not a
runtime surprise. All formats are computed in UTC.

Selector placeholders use the reusable body/path/query/header selector grammar,
so you can echo request data straight into the response (e.g.
`"customerId": "{{$.customerId}}"`). Bearer selectors are deliberately not
available to placeholders, so an authorization credential cannot be echoed into a
fixture response.

### Echoing a request header

`{{header:name}}` reads a request header, which is the usual way to hand a
correlation ID back to the caller — in the body, in a response header, or both:

```json
{
  "status": 200,
  "headers": { "x-request-id": "{{header:x-request-id}}" },
  "body": { "traceparent": "{{header:traceparent}}", "status": "ACTIVE" }
}
```

```bash
curl <origin>/accounts/balance -H 'X-Request-Id: req-42'
```

Header names are matched **case-insensitively**, so `{{header:x-request-id}}` and
`{{header:X-Request-Id}}` are the same selector and both match whatever casing the
caller sent. The name must match `[a-zA-Z_][a-zA-Z0-9_-]*` — the wider character
set HTTP allows includes `'` and `|`, which are separators in the placeholder
grammar.

!!! warning "Credential headers cannot be echoed"

    `authorization`, `proxy-authorization`, `cookie`, and `set-cookie` are
    rejected. Writing `{{header:cookie}}` is a **catalog error at startup**, not a
    blank value at request time — the mock will not start until the placeholder is
    removed. This is the same guarantee that keeps Bearer selectors out of
    placeholders.

A header the caller did not send is an unresolved placeholder, which fails the
request with a `500` naming it — the same loud behavior as an absent body field.

## Placeholder expressions

Every placeholder is parsed as an **expression**: a source value — a selector or
a `now` token — optionally piped through **function calls**:

```json
{
  "name": "{{$.name | upper}}",
  "label": "{{label:$.status}}"
}
```

The grammar, in full:

- **Call:** `name:arg:arg` — a function name followed by colon-separated
  arguments (`label:$.status`, `pad:'007'`).
- **Pipe:** `|` composes calls left to right; `x | f:a` passes the previous
  value as `f`'s first argument. Only function calls may follow a `|` — the
  selector/`now` forms are valid only as the leading stage.
- **Typed arguments:** a decimal number becomes a number, `true`/`false` become
  booleans, a `'single-quoted'` token is a literal string (quotes stripped —
  and `:` or `|` inside the quotes are literal characters, not separators), a
  `$.…` token is resolved against the request body, and any other bare token is
  a string. A quote only opens a literal at the **start** of a token, so an
  apostrophe inside a bare word stays ordinary text (`label:it's` is the string
  `it's`); a quote that opens a token and never closes (`pad:'oops`) is a
  catalog error, not a literal.
- Call arguments accept **body selectors and literals only**. `path:`, `query:`,
  and `header:` values can't be passed as arguments — start the chain with them
  (`{{path:id | upper}}`, `{{header:x-request-id | upper}}`) or read them from `context.request` inside a custom
  function.

Function names resolve to a [built-in transform](#built-in-transforms) or a
[custom function](#custom-functions-_functionsmjs); anything else is a catalog
error at startup, never a runtime surprise.

## Built-in transforms

| Transform | Effect |
| --- | --- |
| `upper` | Uppercase the piped value |

The set is deliberately small today; seeded randomness, fake data, hashing, and
more string filters are planned as additional built-ins on this same mechanism.
Built-in names (including `now`, `body`, `path`, `query`, `header`, and
`profileKey`) are reserved — a custom function may not use them.

## Custom functions (`_functions.mjs`)

When the built-ins can't express what a fixture needs — formatting, derived
values, combining request inputs — export your own functions from a
`_functions.mjs` file in the catalog:

```js
// catalog/hello-system/_functions.mjs
export const label = (_ctx, status) => `CUSTOMER: ${String(status).toUpperCase()}`
```

```json
{ "label": "{{label:$.status}}" }
```

Each **named export** becomes a callable function. The contract is
`(context, ...args)`. A `default` export has no name for a placeholder to call,
so it is a catalog error at startup — export named functions instead.

- **Prefer explicit arguments.** Pass request data in as arguments
  (`label:$.status`) — it keeps functions inspectable and reusable. Arguments
  arrive already resolved: selectors as their extracted values, literals as
  typed values, the piped value first.
- **`context` is the escape hatch** for multi-source cases: `context.request`
  carries `method`, `path`, `pathParams`, `query`, `headers`, and `body`;
  `context.now` is the request timestamp; `context.seed` is stable per
  `(profile, endpoint)` for reproducible pseudo-randomness.

A `_functions` file may live at three levels, and the **nearest definition
wins** when names collide:

| Level | Location | Visible to |
| --- | --- | --- |
| Catalog | `catalog/_functions.mjs` | every endpoint |
| System | `catalog/<system>/_functions.mjs` | that system's endpoints |
| Endpoint | `catalog/<system>/<endpoint>/_functions.mjs` | that endpoint's fixtures |

Functions run in the same sandbox as
[scenario resolvers](dynamic.md#compilation-sandboxing-and-timeouts): compiled
once at startup, executed in an empty `node:vm` context with a **100 ms
per-call timeout**, no `require`, `process`, `fetch`, or `console`. In
practice:

- **No imports.** The sandbox has no `require`, so an `import` fails at
  catalog load. Everything a function needs arrives through its arguments and
  `context`.
- **Write pure functions.** Module-level mutable state survives across requests
  for the life of the process — it is not part of the contract. Derive
  variability from `context.now` and `context.seed` instead of `Date`/`Math.random`
  so responses stay reproducible.
- **Failures are loud.** A function that throws, exceeds its timeout, or
  returns something unusable fails the request with a `500` naming the function
  and the placeholder — never a silent empty string.

### Editor support (optional)

For autocomplete on `context` in any editor, paste this self-contained JSDoc
block at the top of the file — it needs nothing installed and no
`tsconfig.json`, and is safe to delete:

```js
// @ts-check
/** @typedef {{request: {method: string, path: string,
 *   pathParams: Record<string,string>, query: Record<string,string[]>,
 *   headers: Record<string,string>, body: unknown},
 *   now: Date, seed: string}} FnContext */

/** @param {FnContext} ctx */
export const whoami = (ctx) => ctx.request.headers['x-user'] ?? 'anonymous'
```

With `// @ts-check` on, the editor also flags typos like
`ctx.request.params` (it is `pathParams`) before a request ever runs.

### Errors

Catalog errors are raised at startup, so the server never begins serving with a
broken `_functions` file. Request errors return a `500` and are recorded in the
[request trace](../driving/request-logs.md) under their own code.

| Situation | Trace error code | When |
| --- | --- | --- |
| The file fails to transpile or throws while evaluating | — | Startup. The catalog does not load. |
| The file has a `default` export, or exports a [reserved name](#built-in-transforms) | — | Startup. The catalog does not load. |
| A `_functions.ts` file exists (`.ts` authoring was removed) | — | Startup. The catalog does not load — rename it to `_functions.mjs` and remove type annotations. |
| The function throws | `function_error` | Request time. |
| The function exceeds its 100&nbsp;ms timeout | `function_timeout` | Request time — guards against a runaway synchronous loop. |
| The function returns something with no JSON representation — `undefined`, a function, a symbol, a bigint, or a non-finite number (`NaN`, `Infinity`) | `function_error` | Request time. |
| The placeholder itself fails — an unresolved selector, or an unknown function name | `template_error` | Request time. |

The function codes are deliberately distinct from `template_error` so a log
reader can tell an author's function apart from a bad placeholder; the `500`
body is identical either way.

## Typed substitution

Substitution preserves types. When a fixture string is **exactly one
placeholder**, the resolved value is emitted raw — numbers stay numbers,
booleans stay booleans, and a function may even return an object or array:

```json
{ "amount": "{{$.amount}}" }   // → { "amount": 42 }, not { "amount": "42" }
```

When a placeholder is **interpolated** into surrounding text (including two
adjacent placeholders), the value is coerced to a string — objects and arrays
as JSON. Response **header** values are always rendered as strings, whatever
the placeholder shape.

!!! note "Body selectors extract any JSON value"

    A `$.…` selector pulls out **whatever JSON value the field holds** — strings,
    numbers, booleans, `null`, and whole object or array subtrees. `{{$.isActive}}`
    against `{ "isActive": false }` emits `false`; `{{$.user}}` echoes the entire
    `user` subtree. A field that is literally JSON `null` resolves to `null` — a
    *present* value, distinct from an absent one. Only a path that isn't there at
    all (a missing key or an out-of-range array index) is unresolved, and that
    fails with a `500` like any other unresolved placeholder.

!!! warning "Placeholders must resolve"

    If a selector placeholder can't find its value in the request, or a custom
    function fails, the endpoint returns `500` for that request. Everything
    checkable ahead of time is checked at startup — malformed expressions,
    unknown `now:` formats, and unknown function names (including a function
    defined only in *another* system's scope) are catalog errors — but
    resolution against a specific request is the one thing validation can't
    pre-check.
