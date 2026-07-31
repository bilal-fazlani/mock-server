# Request logs

Every request the mock server receives — *including* ones that match no endpoint
or fail profile resolution — is written to a request log with its full **decision
trace**: how the profile was resolved (directly or via a profile key lookup),
which scenario was chosen and why (profile pin, sequence step, implicit default,
global pick, or `UNMOCKED_USERS` policy), captured profile keys, placeholder
resolutions, schema-validation results, any injected [response
delay](../building/fixtures.md#response-delay) (recorded as `trace.delayMs` and
folded into the entry's total `durationMs`), and — for `real` passthrough — the
upstream URL, status, and latency. The one exception is Next.js internal asset
noise: request paths beginning with `/_next/` are ignored by the request log.
Profile saves, sequence progress resets, and resolver history resets appear in
the same stream as admin events.

When the resolved scenario slug is resolver-backed, the trace's `scenario`
field is overwritten with the *resolved* slug — the resolver's return value,
not the pinned slug that ran it — and a separate `trace.resolver = { slug,
returned }` field records the pick, e.g. `{ slug: "default", returned:
"hold" }` for a `default.mjs` resolver that routed to `hold`.
`trace.scenarioSource` is **not** overwritten by the resolver; it keeps
reporting the original selection mechanism (`pin`, `sequence`, `implicit`,
`global`, or `unmocked_policy`), so a log entry reads as "source `implicit`,
scenario `default → hold`" — strictly more informative than
overwriting the selection mechanism would be, and a resolver that returns
`"real"` still shows the upstream URL/status/latency for that call. Without
`trace.resolver`, a resolver-then-real request would be indistinguishable from
a bare `real` pin. See [Code-backed scenario resolvers](../building/dynamic.md)
for the resolver contract.

Persisted request headers preserve their names and values except `Authorization`,
whose value is always stored as `[REDACTED]` (case-insensitive header match).
Routing and `real` passthrough still receive the original header; redaction
happens only when the log entry is built. If the opaque token itself is the
configured profile ID, that value still appears as the resolved profile ID and
decision-trace value — use synthetic mock tokens rather than real credentials.

Alongside this persisted log, the server prints a compact summary of each request
to stdout — as a human one-liner by default, or as one ECS-style JSON object per
line for a log aggregator. Which requests are printed, what each severity covers,
and the full JSON field mapping are documented in
[Console logs](console-logs.md).

Browse and filter the log at `/ui/logs` (live-updating; filter by profile,
endpoint, errors, or log ID), or from a profile page's **Recent activity** card.
New requests stream in at the top; scroll down to load older entries on demand.
While you are scrolled into history, new arrivals are held behind a **"N new"**
button instead of jumping the list — click it to return to the live view.
Every logged request response carries an `x-mock-log-id` header naming its entry —
print it on a test failure and paste it into the log-ID filter to jump straight to
that request's trace. Ignored `/_next/` responses do not carry that header.
Entries expire after a retention window that defaults to **24 hours** and is
configurable with `REQUEST_LOG_TTL_DURATION` (a duration string like `30m`,
`24h`, or `7d`; see [Configuration](../reference/configuration.md#app-configuration)).
They are also deleted with their profile and can be cleared from the UI; request
and response bodies over 16&nbsp;KB are stored truncated.
