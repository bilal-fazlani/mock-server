# Java quick start

A working integration test, from nothing, in four steps. The result is a real
HTTP call to a real mock server started by the test run — no stub, no
`@MockBean`, no recorded fixture in the test source.

You need **JUnit Jupiter**, **Java 21 (LTS) or newer**, and a **Docker daemon**
the test run can reach. (Without Docker, [attach to a server you started
yourself](junit.md#attach-mode-an-already-running-server) instead — everything
below is otherwise unchanged.)

## 1. Add the dependency

One artifact. `mock-server-junit` brings the Testcontainers module, the
runtime-control client, and `junit-jupiter-api` with it.

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

## 2. Give the server a catalog

The test does not describe responses — it selects scenarios the catalog declares.
So the catalog comes first. Put it anywhere on disk — `withCatalog` takes a
**filesystem path, not a classpath resource**, and bind-mounts the directory into
the container. `src/test/resources/catalog` is the convention, and a relative
path like that one resolves against the test run's working directory, which
Gradle and Maven both default to the module directory. See [what it resolves
against](junit.md#what-withcatalog-resolves-against) for the cases where that
matters.

```text
src/test/resources/catalog/
  payments/                     # system directory; its name IS the system slug
    _system.json                # { "name", "baseUrlEnv" }
    charge/                     # endpoint directory; its name IS the endpoint name
      _endpoint.json            # method, path, and how the caller's ID is read
      default.json              # the happy path
      card_declined.json        # the outcome a real gateway sandbox hides behind a magic card number
```

`payments/_system.json`

```json
{
  "name": "Payments",
  "baseUrlEnv": "PAYMENTS_URL"
}
```

`payments/charge/_endpoint.json`

```json
{
  "displayName": "Charge",
  "method": "POST",
  "path": "/payments/charge",
  "profileIdSelector": "$.customerId"
}
```

`profileIdSelector` is the load-bearing line. It says the caller's identity is the
`customerId` field of the request body — which is how the server tells one test's
calls from another's. Any of the [five selector
forms](../building/profiles.md#profile-id-extraction-selectors) works; a body
field is the common one.

`payments/charge/default.json`

```json
{
  "description": "Captured",
  "summary": "The happy path: the gateway captures the charge and returns a reference.",
  "status": 200,
  "body": {
    "reference": "chg_{{$.customerId}}",
    "outcome": "CAPTURED"
  }
}
```

`payments/charge/card_declined.json`

```json
{
  "description": "Card declined",
  "summary": "The issuer declined the card.",
  "status": 402,
  "body": {
    "outcome": "DECLINED",
    "reason": "card_declined"
  }
}
```

`{{$.customerId}}` is a [placeholder](../building/templating.md): the fixture
echoes back whatever the caller sent, so the reference in the response belongs to
the caller who asked for it. See [Building mocks](../building/endpoints.md) for
every field these files accept.

## 3. Write the test

```java
import static com.bilalfazlani.mockserver.junit.MockServerVerification.endpoint;
import static com.bilalfazlani.mockserver.junit.MockServerVerification.once;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.bilalfazlani.mockserver.junit.MockProfile;
import com.bilalfazlani.mockserver.junit.MockServer;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

class PaymentsClientTest {

    @RegisterExtension
    static final MockServer mock =
            MockServer.container().withCatalog("src/test/resources/catalog").build();

    @Test
    void capturesACharge(MockProfile profile) {
        profile.endpoint("payments", "charge").serves("default");

        ChargeResult result = new PaymentsClient(mock.baseUrl()).charge(profile.id(), new BigDecimal("42.50"));

        assertEquals(ChargeResult.Outcome.CAPTURED, result.outcome());
        assertEquals("chg_" + profile.id(), result.reference());
        profile.verify(endpoint("charge").called(once()).withBodyPath("$.amount", new BigDecimal("42.50")));
    }

    @Test
    void surfacesADeclinedCard(MockProfile profile) {
        profile.endpoint("payments", "charge").serves("card_declined");

        ChargeResult result = new PaymentsClient(mock.baseUrl()).charge(profile.id(), new BigDecimal("42.50"));

        assertEquals(ChargeResult.Outcome.DECLINED, result.outcome());
        assertEquals("card_declined", result.reason());
    }
}
```

`PaymentsClient` here is your own code — an ordinary HTTP client that takes a base
URL. Nothing in it knows it is being pointed at a mock.

## 4. Run it

`./gradlew test`, or `mvn test`. The first run pulls
`ghcr.io/bilal-fazlani/mock-server:latest` and takes as long as the pull;
afterwards the container starts in a second or two, once for the whole class.

Before this suite runs in CI, [pin that
tag](junit.md#registering-the-extension) — `latest` moves, and a suite that
passed yesterday can fail today for reasons unconnected to the change under test.

## What each line does

| Line | What happens |
| --- | --- |
| `MockServer.container()…build()` | Declares the server. Nothing starts yet. The container comes up on the first test that needs it and is stopped when the whole test run ends. |
| `MockProfile profile` parameter | Mints a profile ID from the test's own name — `capturesACharge-a3f9` — for this test alone. |
| `profile.endpoint("payments", "charge").serves("default")` | Pins that scenario for that profile, checked against the server's catalog before the write. In force by the time the line returns. |
| `mock.baseUrl()` | `http://host:port` for the running container — what to point the code under test at. |
| `profile.id()` as the customer | Makes the call resolve to this test's profile, because `profileIdSelector` reads `$.customerId`. |
| `profile.verify(…)` | Asserts on the request the server actually received, considering only calls that resolved to this profile. |
| *(end of test)* | The profile is deleted, taking its selections, sequence progress, and log entries with it. |

## Next

- Add a `_schema.json` to the endpoint and every test in the suite becomes a
  contract test — the SDK fails a test whose request or response broke the
  schema, without a single extra assertion. See [Schemas](../building/schemas.md)
  and [the schema check](junit.md#the-end-of-test-schema-check).
- **Spring Boot?** Skip the `mock.baseUrl()` plumbing entirely — a
  `@ServiceConnection` field publishes `PAYMENTS_URL` into the test's
  `Environment`, so the application's own beans are built already pointing at the
  mock. See the [Spring Boot guide](spring-boot.md).
- The [JUnit 5 guide](junit.md) covers sequences, waiting for calls made off the
  request thread, global mocks, and the edges worth knowing before you hit them.
