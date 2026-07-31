# Console logs

The server prints one line per request to stdout, independent of the
[request log](request-logs.md) it writes to MongoDB. Two settings govern the
stream, and they are orthogonal:

| Variable | Controls |
| --- | --- |
| `MOCK_CONSOLE_LOG_LEVEL` | **Whether** a line is printed — the severity threshold. |
| `MOCK_LOG_FORMAT` | **How** it is serialized — `text` (default) or `json`. |

Both are documented as settings in
[Configuration](../reference/configuration.md#app-configuration).

## Severity levels

`MOCK_CONSOLE_LOG_LEVEL` sets the threshold; every line is classified as `info`,
`warn`, or `error` and printed through the matching `console` method.

| Level | Covers |
| --- | --- |
| `info` (default) | Every matched or unmatched mock request. |
| `warn` | Suspicious-but-served cases: `UNMOCKED_USERS` fallback, schema drift on `real`, failed Mongo request-log writes, and `no_match`. |
| `error` | Framework, routing, and setup failures. |

Fixture responses are `info` even when the fixture's status is non-2xx — the mock
served the selected scenario correctly. `error` covers invalid JSON, unresolved
selectors, missing mappings, stale scenario pins, template errors
(`template_error`, plus `function_error` and `function_timeout` for failures
inside a [custom function](../building/templating.md#errors)), missing passthrough
base URLs, passthrough failures, and resolver failures (`resolver_missing`,
`resolver_threw`, `resolver_timeout`, `resolver_bad_return`, and — in
development — `resolver_compile_error`; see [Code-backed scenario
resolvers](../building/dynamic.md#errors)).

Requests whose path begins with `/_next/` are filtered out of console logs
entirely, the same way they are skipped by the request log.

## Text format (default)

`MOCK_LOG_FORMAT=text` prints a compact one-liner built for a terminal:

```text
[mock] POST /invoices?verbose=true -> 200 252ms billing/create-invoice profile=customer-123 scenario=default outcome=fixture delay=250ms
```

Method, path, status, and duration always appear. The trailing `key=value`
details are added only when they apply: `<system>/<endpoint>` once routing
matched, `profile=` once a profile ID resolved, `scenario=`, `outcome=`,
`delay=<n>ms` when the served fixture declared a [response
delay](../building/fixtures.md#response-delay), `source=unmocked_policy`,
`error=<code>`, and `validation=request:drift_warning` /
`validation=response:drift_warning`.

Text is the default because this ships as an `npx` binary people run in their own
terminal.

## JSON format

`MOCK_LOG_FORMAT=json` prints one object per line instead, so a log aggregator can
filter on scenario, outcome, or profile rather than grepping a formatted string:

```json
{"@timestamp":"2026-07-31T16:48:04.417Z","log.level":"info","message":"[mock] POST /invoices?verbose=true -> 200 252ms billing/create-invoice profile=customer-123 scenario=default outcome=fixture delay=250ms","service.name":"mock-server","service.version":"0.5.0","http.request.method":"POST","url.path":"/invoices","url.query":"verbose=true","http.response.status_code":200,"event.duration":252000000,"mock.logId":"lg_b3b1d97a6ab8","mock.system":"billing","mock.endpoint":"create-invoice","mock.profileId":"customer-123","mock.scenario":"default","mock.scenarioSource":"implicit","mock.outcome":"fixture","mock.delayMs":250}
```

The severity threshold applies exactly as it does in text mode — `json` changes
the serialization, not what gets logged. The human one-liner is kept verbatim as
`message`, so a JSON stream is still readable by eye.

### Field mapping

Names follow [ECS](https://www.elastic.co/guide/en/ecs/current/index.html), which
Kibana understands natively and Datadog can be pointed at. Everything specific to
this server lives under `mock.*` so it cannot collide with other services sharing
an index. **A field is omitted entirely when it does not apply** — absent, never
`null`.

| Field | Value |
| --- | --- |
| `@timestamp` | Request time, ISO-8601. |
| `log.level` | `info`, `warn`, or `error` — the same severity the threshold is compared against. |
| `message` | The text-format one-liner, kept as the human summary. |
| `service.name` | Always `mock-server`. |
| `service.version` | This build's version. |
| `http.request.method` | Request method. |
| `url.path` | Request path, without the query string. |
| `url.query` | Query string **without** the leading `?`. Omitted when there is none. |
| `http.response.status_code` | Response status. |
| `event.duration` | Total request duration in **nanoseconds** (see below). |
| `mock.logId` | The `x-mock-log-id` value for this request. |
| `mock.system` / `mock.endpoint` | Catalog system slug and endpoint name, once routing matched. |
| `mock.profileId` | Resolved profile ID, once one resolved. |
| `mock.scenario` | Served scenario slug — the resolver's return value when the scenario is resolver-backed. |
| `mock.scenarioSource` | How that scenario was selected: `pin`, `sequence`, `implicit`, `global`, or `unmocked_policy`. |
| `mock.outcome` | `fixture`, `passthrough`, or `error`. |
| `mock.delayMs` | Injected [response delay](../building/fixtures.md#response-delay) in milliseconds, when the fixture declared one. |
| `mock.validation.request` / `mock.validation.response` | `ok`, `failed`, or `drift_warning`. |
| `mock.error.code` | Error code, when the request failed. |
| `mock.upstream.status` / `mock.upstream.durationMs` | Real upstream status and latency, on `real` passthrough. |

Three naming choices are deliberate and worth knowing:

- **The HTTP status is never a top-level `status`.** Datadog reserves that name
  for the log severity and would read `200` as a level, so the status lives at
  `http.response.status_code`.
- **`event.duration` is nanoseconds**, because that is the unit ECS defines for
  it — emitting milliseconds under that name makes Kibana and Datadog render
  `252ms` as `252ns`. Every `mock.*` duration carries its unit in the name
  instead (`mock.delayMs`, `mock.upstream.durationMs`), so units are never a
  guess.
- **Keys are flat and dotted** (`"mock.scenario"`), not nested objects.
  Elasticsearch and Datadog both accept this, and it stays grep-able in a raw
  terminal stream.

`mock.logId` is the bridge back to the full request: it is the same value the
response returns as `x-mock-log-id`, so a line found in Kibana pastes straight
into the log-ID filter at `/ui/logs` for the headers and bodies, which the
console line never carries.

### Lines that are not requests

Everything the server itself prints — catalog warnings, the embedded-MongoDB
notice, the resolver-history sweep, a failed request-log write — goes through the
same formatter, so a `json` stream has no stray human-readable lines in it. Those
lines carry `@timestamp`, `log.level`, `message`, and `service.*` like any other,
plus an `event.action` naming what happened (`catalog_warning`,
`embedded_mongo_start`, `resolver_history_pruned`).

!!! warning "The stream is not pure JSON"

    Next.js prints its own startup and compile output, and the embedded
    `mongodb-memory-server` prints its own, neither in this format. Collectors
    handle a mixed stream — non-JSON lines arrive as raw messages with no parsed
    fields — but the parse failures are expected rather than a misconfiguration.
    Only the lines this server emits are guaranteed to be JSON.

## What is not on the console line

Headers and bodies. Those are stored, redacted, in the
[request log](request-logs.md) and browsable at `/ui/logs`; the console stays
metadata-only in both formats.
