# Request logs

Every request the mock server receives — *including* ones that match no endpoint
or fail profile resolution — is written to a request log with its full **decision
trace**: how the profile was resolved (directly or via a profile key lookup),
which scenario was chosen and why (profile pin, sequence step, implicit default,
global pick, or `UNMOCKED_USERS` policy), captured profile keys, placeholder
resolutions, schema-validation results, and — for `real` passthrough — the
upstream URL, status, and latency. The one exception is Next.js internal asset
noise: request paths beginning with `/_next/` are ignored by the request log.
Profile saves and sequence progress resets appear in the same stream as admin
events.

Persisted request headers preserve their names and values except `Authorization`,
whose value is always stored as `[REDACTED]` (case-insensitive header match).
Routing and `real` passthrough still receive the original header; redaction
happens only when the log entry is built. If the opaque token itself is the
configured profile ID, that value still appears as the resolved profile ID and
decision-trace value — use synthetic mock tokens rather than real credentials.

The server also prints compact console request lines controlled by
`MOCK_CONSOLE_LOG_LEVEL` (see [Configuration](configuration.md#app-configuration)).
At `info`, each mock request logs method, path, status, duration, system/endpoint,
profile ID when resolved, scenario, outcome, and error code when present. Fixture
responses are `info` even when their fixture status is non-2xx, because the mock
served the selected scenario correctly. `warn` is for suspicious-but-served cases
such as `UNMOCKED_USERS` fallback, schema drift on `real`, failed Mongo
request-log writes, and `no_match`. `error` is for framework/routing/setup
failures such as invalid JSON, unresolved selectors, missing mappings, stale
scenario pins, template errors, missing passthrough base URLs, and passthrough
failures. `/_next/` paths are filtered out of console request logs too.

Browse and filter the log at `/ui/logs` (live-updating; filter by profile,
endpoint, errors, or log ID), or from a profile page's **Recent activity** card.
Every logged request response carries an `x-mock-log-id` header naming its entry —
print it on a test failure and paste it into the log-ID filter to jump straight to
that request's trace. Ignored `/_next/` responses do not carry that header.
Entries expire after **24 hours**, are deleted with their profile, and can be
cleared from the UI; request and response bodies over 16&nbsp;KB are stored
truncated.
