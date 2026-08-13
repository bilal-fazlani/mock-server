---
description: "The mock-server-junit Jupiter extension: a per-test profile, the injected handle, and the end-of-test schema check."
---

# JUnit 5 guide

`mock-server-junit` is a JUnit Jupiter extension. It gives each test a
[profile](../building/profiles.md) of its own, injects a handle for driving it,
and cleans up afterwards. Start from the [Java quick start](java-quickstart.md) if
you have not run a test yet.

## Add the dependency

```kotlin
// build.gradle.kts
dependencies {
    testImplementation("com.bilal-fazlani:mock-server-junit:2.0.0")

    // No versions needed: mock-server-junit exposes the JUnit BOM transitively.
    testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
```

```xml
<!-- pom.xml -->
<dependency>
  <groupId>com.bilal-fazlani</groupId>
  <artifactId>mock-server-junit</artifactId>
  <version>2.0.0</version>
  <scope>test</scope>
</dependency>
```

One artifact: it brings `MockServerContainer`, the runtime-control client, and
`junit-jupiter-api` with it. On Spring Boot, declare
[`mock-server-spring-boot-test`](spring-boot.md#add-the-dependency) instead —
`@MockServerTest` lives there, not here, and it adds everything on this page. See
[the versions the SDK pins](index.md#the-versions-the-sdk-pins) for what comes
along.

## Registering the extension

Register `MockServer` in a **`static` field**. An instance field would give every
test method a container of its own.

```java
@RegisterExtension
static final MockServer mock =
        MockServer.container().withCatalog("src/test/resources/catalog").build();
```

Nothing starts at declaration time. The container comes up on the first test that
needs it and is stopped when the whole test run ends — so the same `static` field
shared by several test classes still means one container: the first class to run
pays for the start.

| Builder call | Default | Purpose & rules |
| --- | --- | --- |
| `withCatalog(String \| Path)` | *(none)* | The catalog directory to serve, bind-mounted read-only. A **filesystem path, not a classpath resource** — see [what the path means](#what-withcatalog-resolves-against). With no catalog, the container serves whatever its image was built with. |
| `withImage(String \| DockerImageName)` | `ghcr.io/bilal-fazlani/mock-server:latest` | The image to run. Parsed as a **whole reference** — `withImage("0.10.0")` looks for a repository named `0.10.0`. For a tag, use `MockServerContainer.DEFAULT_IMAGE_NAME.withTag("0.10.0")`. |
| `withStartupTimeout(Duration)` | 2 minutes | How long to wait for `GET /ui/api/health` to answer `200`. |
| `configure(Consumer<MockServerContainer>)` | no-op | Anything else the container — or `GenericContainer` beneath it — can do: environment variables, networks, log consumers, reuse. Applied before the container starts, and additive across calls. |
| `schemaCheck(SchemaCheck.Mode)` | `FAILED` | The suite-wide [end-of-test schema check](#the-end-of-test-schema-check). |

`configure` is how you set the server's own [configuration
variables](../reference/configuration.md):

```java
MockServer.container()
        .withCatalog("src/test/resources/catalog")
        .configure(container -> container.withEnv("UNMOCKED_USERS", "DEFAULT_MOCK"))
        .build();
```

!!! note "Pin the image tag in CI"

    The default tag is `latest`, so a suite that passed yesterday can fail today
    against a server that changed underneath it, for reasons unconnected to the
    change under test. Pin the version the suite is verified against:

    ```java
    MockServer.container()
            .withImage(MockServerContainer.DEFAULT_IMAGE_NAME.withTag("0.10.0"))
            .withCatalog("src/test/resources/catalog")
            .build();
    ```

    Pick the tag from the
    [releases](https://github.com/bilal-fazlani/mock-server/releases) — every
    release is published as an image tag, and nothing else is.

    The SDK needs server **0.7.0 or newer** — see
    [Compatibility](index.md#compatibility).

### What `withCatalog` resolves against

`"src/test/resources/catalog"` is a **filesystem path, not a classpath
resource**, despite reading like one. The directory is bind-mounted into the
container read-only, and a bind mount needs a real directory on the host — so
packaging the catalog into a test-jar, or referencing it from a dependency,
cannot work. Two things follow:

- **A relative path resolves against the test run's working directory.** Gradle
  and Maven both default that to the module directory, including in a
  multi-module build invoked from the root, which is why the string above works
  unchanged. A build that overrides it — Gradle's `test { workingDir = … }`,
  Surefire's `workingDirectory` — moves what the path means.
- **A path that is not an existing directory fails at the `withCatalog` call**,
  with an `IllegalArgumentException` naming it. It is not a wrong-directory
  mystery discovered when the container starts.

Pass a `Path` for the same thing more explicitly, and the
[file permissions caveat](testcontainers-client.md#the-container) applies to
either overload.

!!! warning "One `MockServer` per test class"

    Two instances on the same class make `MockProfile` injection ambiguous —
    Jupiter refuses it — and both would contend for the single global-mock lock,
    which is one key for the whole JVM rather than one per server. If a class
    genuinely needs two servers, drive the second through
    [`MockServerClient`](testcontainers-client.md#the-runtime-control-client)
    directly.

### Attach mode: an already-running server

`MockServer.connect(url)` attaches to a server someone else started — a
developer's own instance with its dashboard open, or a shared one in a pipeline.
No Docker involved.

```java
@RegisterExtension
static final MockServer mock = MockServer.connect("http://localhost:3000");
```

`MockServer.attachedTo(url)` is the builder form, for changing the schema-check
default:

```java
@RegisterExtension
static final MockServer mock =
        MockServer.attachedTo("http://localhost:3000").schemaCheck(SchemaCheck.Mode.STRICT).build();
```

The extension owns none of that server's lifecycle: it never starts, stops, or
restarts it. Whatever else is using it sees the profiles these tests create and
delete — which is the point when attaching to your own server, and the reason not
to attach to a shared one that matters.

## Choosing what an endpoint answers

`MockProfile` arrives as a test-method parameter. It is also resolvable on
`@BeforeEach` and `@AfterEach` methods; there is no such thing outside a test.

```java
@Test
void surfacesADeclinedCard(MockProfile profile) {
    profile.endpoint("payments", "charge").serves("card_declined");
    // …
}
```

| Call | What it does |
| --- | --- |
| `endpoint(system, endpoint)` | Selects an endpoint, qualified by its system slug. |
| `endpoint(endpoint)` | Same, by name alone — endpoint names are unique across a catalog. |
| `.serves(scenario)` | Serves one scenario for every call. Returns the profile, so endpoints chain. |
| `.servesSequence(first, rest…)` | Serves an ordered [sequence](../building/scenarios.md#scenario-sequences), one step per call, sticking on the last step once exhausted. |
| `reset()` / `reset(endpoint)` | Rewinds sequence progress and [resolver history](../building/dynamic.md#history) so the next call starts from the first step. Leaves selections in place. |
| `id()` | The minted profile ID — see [What a profile ID contains](#what-a-profile-id-contains) for what it is safe to put it into. |

Both the endpoint and the scenario are checked against the server's catalog
**before** the write, so a typo fails on the line that wrote it with a message
naming what does exist. Selections chain:

```java
profile.endpoint("payments", "charge").serves("card_declined")
       .endpoint("payments", "refund").servesSequence("pending", "settled");
```

Pass `"real"` to proxy that endpoint through to the [live
upstream](../building/scenarios.md#scenarios-the-real-passthrough) for this test
only.

Each `serves…` call writes to the server immediately — the selection is in force
the moment the line has run, with no separate commit step. That costs two round
trips per selection against a local container. A test making enough of them for
that to matter should stage them itself through
[`profile.client()`](testcontainers-client.md#the-runtime-control-client).

### What a profile ID contains

`profile.id()` is what a test sends as the caller identity, so it ends up in a
URL path segment, a query value, a header, and a JSON string. **It never needs
escaping in any of them.**

The ID is the test's name, sanitised, plus a `-` and four hex digits —
`surfacesADeclinedCard-a3f9`. Sanitising keeps ASCII letters, digits and `_` as
themselves and collapses every run of anything else to a single `-`, so the
character set is exactly `[A-Za-z0-9_-]`, with no leading or trailing `-`. The
name is capped at 48 characters, which bounds the whole ID at 53.

That holds however the test's name is written. A method name usually passes
through unchanged; a `@DisplayName("charges a card, twice")` or a
`@ParameterizedTest` label goes through the same sanitising, so its spaces and
punctuation become hyphens rather than reaching the wire —
`charges-a-card-twice-a3f9`. A name made entirely of dropped characters becomes
`test`, and the suffix still makes it unique.

!!! note "No `delayedBy(…)`"

    There is deliberately no way to set a response delay per profile: the
    runtime-control API has none, so a method for it would be a promise this
    module cannot keep. Declare the delay on the scenario fixture
    ([`delay`](../building/fixtures.md#response-delay)) and select that scenario
    like any other.

## Verifying what was called

`profile.verify(…)` asserts on the requests the server actually received.
Only calls that resolved to *this* profile count, so a verification is unaffected
by whatever else is running against the same server.

```java
import static com.bilalfazlani.mockserver.junit.MockServerVerification.*;

profile.verify(endpoint("charge").called(once()).withBodyPath("$.amount", new BigDecimal("42.50")));
profile.verify(endpoint("quote").called(never()));
```

| Piece | Meaning |
| --- | --- |
| `endpoint(name)` | The endpoint the verification is about, by catalog name. |
| `called(once())` · `times(n)` | Exactly that many matching calls. |
| `called(atLeast(n))` · `atMost(n)` · `never()` | A bound. With no `called(…)` at all, the expectation is `atLeast(1)`. |
| `.withBodyPath(path, expected)` | The request body carries a value at a [body path](../building/profiles.md#profile-id-extraction-selectors). |
| `.withQueryParam(name, value)` | The request carried that query parameter. A repeated key matches when any of its values does; values compare after percent-decoding. |
| `.withHeader(name, value)` | The request carried that header. The name matches case-insensitively; the value does not. |

Every `with…` narrows what counts as a *matching* call, and the count is then
checked against the matches. That makes the two halves compose in a way worth
reading twice:
`endpoint("charge").called(never()).withBodyPath("$.amount", 100)` asserts that
charge was never called **with that amount** — not that charge was never called.

`withBodyPath` uses the mock server's own body-path grammar, **not JSONPath**:
`$` followed by `.key` and `[index]` segments. `$.items[0].sku` is a body path;
wildcards, filters, and recursive descent are rejected rather than quietly
matching nothing. Values compare by JSON kind — a body carrying `"100"` does not
satisfy an expected `100` — and numbers compare **by value**, so `100` matches a
body carrying `100.0`.

### Settling, and what it cannot cover

The server writes its request log **after** it has answered, and deliberately does
not wait for that write. So a call is answered slightly before it is recorded, and
a `verify` on the very next line is racing that write.

`verify` handles this by re-reading for a couple of seconds rather than believing
the first empty answer. A passing assertion pays nothing for it; a failing one is
delayed by at most that window in exchange for never being wrong about it.

!!! warning "`never()` and `atMost()` cannot settle"

    Settling only helps an expectation that *more* calls would satisfy. `never()`
    and `atMost(n)` are already satisfied by whatever has been recorded so far, so
    they return at once — and a negative assertion made immediately after the call
    it denies can be answered before that call has landed.

    Putting the positive assertions first **narrows** that window without closing
    it: each call is an independent write, and settling one row says nothing about
    another's. Where a negative assertion is load-bearing, give the call a
    positive verification to settle against first.

### Waiting for calls made off the request thread

When the code under test calls the upstream from another thread — a retry loop, a
poller, a queue consumer — `verify` would race it. Use `await` with a budget:

```java
// A sequence serves one step per call: two polls that answer "pending", then one that settles.
profile.endpoint("payments", "refund_status").servesSequence("default", "default", "settled");

CompletableFuture<RefundStatus> settlement =
        new PaymentsClient(mock.baseUrl()).awaitSettlement(profile.id(), "rfnd_1");

// The polling runs off this thread, so there is nothing to assert on yet — wait for the
// mock server to have seen all three calls, then check what the client concluded.
profile.await(endpoint("refund_status").called(times(3)), Duration.ofSeconds(10));
assertEquals(RefundStatus.SETTLED, settlement.get(10, TimeUnit.SECONDS));
```

`await` returns as soon as the expectation holds. Awaiting an expectation that
*fewer* calls satisfy — `never()`, `atMost(n)` — proves nothing: it is satisfied
immediately. Await on a lower bound.

!!! warning "The 200-row verification window"

    One verification reads at most **200 log rows** for that profile and endpoint
    — the server's own [per-page ceiling](../driving/api.md#request-logs). A full
    page means there is at least one call the verification cannot see, so its
    count would be a lower bound rather than an answer. The SDK **fails the test
    outright** in that case rather than verifying against a page that silently
    stopped short. A single test making more than 200 calls to one endpoint wants
    splitting up.

A failed verification lists every call the server recorded for that profile — the
log ID, the scenario served and why, how the profile resolved, and a link straight
into the dashboard entry.

## The end-of-test schema check

An endpoint backed by a [`_schema.json` or a system
`_spec`](../building/schemas.md) has the server check both sides of every exchange
and record the outcome in the [request
log](../driving/request-logs.md#schema-validation-outcomes). Nothing reads that
record by default — a `400` the code under test caught and turned into its own
error is a passing test *and* a silent contract violation.

After each test, this extension reads the profile's log once and fails the test if
any exchange is in a state the mode cares about. It runs before the profile is
deleted, because deleting a profile deletes its log.

| Mode | Fails on |
| --- | --- |
| `FAILED` | **The default.** A hard violation only: a mocked request or response the schema rejected, which the server answered with a `400` or a `500`. A `drift_warning` — the softer outcome a `real` passthrough records, where nothing was blocked — is left alone, because there the upstream is what drifted and failing every test that touches it is noise. |
| `STRICT` | Hard violations **and** drift warnings, so a `real` passthrough that no longer matches the documented schema is a failing test rather than a line in a log nobody reads. |
| `OFF` | Nothing. For the test that sends something invalid on purpose to prove the code under test handles the rejection. |

Set the suite-wide default on the builder; override it per class or per method
with `@SchemaCheck`, nearest annotation wins:

```java
@Test
@SchemaCheck(SchemaCheck.Mode.OFF)   // this test sends a negative amount on purpose
void reportsAChargeTheGatewayRejectsOutright(MockProfile profile) {
    profile.endpoint("payments", "charge").serves("default");

    ChargeResult result = new PaymentsClient(mock.baseUrl()).charge(profile.id(), new BigDecimal("-5"));

    assertEquals(ChargeResult.Outcome.ERROR, result.outcome());
}
```

Two limits are worth knowing:

- **It reads the log once.** The server does not wait for its log write, so a
  violation caused in a test's very last moments can land after this has looked.
  That is a *miss*, not a flake — the check under-reports, it does not fail at
  random — and a whole JUnit callback cycle passes before it reads, so most of a
  test's calls are long since recorded. Waiting cannot help: "is anything wrong
  here?" never becomes true by waiting, and a fixed delay on every test is a price
  every suite would pay forever. **The escape hatch:** a test that wants certainty
  about its final call ends with a positive `verify` on it, which settles that row
  first.
- **It reads at most 200 rows**, and a full page fails the test rather than
  claiming nothing was wrong, for the same reason a verification does.

The failure message names each offending exchange, which side failed, the schema
issues behind it, and a dashboard link — and ends by pointing at
`@SchemaCheck(SchemaCheck.Mode.OFF)` for the case where the invalid payload is the
point.

## Global mocks

A [global mock](../driving/ui.md#global-mocks-uiglobal-mocks) is the opposite of a
profile: one switch, seen by every caller, for an endpoint that cannot resolve a
profile ID from the request at all. Two tests moving it at once clobber each
other.

`@UsesGlobalMocks` is what makes it safe, and it is **required** — calling
`mock.globalMock(…)` from a test without it fails immediately rather than as a
flake somewhere else later.

```java
@Test
@UsesGlobalMocks
void seesAGatewayOutage() {
    mock.globalMock("payments", "gateway_status").serves("outage");

    assertFalse(new PaymentsClient(mock.baseUrl()).gatewayUp());
}
```

The annotation does two things: it carries Jupiter's `@ResourceLock` on a fixed
key, so the platform serialises every test that declares it even under parallel
execution; and it makes the extension snapshot every global override before the
test and put them all back afterwards — restoring the ones the test changed and
clearing the ones it added.

Three conditions on that guarantee:

- **The snapshot is taken before the class's `@BeforeEach` methods run.** An
  override one of those sets is therefore not in it, and is cleared afterwards as
  though the test had added it. Harmless — the next `@BeforeEach` sets it again —
  but it makes `@BeforeEach` the wrong place to establish a suite-wide default.
  Use `@BeforeAll`, whose writes every test's snapshot captures.
- **That `@BeforeAll` arrangement assumes test classes do not run concurrently
  with each other.** No per-test annotation can serialise a `@BeforeAll`; it runs
  outside every test's scope. Jupiter's default keeps classes on one thread, which
  is what makes it safe.
- **The call must come from the test's own thread.** The extension tracks which
  test is calling by the thread Jupiter runs each callback on, so a call from a
  thread with no callback in scope — a test body under
  `@Timeout(threadMode = SEPARATE_THREAD)`, above all — is refused outright rather
  than waved through with no snapshot taken. If stepping outside the guard is what
  you mean, say so with `mock.client().globalMock(…)`, which is unguarded and
  restores nothing.

## Bearer-token endpoints

For an endpoint whose `profileIdSelector` is
[`bearer:<claim>`](../building/profiles.md#profile-id-extraction-selectors),
`profile.bearerToken()` mints an unsigned JWT carrying the profile ID as `sub`;
`bearerToken("customer_id")` uses a named claim. Send it as
`Authorization: Bearer <token>`.

!!! warning "Not a credential"

    The server decodes the payload to pick a profile and does nothing else with
    it — no signature, algorithm, issuer, audience, or expiry is verified. These
    tokens need no key and no signing library **because they are not
    credentials**. Never put a real one in their place.

Note that the server stores an `authorization` header's value as `[REDACTED]`, so
`withHeader("authorization", …)` can only ever match that literal. Assert that
`profile.id()` resolved instead — that is what the token was for.

## Running tests in parallel

Safe by construction: every test's state hangs off a profile ID minted from its
own name, so `serves` cannot disturb another test and `verify` cannot see one.
The exceptions are global mocks, which `@UsesGlobalMocks` serialises, and the
`@BeforeAll` caveat above.

## Things that bite

**JSON numbers have no scale.** A fixture body written `12.50` is JSON, and JSON
does not carry trailing zeros — it arrives as `12.5`. `BigDecimal.equals` compares
scale as well as value, so `assertEquals(new BigDecimal("12.50"), receipt.cost())`
fails against a value parsed from that fixture. Compare by value instead:

```java
assertEquals(0, new BigDecimal("12.50").compareTo(receipt.cost()));
```

The DSL's own comparison does not have this problem — `withBodyPath` compares
numbers by value, so `withBodyPath("$.amount", new BigDecimal("42.50"))` matches a
request body carrying `42.5`.

**A catalog change needs a restart.** The server reads its catalog once, at its
own startup. Editing a mounted fixture while the container is running does
nothing until the container restarts — which, for a container started per run, is
the next test run.

**`close()` is not for mid-suite use.** It is called automatically when the run
ends. Calling it yourself between tests would leave the cached client pointing at
a mapped port nothing is listening on.

## Dropping to the client

`profile.client()` and `mock.client()` return the
[`MockServerClient`](testcontainers-client.md#the-runtime-control-client) the DSL
drives — for staged writes, log queries, profile-key mappings, and anything else
the DSL does not cover. It is shared with the extension and every other profile on
the same server, so it is safe to hold but must not be closed or reconfigured.
