# Fixtures

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
- String values in `body` and `headers` may contain
  [placeholders](templating.md).
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

String values in `body` and `headers` are templates: anything inside `{{ … }}`
is substituted at request time — request data, timestamps, generated IDs, fake
data, transforms, even your own functions. The templating engine — placeholder
sources, the expression and pipe grammar, built-in transforms, custom
functions, and typed substitution — has its own page:
**[Placeholders & templating](templating.md)**.
