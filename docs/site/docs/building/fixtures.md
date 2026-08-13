---
description: "The <slug>.json fixture shape: status, headers, body, and per-fixture response delay."
---

# Fixtures

Not every scenario is a fixture — a scenario can instead be backed by a
`<slug>.mjs` resolver that computes its outcome at request time; see
[Code-backed scenario resolvers](dynamic.md). This page covers the
fixture-backed (`<slug>.json`) case.

A fixture is a JSON file with this shape — copy it into `<slug>.json` and edit
the values:

```json
{
  "description": "Balance available", // (1)!
  "summary": "200 with the settled balance", // (2)!
  "status": 200, // (3)!
  "delay": "400ms", // (4)!
  "headers": { "x-foo": "bar" }, // (5)!
  "body": { "available": 4250, "currency": "GBP" } // (6)!
}
```

1.  **Optional.** The scenario's label wherever the UI lists scenarios.
2.  **Optional.** A secondary line beneath the label, in the catalog viewer.
3.  **Required**, and a number.
4.  **Optional.** Wait this long before responding.
5.  **Optional.** Merged over the automatic `content-type`.
6.  **Required** — the key must be present, and its value may be any JSON:
    an object, an array, a string, a number.

Only `status` and `body` are required, so the smallest fixture that works is:

```json
{ "status": 200, "body": { "ok": true } }
```

- `description` is optional free text used as the scenario's label wherever the UI
  lists scenarios (profile form, catalog viewer). If omitted, the UI falls back to
  showing the filename (the scenario key) instead.
- `summary` is optional free text shown as a secondary line beneath the label —
  room for a sentence of context the short label can't carry. It appears on the
  catalog viewer's endpoint page and in the scenario pickers (a chip's hover
  card, and a sequence step's dropdown — see [The
  dashboard](../driving/ui.md#profiles-ui)); it still does not appear in logs,
  and an empty string is treated as absent.
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
