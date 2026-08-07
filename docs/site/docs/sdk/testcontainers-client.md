# Testcontainers & the client

Two of the four modules carry no test framework at all. Reach for them when the
[JUnit DSL](junit.md) is the wrong shape:

- **TestNG, Spock, Kotest, or no test framework** — `MockServerContainer` and
  `MockServerClient` are ordinary Java objects.
- **A second server in one test class**, which the JUnit extension refuses.
- **Something the DSL does not cover** — staged multi-endpoint writes, log
  queries, or reading a stored profile back.

Inside a JUnit suite, `mock.client()` and `profile.client()` hand you the same
client the DSL is driving. Nothing here needs a second one.

## The container

`MockServerContainer` is a Testcontainers `GenericContainer`. Every inherited
method — environment variables, networks, log consumers, reuse — works as usual;
this class adds only what is specific to the image.

```java
MockServerContainer server =
        new MockServerContainer().withCatalog(Path.of("src/test/resources/catalog"));
server.start();

server.client()
        .profile("customer-123")
        .endpoint("payments", "charge").serves("card_declined")
        .apply();

// …exercise the system under test against server.baseUrl(), then:
server.stop();
```

| Member | Purpose & rules |
| --- | --- |
| `new MockServerContainer()` | Runs `ghcr.io/bilal-fazlani/mock-server:latest`. |
| `new MockServerContainer(String \| DockerImageName)` | Runs an explicit image. Parsed as a **whole reference**, not a bare tag. An image that is not `DEFAULT_IMAGE_NAME` must declare compatibility with `asCompatibleSubstituteFor`, for a private mirror or a fork. |
| `withCatalog(String \| Path)` | Bind-mounts the directory read-only and points `CATALOG_PATH` at it. Throws if the path is not a directory. |
| `withStartupTimeout(Duration)` | Inherited. How long to wait for health; `DEFAULT_STARTUP_TIMEOUT` is 2 minutes. |
| `baseUrl()` | `http://host:mappedPort` — no trailing slash, no path. |
| `client()` | A `MockServerClient` bound to `baseUrl()`, created on first call and cached with its catalog. |

`start()` does not return until `GET /ui/api/health` answers `200`. The container's
port opens before its MongoDB connection is established, so a listening socket
alone does not mean a mocked call can be served yet.

To pin a version, combine the default name with a tag rather than reaching for a
static helper:

```java
new MockServerContainer(MockServerContainer.DEFAULT_IMAGE_NAME.withTag("0.9.2"));
```

!!! warning "The catalog must be world-readable"

    The container runs as a fixed, unprivileged, non-root user, so every file
    under the mounted directory must be at least world-readable and every
    directory world-traversable on the host — which a checked-out git working tree
    already is (`644`/`755`). A directory locked down to its owner alone reads as
    empty, or fails, inside the container even though it looks fine outside.

The server reads its catalog once, at its own startup. Editing the mounted
directory while the container runs changes nothing until it restarts. Treat one
`MockServerContainer` as good for one start/stop cycle — a restart that remaps the
port leaves an already-obtained `client()` addressing the old one.

## The runtime-control client

`MockServerClient` is a fluent client for the whole [runtime-control
API](../driving/api.md). Instances are thread-safe and meant to be shared, one per
server; the handles they hand out are per-interaction builders and are not.

```java
MockServerClient client = MockServerClient.create("http://localhost:3000");
```

`MockServerClient.builder(baseUrl)` changes the defaults: a 5-second connect
timeout, a 10-second request timeout, the `ObjectMapper` JSON handling is derived
from (copied, never mutated), or the whole `HttpClient`.

### Profiles

Unlike the JUnit DSL, a `ProfileHandle` **stages** locally and sends nothing until
`apply()`:

```java
client.profile("customer-123")
      .displayName("checkout smoke test")
      .endpoint("payments", "charge").serves("card_declined")
      .endpoint("payments", "refund").servesSequence("pending", "settled")
      .apply();
```

`apply()` is a read-modify-write: it fetches the stored profile, merges the staged
changes over it, and sends one `PUT`. The merge is necessary because the server
replaces `endpointScenarios` wholesale, so writing only the staged endpoints would
drop every selection made earlier. Ask for that wholesale replacement explicitly
with `clearScenarios()`. It is not atomic against a concurrent writer of the same
profile — the API offers no compare-and-set, and the last write wins.

| Call | What it does |
| --- | --- |
| `get()` | The stored profile, or empty when none has been written under this ID. |
| `apply()` | Commits the staged selections and returns the stored profile. The server normalises on the way in, so what comes back may differ from what was staged. |
| `reset()` / `reset(endpoint)` | Rewinds sequence progress and resolver history. Leaves selections in place. |
| `delete()` | Removes the profile and everything keyed to it — mappings, sequence progress, resolver history, request logs. Idempotent. |

### Global mocks & the catalog

```java
client.globalMock("payments", "gateway_status").serves("outage");
client.globalMock("payments", "gateway_status").clear();

List<GlobalMockScenario> inForce = client.globalMocks();
```

`client.catalog()` returns the systems, endpoints, and declared scenarios the
server loaded at startup. It is fetched once and cached — the server reads its
catalog once, so within one server lifetime it cannot change. Every client-side
validation reads that cache, which is what keeps a typo from costing a round
trip. After a restart under a long-lived client, call `refreshCatalog()`.

### Request logs

```java
List<LogSummary> calls =
        client.logs().profile("customer-123").endpoint("charge").limit(50).fetch();

Optional<LogEntry> detail = client.logEntry(calls.get(0).logId());
```

`fetch()` returns summaries; `fetchFull()` returns entries with captured request
and response bodies. Filters mirror the [API's query
parameters](../driving/api.md#request-logs): `profile`, `endpoint`, `errorsOnly()`,
`validation(ValidationFilter)`, `logId`, `since` / `before` cursors, and `limit`
(clamped to 1–200 by the server).

`logEntry` returns empty when no entry has that ID — normally because it aged out
of the log's TTL window rather than because the ID was wrong.

### Health

`client.health()` returns normally for both the healthy `200` and the `503` that
says MongoDB is unreachable, since both carry the same body — read
`Health.healthy()` to tell them apart. This is what to poll while waiting for a
server to come up.

## Failures

| Exception | Means |
| --- | --- |
| `ClientValidationException` | Rejected locally against the cached catalog, before anything went over the wire — an unknown system, endpoint, or scenario, or an endpoint addressed as a global mock that is not one. The message names the valid alternatives. |
| `ApiErrorException` | The server answered non-2xx. Branch on `status()`, never on `error()`, whose wording changes freely. `code()` carries the [stable error code](../driving/api.md#error-codes) when the server sends one, and is empty against older servers. |
| `MockServerConnectionException` | No response at all: connection refused, a timeout, or an interrupted thread. Usually a server that is not running where the client was pointed. |
| `MockServerClientException` | The base class, and — raised directly — a response that could not be understood. Catch it to handle any interaction failure uniformly. |

## Forward compatibility

The client targets contract version `1.0.0` of the runtime-control API, and the
contract [evolves additively](../driving/api.md#stability-machine-readable-spec).
So the client never rejects a response for carrying something it does not
recognise: unknown JSON properties are ignored, and an unrecognised member of a
response-side enum reads as that enum's `UNKNOWN` constant.

No accessor in the client's model returns `null`. An optional field is an
`Optional` that becomes empty, and a list or map is an immutable empty one. Read
an empty `Optional` as "the server did not record this", which is often meaningful
in itself — an untraced request has no trace ID, and a side of an exchange with no
schema has no validation result, which is a different thing from having passed.
