# Fixtures

## Fixtures

Not every scenario is a fixture — a scenario can instead be backed by a
`<slug>.ts` resolver that computes its outcome at request time; see
[Code-backed scenario resolvers](dynamic.md). This page covers the
fixture-backed (`<slug>.json`) case.

A fixture is a JSON file with this shape:

```json
{
  "description": "Balance available", // optional, shown as the scenario's label in the UI
  "summary": "200 with the settled balance", // optional, shown under the label in the catalog viewer
  "status": 200,                       // required, numeric HTTP status
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
| `{{now:date}}` | Current date, `YYYY-MM-DD` (e.g. `2026-07-03`) |
| `{{now:time}}` | Current wall-clock time, `HH:MM:SS` (e.g. `10:15:00`) |
| `{{now:epoch}}` | Unix time in seconds (e.g. `1782987630`) |
| `{{now:epochMillis}}` | Unix time in milliseconds (e.g. `1782987630000`) |
| `{{now+3d:iso}}` | ISO-8601 timestamp offset by `+3` days from request time |
| `{{now-15m:iso}}` | ISO-8601 timestamp offset by `-15` minutes from request time |
| `{{$.path.in.body}}` | A value pulled from the request body |
| `{{path:name}}` | A path parameter from the URL |
| `{{query:name}}` | A query-string parameter |

The `now` placeholder takes the form `now[±<n><unit>]:<format>`. The `<format>`
is one of a fixed, named set — `iso`, `YYYYMMDD`, `date`, `time`, `epoch`, or
`epochMillis` — and the offset is optional, with `unit` being `s` (seconds),
`m` (minutes), `h` (hours), or `d` (days). Offsets and formats compose freely:
`{{now+1h:iso}}`, `{{now-7d:YYYYMMDD}}`, or `{{now+1h:epoch}}` for a timestamp
one hour in the future as Unix seconds. Both the offset and the format name are
statically validated, so an invalid `now` expression is a catalog error, not a
runtime surprise. All formats are computed in UTC.

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
