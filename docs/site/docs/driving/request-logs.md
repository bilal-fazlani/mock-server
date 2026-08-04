# Request logs

## What is recorded

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

## Header redaction

Persisted request headers preserve their names and values except `Authorization`,
whose value is always stored as `[REDACTED]` (case-insensitive header match).
Routing and `real` passthrough still receive the original header; redaction
happens only when the log entry is built. If the opaque token itself is the
configured profile ID, that value still appears as the resolved profile ID and
decision-trace value — use synthetic mock tokens rather than real credentials.

## Distributed trace correlation

When the calling service carries a [W3C Trace
Context](https://www.w3.org/TR/trace-context/) `traceparent` header, the server
records the trace ID it names as a top-level `traceId` on the log entry, prints
it on the [console line](console-logs.md) as `trace.id`, and shows it beside the
log ID in the `/ui` detail panel. That gives the mock server's own lines a join
key against every other service's lines for the same request, with no
cooperation from the caller — search one trace ID in your aggregator and the
mock server's account of what the fake upstream returned, and why, comes back
with the rest of the trace.

Two headers are read, in order:

| Header | Value recorded |
| --- | --- |
| `traceparent` | The 32-hex trace ID out of `00-<trace-id>-<span-id>-<flags>`. |
| `x-request-id` | The header value verbatim — the ID a mesh such as Envoy generates even where nothing is W3C-instrumented. |

So `traceId` is always 32 lowercase hex, or it is a caller-supplied request ID.

A malformed value at either level is **ignored**, never reported as an error:
this is diagnostic metadata and must never affect the response. Ignored are a
`traceparent` that is not lowercase hex in the shape above, the all-zero trace ID
and version `ff` (both invalid per the spec), and an `x-request-id` that is
blank, over 200 characters, or contains control characters. A malformed
`traceparent` falls through to `x-request-id`. An unknown version prefix with
extra trailing fields is *accepted* — the spec reserves the right to append them.

**The field is omitted when the request carried no trace header.** No synthetic
ID is minted: one would join with nothing, and `logId` already answers "identify
this one request". Admin entries (profile saves, progress resets) never carry a
trace ID, having no request context.

!!! note

    Nothing needs configuring for the trace to keep flowing *outward*: `real`
    passthrough already forwards `traceparent` to the upstream API untouched,
    along with every other non-hop-by-hop request header.

Only the trace ID and its sampled flag are read — the caller's span ID is not
recorded, and no spans are emitted. This is log correlation, not an
OpenTelemetry integration. On the console line the sampled flag appears as
`mock.traceSampled`, which explains the otherwise-puzzling case of a trace ID in
these logs whose trace never reached your tracing backend. B3 (`x-b3-traceid`)
and `x-amzn-trace-id` are deliberately not read.

## Console summary

Alongside this persisted log, the server prints a compact summary of each request
to stdout — as a human one-liner by default, or as one ECS-style JSON object per
line for a log aggregator. Which requests are printed, what each severity covers,
and the full JSON field mapping are documented in
[Console logs](console-logs.md).

## Browsing and retention

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

## Timestamps

Every row is stamped with the full date and time down to the millisecond —
`2026-08-04 21:14:30.421` — rendered in **your browser's timezone**. The zone in
use is named above the list, as `Times in Asia/Kolkata (GMT+5:30)`, so a reading
is never ambiguous about which clock it is on. The same label sits on a profile
page's **Recent activity** card.

The date is on the row rather than in a day heading because the retention window
spans midnight even at its 24-hour default: a time of day alone cannot separate
today's `21:14` from yesterday's.

Hover a timestamp to read the same instant in **UTC**. That is the value to
correlate against — [console logs](console-logs.md) print `@timestamp` in UTC,
and so does every other UTC-keyed aggregator — while the row itself stays on the
clock you are actually reading it by.

!!! note

    The two surfaces disagree on purpose. A row showing `21:14:30.421` and a
    console line showing `20:14:30.421Z` are the same request from a `GMT+1`
    browser, not two requests — the tooltip is what proves it.
