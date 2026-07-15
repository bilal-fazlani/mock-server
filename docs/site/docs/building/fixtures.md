# Fixtures

## Fixtures

A fixture is a JSON file with this shape:

```json
{
  "description": "Balance available", // optional, shown as the scenario's label in the UI
  "status": 200,                       // required, numeric HTTP status
  "headers": { "x-foo": "bar" },       // optional
  "body": { /* any JSON */ }           // required (key must be present; value may be any JSON)
}
```

- `description` is optional free text used as the scenario's label wherever the UI
  lists scenarios (profile form, catalog viewer). If omitted, the UI falls back to
  showing the filename (the scenario key) instead.
- `status` is required and must be a number.
- The `body` key must be present (its value can be an object, array, string,
  number, etc.).
- `content-type: application/json` is added to the response automatically; any
  headers you declare merge over it.
- String values in `body` and `headers` may contain [placeholders](#placeholders).
- Fixtures are loaded into memory at startup and served from that cache in
  production (re-read per request in development).

## Placeholders

Anywhere inside a fixture *string* (in `body` or `headers`), `{{ … }}` is
substituted at request time. Two kinds:

| Placeholder | Resolves to |
| --- | --- |
| `{{now:iso}}` | Current timestamp, ISO-8601 (e.g. `2026-07-03T10:15:00.000Z`) |
| `{{now:YYYYMMDD}}` | Current date, compact (e.g. `20260703`) |
| `{{$.path.in.body}}` | A value pulled from the request body |
| `{{path:name}}` | A path parameter from the URL |
| `{{query:name}}` | A query-string parameter |

Selector placeholders use the reusable body/path/query selector grammar, so you
can echo request data straight into the response (e.g.
`"customerId": "{{$.customerId}}"`). Bearer selectors are deliberately not
available to placeholders, so an authorization credential cannot be echoed into a
fixture response. Substitution is string-only; the resolved value is inserted as
text.

!!! warning "Placeholders must resolve"

    If a selector placeholder can't find its value in the request, the endpoint
    returns `500` for that request. An unknown `now:` formatter is a hard error
    too (only `iso` and `YYYYMMDD` exist). The catalog validator catches malformed
    placeholders ahead of time — resolution against a specific request is the one
    thing it can't pre-check.
