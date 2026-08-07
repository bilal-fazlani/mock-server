# Spring Boot guide

`mock-server-spring-boot-test` removes the URL plumbing. Declare the server, and
the application under test is already pointed at it — no
`@DynamicPropertySource` method, no URL passed to a constructor, nothing to keep
in step.

```java
@SpringBootTest
@MockServerTest
class CheckoutServiceIT {

    @ServiceConnection
    static final MockServerContainer MOCK_SERVER =
            new MockServerContainer().withCatalog("src/test/resources/catalog");

    @Autowired CheckoutService checkout;   // reads ${PAYMENTS_URL} — already the mock's address

    @Test
    void confirmsAnOrderAndArrangesShipping(MockProfile profile) {
        profile.endpoint("payments", "charge").serves("default");
        profile.endpoint("shipping", "quote").serves("express");

        Receipt receipt = checkout.checkout(profile.id(), new BigDecimal("42.50"));

        assertEquals(Receipt.Status.CONFIRMED, receipt.status());
        assertEquals("EXPRESSLINE", receipt.carrier());
        profile.verify(endpoint("charge").called(once()).withBodyPath("$.amount", new BigDecimal("42.50")));
    }

    @Test
    void neverShipsAnOrderTheCardWasDeclinedFor(MockProfile profile) {
        profile.endpoint("payments", "charge").serves("card_declined");

        Receipt receipt = checkout.checkout(profile.id(), new BigDecimal("42.50"));

        assertEquals(Receipt.Status.DECLINED, receipt.status());
        // The rule the receipt alone cannot show: shipping was never asked. A stubbed client
        // would prove a method was not called; this proves no request left the process.
        profile.verify(endpoint("quote").called(never()));
    }
}
```

Imports are the ones from the [quick
start](java-quickstart.md#3-write-the-test), plus
`com.bilalfazlani.mockserver.springboottest.MockServerTest`,
`com.bilalfazlani.mockserver.testcontainers.MockServerContainer`, and Spring's
`@SpringBootTest` / `@ServiceConnection` / `@Autowired`.

The container is a plain `static` field. Nothing in the test starts or stops it:
the connection-details bean starts it the first time the application context asks
for its address, and Testcontainers' resource reaper removes it when the run ends.

Everything the [JUnit 5 guide](junit.md) documents — `serves`, `servesSequence`,
`verify`, `await`, `@SchemaCheck`, `@UsesGlobalMocks` — works unchanged inside
`@SpringBootTest`. This page covers only what Spring adds.

## The two halves

| Half | How it arrives | What it gives you |
| --- | --- | --- |
| **Wiring** | Auto-configuration, from the `@ServiceConnection` field alone. No annotation. | Every catalog system's base URL published into the test's `Environment`, pointing at the mock. |
| **The DSL** | `@MockServerTest` | `MockProfile` and `MockServer` as resolvable test parameters, the end-of-test schema check, and the per-test profile cleanup. |

They are independent. Leave `@MockServerTest` off a test that only needs its
upstreams pointed at the mock and drives nothing per test; the URLs are published
either way.

`@MockServerTest` needs a `MockServerConnectionDetails` bean to attach to. A
`@ServiceConnection` container field supplies one; so does the
[`mock-server.url` property](#attaching-to-a-running-server), or a bean of your
own. A context with none fails the test and names all three.

## What gets published, and under which names

Each catalog system declares the environment variable its base URL is deployed as
— `baseUrlEnv` in `_system.json`. That name is published verbatim, plus its
dotted lower-case form:

| Published name | For `"baseUrlEnv": "PAYMENTS_URL"` | Binds |
| --- | --- | --- |
| The `baseUrlEnv` verbatim | `PAYMENTS_URL` | `@Value("${PAYMENTS_URL}")`, and anything reading the variable's own name |
| Its dotted lower-case form | `payments.url` | `@ConfigurationProperties(prefix = "payments")` with a `url` field |
| Anything [remapped](#when-your-key-is-neither) | *(none by default)* | Whatever key the application actually reads |

The second name exists because Spring Boot's relaxed binding does **not** bridge
the two on its own. Relaxed binding maps `UPPER_SNAKE_CASE` onto a dotted name
only for real environment variables; properties published here land in an
ordinary map property source, where the default mapper lower-cases and drops the
underscore instead — `PAYMENTS_URL` becomes the single element `paymentsurl`,
which never matches the two-element `payments.url` a
`@ConfigurationProperties` class asks for. Publishing the dotted form is what
makes the same application class bind in a test and from a real environment
variable in production.

### When your key is neither

The dotted form is a **one-to-one** inverse of a mapping that is one-to-many. In
a production environment, `SHIPPING_API_URL` satisfies both `shipping.api.url`
and `shipping.api-url`; only the first can be derived and published. An
application binding the hyphenated spelling lands on the other side of that split.

Name the property explicitly:

```properties
# src/test/resources/application.properties
mock-server.wiring.systems.shipping=shipping.api-url
```

Keyed by the system's **slug** — its directory name under `catalog/` — with a
comma-separated list of names for more than one. These are published **in
addition to** the names derived from `baseUrlEnv`, never instead of them, so
adding a remapping cannot silently take the standard names away. A slug no system
in the catalog declares fails the context load and names the slugs that do exist,
rather than quietly publishing nothing.

To publish nothing at all and point the code at
`MOCK_SERVER.baseUrl()` by hand, set `mock-server.wiring.enabled=false`. The
connection-details bean and the test DSL stay in place.

## Attaching to a running server

Set `mock-server.url` and everything above works against a server that is already
running — a developer's own, with its dashboard open — with no container and no
other change to the test.

```java
@SpringBootTest(properties = "mock-server.url=http://localhost:3000")
@MockServerTest
class CheckoutServiceIT { … }
```

It is ignored when a container has already supplied a connection-details bean, so
leaving it set in a shared properties file cannot quietly redirect a
containerised test.

!!! warning "Spell it `mock-server.url` exactly"

    Every other property here binds under Spring Boot's relaxed rules, so
    `mock-server.wiring.enabled` and `mockserver.wiring.enabled` are the same
    property. `mock-server.url` is the exception: its **presence** is what decides
    whether the attach-mode bean is registered at all, and that decision is a
    `@ConditionalOnProperty` match, which is exact. `mockserver.url` binds the
    value and registers nothing.

## Sharing the container across test classes

Spring's context cache key holds the container **instance**, so a container per
test class means an application context per test class. With more than one test
class, put the field on an abstract base class they all extend:

```java
@SpringBootTest
@MockServerTest
abstract class AbstractMockServerIT {

    @ServiceConnection
    static final MockServerContainer MOCK_SERVER =
            new MockServerContainer().withCatalog("src/test/resources/catalog");
}
```

The test DSL is shared the same way: one `MockServer` per base URL for the whole
run, so every class pointed at one server shares one profile-ID sequence and one
catalog fetch.

!!! warning "Do not annotate the field `@Container`"

    Under Testcontainers' own `@Testcontainers` extension, a `@Container` field is
    stopped when its declaring class finishes — stranding the cached application
    context pointing at a port nothing is listening on. A plain `static` field,
    started on demand by the connection-details bean and reaped at the end of the
    run, is the arrangement this module is built for.

## The schema check here

Identical to [the JUnit one](junit.md#the-end-of-test-schema-check), including
`@SchemaCheck` overrides on a class or a method. The suite-wide default is
`FAILED` and is deliberately **not** configurable in Spring mode: the DSL delegate
is shared across test classes, so the first class to run would otherwise decide it
for every class after it. Override it where it belongs — on the class or the test.

## Things that bite

Everything in the JUnit guide's [Things that bite](junit.md#things-that-bite)
applies, the JSON number-scale one especially: a shipping cost written `12.95` in
a fixture is fine, but one written `12.50` arrives as `12.5`, and
`assertEquals(new BigDecimal("12.50"), receipt.shippingCost())` fails on scale
alone. Compare with `compareTo`.
