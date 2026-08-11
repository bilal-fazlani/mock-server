---
description: "The four Java Maven artifacts that package the runtime-control API for JVM integration tests, and the versions they pin."
---

# Testing SDKs

The mock server is driven over its [runtime-control API](../driving/api.md),
which is plain JSON HTTP and works from any language. The **Java SDK** packages
that API for JVM integration tests: four Maven artifacts that start the server,
point the application under test at it, choose what each upstream answers for the
test that is running, and assert on the requests that actually went over the wire.

```java
@Test
void surfacesADeclinedCard(MockProfile profile) {
    profile.endpoint("payments", "charge").serves("card_declined");

    ChargeResult result = new PaymentsClient(mock.baseUrl()).charge(profile.id(), new BigDecimal("42.50"));

    assertEquals(ChargeResult.Outcome.DECLINED, result.outcome());
    profile.verify(endpoint("charge").called(once()).withBodyPath("$.amount", new BigDecimal("42.50")));
}
```

Nothing is stubbed and no bean is replaced. A real HTTP request leaves the
process, a real server answers it, and the assertion is about what that server
received.

## Selection, not stubbing

A test does not describe a response. It **selects a scenario** the catalog
already declares — `card_declined` above — and the server serves the fixture
behind it.

That distinction is the point of the whole SDK:

- **The fixtures are shared.** The same `catalog/` directory that answers a
  developer clicking around in [the dashboard](../driving/ui.md) is the one the
  test suite runs against. A response body is written once, not once per test and
  again in the dev environment.
- **The fixtures are validated.** A catalog is [checked at
  startup](../building/validate.md) and its scenarios are checked against the
  endpoint's [schema](../building/schemas.md). An inline stub is checked by
  nothing.
- **A typo fails on its own line.** `serves("card_decline")` is refused before
  any request is made, with a message naming the scenarios that do exist —
  because the SDK reads the server's catalog and validates against it.

The cost is real and worth stating: the scenario has to exist in the catalog
before a test can select it. Writing a test can mean writing a fixture first.
What you get back is that the fixture is then reviewable, reusable, and
runnable outside the test suite.

## One profile per test

Every test is handed a [profile](../building/profiles.md) of its own, under an ID
minted from the test's name (`surfacesADeclinedCard-a3f9`). The scenario
selections, the sequence progress, the resolver history, and the request log all
hang off that ID.

This is what makes the DSL's three moves work:

| Move | Why the profile matters |
| --- | --- |
| `profile.endpoint(…).serves(…)` | Pins a scenario for this caller only, so another test pinning the same endpoint is unaffected. |
| `profile.id()` handed to the code under test | Whatever the endpoint's [`profileIdSelector`](../building/profiles.md#profile-id-extraction-selectors) reads resolves to this test's profile. |
| `profile.verify(…)` | Sees only the calls that resolved to this profile, so a shared server is not a shared log. |

When the test ends the profile is deleted, and that delete
[cascades](../driving/api.md) — mappings, sequence progress, resolver history,
and log entries go with it. Nothing a test did is visible to the next one, and
tests are safe to run in parallel.

The exception is a [global mock](../driving/ui.md#global-mocks-uiglobal-mocks),
which is one switch every caller shares. Driving it from a test requires
[`@UsesGlobalMocks`](junit.md#global-mocks), which serialises those tests against
each other and restores the switch afterwards.

## Every integration test is a contract test

After each test, the SDK reads that profile's request log and fails the test if
any exchange broke the endpoint's schema — [request or
response](../driving/request-logs.md#schema-validation-outcomes). It is on by
default.

That closes a gap nothing else covers: a `400` the code under test caught and
turned into its own error message is a passing test *and* a silent contract
violation. See [the schema check](junit.md#the-end-of-test-schema-check) for the
modes, the escape hatch, and its one honest limitation.

## The four modules

All four are published to Maven Central as
`com.bilal-fazlani:<artifact>:2.0.0`, sharing one version. Each depends on the one
above it, so a test suite declares exactly one — the highest it needs.

| Artifact | What it adds | Depends on |
| --- | --- | --- |
| `mock-server-client` | A fluent Java client for the runtime-control API: profiles, global mocks, catalog, request logs. No test framework. | — |
| `mock-server-testcontainers` | `MockServerContainer`, a `GenericContainer` that mounts a catalog and does not report started until the server is healthy. | `mock-server-client` |
| `mock-server-junit` | The JUnit 5 DSL: a `MockServer` extension, `MockProfile` injection, `serves` / `verify` / `await`, the schema check. | `mock-server-testcontainers` |
| `mock-server-spring-boot-test` | `@ServiceConnection` support and catalog-driven URL wiring, so the application's own beans are built already pointing at the mock. | `mock-server-junit` |

## Compatibility

| Requirement | Version |
| --- | --- |
| Mock server | **0.7.0 or newer** — the SDK targets the runtime-control contract as of that release, and uses newer contract features only where the server's [additive evolution rules](../driving/api.md#stability-machine-readable-spec) make an older server degrade rather than break. |
| Java | **21 (LTS) or newer**, from SDK **2.0.0** — the earlier 1.x line runs on **Java 17**. |
| JUnit | Jupiter 6.x (the SDK brings `junit-jupiter-api` with it) |
| Spring Boot | **4.1.0**, for `mock-server-spring-boot-test` only — the exact release the module is compiled and tested against, not a range across 4.x |
| Docker | Required for container mode; not required when [attaching](junit.md#attach-mode-an-already-running-server) to a server that is already running |

### The versions the SDK pins

Every third-party version is pinned in the build and declared in the published
POMs. Read this as what 2.0.0 is compiled and tested against — not as a supported
range:

| Dependency | Pinned in 2.0.0 | Arrives through |
| --- | --- | --- |
| `org.springframework.boot:spring-boot`, `-test`, `-autoconfigure`, `-testcontainers` | **4.1.0** | `mock-server-spring-boot-test` |
| `org.springframework:spring-context`, `spring-test` | **7.0.8** — the Framework release `spring-boot-dependencies:4.1.0` manages | `mock-server-spring-boot-test` |
| `org.junit:junit-bom` | **6.1.2** | `mock-server-junit` |
| `org.testcontainers:testcontainers` | **2.0.5** | `mock-server-testcontainers` |
| `com.fasterxml.jackson.core:jackson-databind` | **2.22.1**, with a declared floor of **2.16.0** | `mock-server-client` |

Each of these is an `api` dependency, so it lands on your own test compile
classpath too, and its version is one you can see and override. Two consequences
worth knowing:

- **Your application's Spring Boot version wins.** Under
  `spring-boot-starter-parent` or the Spring dependency-management plugin, your
  build's own pin overrides the one this module brings, so what the SDK actually
  runs against is *your* Boot version. On anything other than 4.1.0 it is
  untested rather than known-broken — 4.0 and 4.1 differ in the module layout of
  the auto-configurations, which is exactly the surface
  `mock-server-spring-boot-test` attaches to.
- **The Jackson floor is real.** `CatalogEndpoint.scenarios()` deserializes into a
  `SequencedMap`, which jackson-databind cannot do before 2.16.0. A build that
  forces an older 2.x fails at the first catalog fetch.

Pin the server image too — see [the note on the JUnit
guide](junit.md#registering-the-extension).

!!! warning "Local-dev only"

    Every module here goes through the runtime-control API, which is
    unauthenticated and offers no isolation between clients. The bearer tokens
    `MockProfile.bearerToken()` mints are unsigned by construction and are not
    credentials. Point these tests at a throwaway container or a developer's own
    server, never at anything shared and long-lived.

!!! note "Safe with virtual threads, from 2.0.0"

    From SDK 2.0.0, no `MockServerClient` call holds a monitor across its HTTP
    I/O, so a virtual thread calling it does not pin its carrier thread on JDK
    21–23 — safe under Spring Boot's `spring.threads.virtual.enabled=true` or
    JUnit's parallel test execution. `MockServerClient` also implements
    `AutoCloseable` as of 2.0.0.

## Where to go next

- **[Java quick start](java-quickstart.md)** — a working test from an empty project.
- **[JUnit 5 guide](junit.md)** — the DSL in full, including the edges that bite.
- **[Spring Boot guide](spring-boot.md)** — `@ServiceConnection` and the URL wiring.
- **[Testcontainers & the client](testcontainers-client.md)** — the framework-agnostic layer, for TestNG, Spock, or no test framework at all.
