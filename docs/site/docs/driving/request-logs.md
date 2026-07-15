# Request logs

Every request the mock server receives — *including* ones that match no endpoint
or fail profile resolution — is written to a request log with its full **decision
trace**: how the profile was resolved (directly or via a profile key lookup),
which scenario was chosen and why (profile pin, sequence step, implicit default,
global pick, `UNMOCKED_USERS` policy, or the `dynamic` resolver), captured
profile keys, placeholder resolutions, schema-validation results, and — for
`real` passthrough — the upstream URL, status, and latency. The one exception is
Next.js internal asset noise: request paths beginning with `/_next/` are ignored
by the request log. Profile saves, sequence progress resets, and dynamic history
resets appear in the same stream as admin events.

When the resolved scenario is `dynamic`, the trace carries `trace.scenarioSource:
"dynamic"` plus the resolver's actual return value, e.g.
`trace.dynamic = { returned: "pending" }` (or `"real"`). The trace's `scenario`
field is overwritten with the *resolved* slug (the resolver's return value, not
the literal `dynamic` that was pinned) — so a log entry reads as "pinned
`dynamic` → resolver returned `pending` → outcome `fixture`", and a resolver
that returns `"real"` still shows the upstream URL/status/latency for that call.
Without `trace.dynamic`, a dynamic-then-real request would be indistinguishable
from a bare `real` pin. See [Dynamic scenarios](../building/dynamic.md) for the resolver
contract.

Persisted request headers preserve their names and values except `Authorization`,
whose value is always stored as `[REDACTED]` (case-insensitive header match).
Routing and `real` passthrough still receive the original header; redaction
happens only when the log entry is built. If the opaque token itself is the
configured profile ID, that value still appears as the resolved profile ID and
decision-trace value — use synthetic mock tokens rather than real credentials.

The server also prints compact console request lines controlled by
`MOCK_CONSOLE_LOG_LEVEL` (see [Configuration](../reference/configuration.md#app-configuration)).
At `info`, each mock request logs method, path, status, duration, system/endpoint,
profile ID when resolved, scenario, outcome, and error code when present. Fixture
responses are `info` even when their fixture status is non-2xx, because the mock
served the selected scenario correctly. `warn` is for suspicious-but-served cases
such as `UNMOCKED_USERS` fallback, schema drift on `real`, failed Mongo
request-log writes, and `no_match`. `error` is for framework/routing/setup
failures such as invalid JSON, unresolved selectors, missing mappings, stale
scenario pins, template errors, missing passthrough base URLs, passthrough
failures, and dynamic-resolver failures (`dynamic_resolver_missing`,
`dynamic_threw`, `dynamic_timeout`, `dynamic_bad_return`, and — in
development — `dynamic_compile_error`; see
[Dynamic scenarios](../building/dynamic.md#errors-and-drift)). `/_next/` paths are filtered
out of console request logs too.

Browse and filter the log at `/ui/logs` (live-updating; filter by profile,
endpoint, errors, or log ID), or from a profile page's **Recent activity** card.
New requests stream in at the top; scroll down to load older entries on demand.
While you are scrolled into history, new arrivals are held behind a **"N new"**
button instead of jumping the list — click it to return to the live view.
Every logged request response carries an `x-mock-log-id` header naming its entry —
print it on a test failure and paste it into the log-ID filter to jump straight to
that request's trace. Ignored `/_next/` responses do not carry that header.
Entries expire after **24 hours**, are deleted with their profile, and can be
cleared from the UI; request and response bodies over 16&nbsp;KB are stored
truncated.
