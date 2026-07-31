# Fixtures

## Fixtures

Not every scenario is a fixture — a scenario can instead be backed by a
`<slug>.mjs` resolver that computes its outcome at request time; see
[Code-backed scenario resolvers](dynamic.md). This page covers the
fixture-backed (`<slug>.json`) case.

A fixture is a JSON file with this shape:

```json
{
  "description": "Balance available", // optional, shown as the scenario's label in the UI
  "summary": "200 with the settled balance", // optional, shown under the label in the catalog viewer
  "status": 200,                       // required, numeric HTTP status
  "delay": "400ms",                    // optional, wait this long before responding
  "headers": { "x-foo": "bar" },       // optional
  "body": { /* any JSON */ }           // required (key must be present; value may be any JSON)
}
```

- `description` is optional free text used as the scenario's label wherever the UI
  lists scenarios (profile form, catalog viewer). If omitted, the UI falls back to
  showing the filename (the scenario key) instead.
- `summary` is optional free text shown as a secondary line beneath the label on
  the catalog viewer's endpoint page — room for a sentence of context the short
  label can't carry. It appears only there (not in the profile form or logs), and
  an empty string is treated as absent.
- `status` is required and must be a number.
- `delay` is optional; see [Response delay](#response-delay) below.
- The `body` key must be present (its value can be an object, array, string,
  number, etc.).
- `content-type: application/json` is added to the response automatically; any
  headers you declare merge over it.
- String values in `body` and `headers` may contain [placeholders](#placeholders).
- Fixtures are loaded into memory at startup and served from that cache in
  production (re-read per request in development).

## Response delay

A fixture can declare a `delay` to make the mock wait before it responds — for
exercising client timeouts, spinners, retry/backoff, and circuit breakers
against a slow dependency:

```json
{
  "status": 200,
  "delay": "400ms",
  "body": { "ok": true }
}
```

- The value is a duration string: a non-negative integer followed by a unit,
  one of `ms`, `s`, or `m` (e.g. `"400ms"`, `"2s"`, `"1m"`). `"0ms"` is a valid
  no-op. A malformed `delay` is a catalog error caught at startup, not a runtime
  surprise.
- The delay applies only when the fixture is served — error responses and `real`
  passthrough are never delayed.
- Because a delay lives on a single scenario's fixture, and fixtures are selected
  per profile, you can make *one caller's* endpoint slow while everyone else stays
  fast — set `delay` on that profile's fixture.
- The injected wait is folded into the request's total duration and also recorded
  separately; see [Request logs](../driving/request-logs.md).

## Placeholders

Anywhere inside a fixture *string* (in `body` or `headers`), `{{ … }}` is
substituted at request time. Two kinds:

| Placeholder | Resolves to |
| --- | --- |
| `{{now:iso}}` | Current timestamp, ISO-8601 (e.g. `2026-07-03T10:15:00.000Z`) |
| `{{now:epoch}}` | Unix time in seconds (e.g. `1782987630`) |
| `{{now:epochMillis}}` | Unix time in milliseconds (e.g. `1782987630000`) |
| `{{now:YYYY-MM-DD}}` | Current date via a token pattern (e.g. `2026-07-03`) |
| `{{now:HH:mm:ss}}` | Current wall-clock time via a token pattern (e.g. `10:15:00`) |
| `{{now+3d:iso}}` | ISO-8601 timestamp offset by `+3` days from request time |
| `{{now-15m:iso}}` | ISO-8601 timestamp offset by `-15` minutes from request time |
| `{{uuid}}` | A freshly generated v4 UUID (e.g. `9f1c4e02-7a3b-4d15-9c8e-2f6b0d5a1e77`) |
| `{{uuid:booking}}` | A generated v4 UUID [shared by name](#generating-an-id) — every `{{uuid:booking}}` in one response is the same id |
| `{{faker:person.fullName}}` | A [fake data value](#generating-fake-data) from Faker (e.g. `Herminia Fadel`) |
| `{{pick:red:green:blue}}` | One of [your own listed values](#choosing-a-value-from-your-own-list), chosen per caller (e.g. `green`) |
| `{{$.path.in.body}}` | A value pulled from the request body |
| `{{path:name}}` | A path parameter from the URL |
| `{{query:name}}` | A query-string parameter |
| `{{header:name}}` | A request header, matched case-insensitively |

The `now` placeholder takes the form `now[±<n><unit>]:<format>`. The offset is
optional, with `unit` being `s` (seconds), `m` (minutes), `h` (hours), or `d`
(days). The `<format>` is either a **named format** or a **token pattern**:

- **Named formats** cover the shapes a pattern can't express readably: `iso`
  (full ISO-8601 timestamp), `epoch` (Unix seconds), `epochMillis` (Unix
  milliseconds).
- **Token patterns** compose any date/time shape from these tokens, each
  rendered zero-padded:

    | Token | Renders as |
    | --- | --- |
    | `YYYY` | 4-digit year (`2026`) |
    | `MM` | 2-digit month (`07`) |
    | `DD` | 2-digit day of month (`03`) |
    | `HH` | 2-digit hour, 24-hour clock (`10`) |
    | `mm` | 2-digit minute (`15`) |
    | `ss` | 2-digit second (`00`) |
    | `SSS` | 3-digit millisecond (`000`) |

    Punctuation (`-`, `:`, `/`, `.`, space) passes through as-is, so
    `{{now:YYYY-MM-DD}}`, `{{now:DD/MM/YYYY}}`, and `{{now:YYYYMMDD}}` all
    work. To include a literal *letter*, wrap it in square brackets:
    `{{now:YYYY-MM-DD[T]HH:mm:ss[Z]}}`. Any alphabetic character outside the
    token set (and outside `[…]`) is rejected — a typo like `{{now:datw}}`
    fails validation instead of rendering garbage.

Offsets and formats compose freely: `{{now+1h:iso}}`, `{{now-7d:YYYYMMDD}}`,
or `{{now+1h:epoch}}` for a timestamp one hour in the future as Unix seconds.
Both the offset and the format are statically validated, so an invalid `now`
expression is a catalog error, not a runtime surprise. All formats are
computed in UTC.

Selector placeholders use the reusable body/path/query/header selector grammar,
so you can echo request data straight into the response (e.g.
`"customerId": "{{$.customerId}}"`). Bearer selectors are deliberately not
available to placeholders, so an authorization credential cannot be echoed into a
fixture response.

### Generating an ID

`{{uuid}}` renders a random [version-4 UUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID),
which covers the ids a mocked write endpoint has to invent — resource ids,
idempotency keys, correlation ids:

```json
{
  "status": 201,
  "headers": { "x-request-id": "{{uuid}}" },
  "body": {
    "bookingId": "{{uuid}}",
    "customerId": "{{$.customerId}}",
    "createdAt": "{{now:iso}}"
  }
}
```

**By default every occurrence draws its own value.** A fixture returning a list
gives each element a distinct id, and the `bookingId` and `x-request-id` above
are two different UUIDs.

#### Sharing one id across several places

When a generated id has to appear in more than one place — a resource id echoed
into a `Location` header, a parent id repeated across child records, an
idempotency key returned in both the body and a header — give `{{uuid}}` a
**group name**. Every `{{uuid:name}}` sharing a name renders the *same* UUID
within one response; bare `{{uuid}}` keeps drawing a fresh value each time:

```json
{
  "status": 201,
  "headers": { "location": "/bookings/{{uuid:booking}}" },
  "body": {
    "bookingId": "{{uuid:booking}}",
    "auditId": "{{uuid}}",
    "legs": [
      { "id": "{{uuid}}", "bookingId": "{{uuid:booking}}" },
      { "id": "{{uuid}}", "bookingId": "{{uuid:booking}}" }
    ]
  }
}
```

Here `location`, `bookingId`, and both `legs[].bookingId` are one UUID; `auditId`
and each `legs[].id` are four more, all distinct.

A few details:

- The name is an opaque **label, not a seed** — it decides *which* placeholders
  agree, not *what* value they produce. The value is still randomly generated.
- Grouping is scoped to **one response**: two requests to the same fixture get
  different UUIDs for the same group name.
- The name is compared as text, so `{{uuid:1}}` and `{{uuid:'1'}}` are the same
  group, and `{{uuid:}}` is a real (empty-named) group, distinct from bare
  `{{uuid}}`.
- The name must be a **literal**. A selector name like `{{uuid:$.orderId}}` is a
  catalog error at startup — deciding a group from request data is not a designed
  behaviour.

The generator takes no format. It is a *source*, so it can only open a
placeholder, never follow a `|`: `{{$.name | uuid}}` is a catalog error at
startup. Piping the result onward works normally, so `{{uuid | upper}}` gives the
uppercase form.

!!! note "Responses stop being reproducible"

    A fixture containing `{{uuid}}` returns a different body on every request, so
    a consuming test cannot assert on the generated value — assert its *shape*
    instead. Where a caller needs a stable value, echo one the request already
    carries (`{{header:x-request-id}}`, `{{$.id}}`) rather than generating one.

### Generating fake data

`{{faker:module.method}}` draws a value from [Faker](https://fakerjs.dev/), covering
the realistic-looking names, emails, addresses, and prices a hand-typed fixture
usually fakes badly:

```json
{
  "status": 200,
  "body": {
    "customerName": "{{faker:person.fullName}}",
    "email": "{{faker:internet.email}}",
    "city": "{{faker:location.city}}",
    "age": "{{faker:number.int:18:65}}"
  }
}
```

A response might render as:

```json
{
  "customerName": "Herminia Fadel",
  "email": "Herminia_Fadel23@hotmail.com",
  "city": "Port Erikview",
  "age": 42
}
```

Only Faker's **data-generating modules** are exposed — the ones that produce a
value with no side effect. These are the modules you can use:

`person`, `internet`, `location`, `commerce`, `company`, `lorem`, `number`,
`date`, `string`, `color`, `animal`, `music`, `science`, `vehicle`, `word`,
`phone`, `finance`, `database`, `git`, `food`, `book`, `airline`, `hacker`.

Everything else is deliberately **not** available: the `helpers` utility
namespace (`arrayElement`, `slugify`, …) — its helpers take arrays, regexes, and
callbacks a placeholder can't express, and `{{pick:…}}` already covers choosing
from a list — `image` (network calls and placeholder URLs, not deterministic
data), and any of Faker's internal members.

Every zero-argument method on an exposed module works out of the box —
`{{faker:person.firstName}}`, `{{faker:company.name}}`, `{{faker:date.past}}`.
Browse the full method list in [Faker's own docs](https://fakerjs.dev/api/). A
curated set additionally takes positional arguments, mapped onto the options
object the underlying Faker method expects:

| Placeholder | Calls | Argument(s) |
| --- | --- | --- |
| `{{faker:number.int:MIN:MAX}}` | `number.int({ min: MIN, max: MAX })` | `MIN`, `MAX` numeric literals, `MIN <= MAX` |
| `{{faker:number.float:MIN:MAX}}` | `number.float({ min: MIN, max: MAX })` | `MIN`, `MAX` numeric literals, `MIN <= MAX` |
| `{{faker:string.alphanumeric:LEN}}` | `string.alphanumeric(LEN)` | `LEN` a non-negative integer literal |
| `{{faker:string.alpha:LEN}}` | `string.alpha(LEN)` | `LEN` a non-negative integer literal |
| `{{faker:string.numeric:LEN}}` | `string.numeric(LEN)` | `LEN` a non-negative integer literal |
| `{{faker:lorem.words:COUNT}}` | `lorem.words(COUNT)` | `COUNT` a positive integer literal |
| `{{faker:lorem.sentences:COUNT}}` | `lorem.sentences(COUNT)` | `COUNT` a positive integer literal |

`{{faker:number.int:1:100}}` renders a whole number between 1 and 100 inclusive.
A method outside this table takes **no** arguments — `{{faker:person.firstName:x}}`
is a catalog error at startup, and so is a `module.method` that isn't in the
exposed list above or doesn't exist (`{{faker:helpers.arrayElement}}`,
`{{faker:image.avatar}}`, `{{faker:person.bogus}}`) — every case is checked when
the catalog loads, not on the first request that reaches the fixture.

Like `uuid`, `faker` is a **source**: it takes no piped value, so
`{{$.name | faker:person.fullName}}` is a catalog error at startup. Piping its
result onward works normally: `{{faker:internet.email | lower}}`.

### Choosing a value from your own list

`{{pick:red:green:blue}}` renders one of the values **you list**, rather than
generating one — the placeholder for a small fixed vocabulary a fixture should
vary over: a status enum, a currency code, a shipping carrier:

```json
{
  "status": 200,
  "body": {
    "currency": "{{pick:USD:EUR:GBP}}",
    "carrier": "{{pick:ups:fedex:dhl}}"
  }
}
```

Each argument is a [typed argument](#placeholder-expressions) like any other,
and the chosen value keeps its type: `{{pick:1:2:3}}` picks among the **numbers**
`1`, `2`, `3`, not the strings `"1"`, `"2"`, `"3"`. Quote an argument that should
stay text: `{{pick:'1':'2':'3'}}` picks among strings.

`pick` accepts any number of arguments, and — like `uuid`'s group name and
`faker`'s method path — they must all be **literals**: `{{pick:$.color}}` and
`{{$.color | pick:red}}` are both catalog errors at startup, not a selector
silently treated as one more candidate. It draws from the same seeded generator
`faker` does, so it shares the same [determinism](#determinism-and-seeding): the
same caller and endpoint always pick the same element.

Like `uuid` and `faker`, `pick` is a **source** — it cannot follow a `|` — but
its result can be piped onward: `{{pick:red:green:blue | upper}}`.

### Determinism and seeding

Every `{{faker:...}}` and `{{pick:...}}` placeholder is **seeded**: its value is
derived from the active profile, the endpoint, and where the placeholder sits in
the fixture — not drawn from an unseeded random number generator.

- **Reproducible per caller.** The same profile calling the same endpoint gets
  the same values every time, so a consuming test can assert on the rendered
  value rather than only its shape.
- **Different profiles diverge.** `{{faker:person.fullName}}` on the same
  endpoint renders a different name for one profile than for another, and
  differently again with no profile selected.
- **Stable under unrelated edits.** Adding a placeholder elsewhere in the same
  fixture — even earlier in the body — never changes the value an existing
  placeholder already renders. Each placeholder's seed comes from its own
  position, not from the order values happen to be drawn in.
- **Position determines the value, not only the call.** Two placeholders with
  the identical call still render independently by where they sit —
  `"legs": ["{{faker:string.uuid}}", "{{faker:string.uuid}}"]` renders two
  distinct ids, and the same call in the response body renders differently than
  in a header.

!!! note "Contrast with `{{uuid}}`"

    `{{uuid}}` is deliberately the opposite: **unseeded**, drawing a fresh value on
    every request so a resource id is never predictable or replayable. Reach for
    `faker`/`pick` when a fixture should look the same to a given caller across
    requests; reach for `uuid` when it should look different every time — that's
    what makes it safe to use for a resource id or idempotency key.

!!! warning "Stable within a release, not across upgrades"

    A `faker`/`pick` value is guaranteed stable only for the lifetime of one
    mock-server version. Upgrading the mock server — a new Faker version, or a
    change to the seeding algorithm — can change which value a given placeholder
    renders, even though the *shape* (a name, an email, a number in range)
    doesn't. A test asserting on fixture output should assert the shape rather
    than the exact value — the same contract [`{{uuid}}`](#generating-an-id)
    already sets.

### Echoing a request header

`{{header:name}}` reads a request header, which is the usual way to hand a
correlation ID back to the caller — in the body, in a response header, or both:

```json
{
  "status": 200,
  "headers": { "x-request-id": "{{header:x-request-id}}" },
  "body": { "traceparent": "{{header:traceparent}}", "status": "ACTIVE" }
}
```

```bash
curl <origin>/accounts/balance -H 'X-Request-Id: req-42'
```

Header names are matched **case-insensitively**, so `{{header:x-request-id}}` and
`{{header:X-Request-Id}}` are the same selector and both match whatever casing the
caller sent. The name must match `[a-zA-Z_][a-zA-Z0-9_-]*` — the wider character
set HTTP allows includes `'` and `|`, which are separators in the placeholder
grammar.

!!! warning "Credential headers cannot be echoed"

    `authorization`, `proxy-authorization`, `cookie`, and `set-cookie` are
    rejected. Writing `{{header:cookie}}` is a **catalog error at startup**, not a
    blank value at request time — the mock will not start until the placeholder is
    removed. This is the same guarantee that keeps Bearer selectors out of
    placeholders.

A header the caller did not send is an unresolved placeholder, which fails the
request with a `500` naming it — the same loud behavior as an absent body field.
Pipe it through [`default`](#fallbacks-for-missing-values) when the header is
optional: `{{header:x-request-id | default:unknown}}`.

## Placeholder expressions

Every placeholder is parsed as an **expression**: a source value — a selector or
a `now` token — optionally piped through **function calls**:

```json
{
  "name": "{{$.name | upper}}",
  "label": "{{label:$.status}}"
}
```

The grammar, in full:

- **Call:** `name:arg:arg` — a function name followed by colon-separated
  arguments (`label:$.status`, `pad:'007'`).
- **Pipe:** `|` composes calls left to right; `x | f:a` passes the previous
  value as `f`'s first argument. Only function calls may follow a `|` — the
  selector/`now` forms are valid only as the leading stage.
- **Typed arguments:** a decimal number becomes a number, `true`/`false` become
  booleans, a `'single-quoted'` token is a literal string (quotes stripped —
  and `:` or `|` inside the quotes are literal characters, not separators), a
  `$.…` token is resolved against the request body, and any other bare token is
  a string. A quote only opens a literal at the **start** of a token, so an
  apostrophe inside a bare word stays ordinary text (`label:it's` is the string
  `it's`); a quote that opens a token and never closes (`pad:'oops`) is a
  catalog error, not a literal. A trailing colon with nothing after it is the
  empty string, so `default:` and `default:''` are the same argument.
- Call arguments accept **body selectors and literals only**. `path:`, `query:`,
  and `header:` values can't be passed as arguments — start the chain with them
  (`{{path:id | upper}}`, `{{header:x-request-id | upper}}`) or read them from `context.request` inside a custom
  function.

Function names resolve to a [built-in transform](#built-in-transforms) or a
[custom function](#custom-functions-_functionsmjs); anything else is a catalog
error at startup, never a runtime surprise.

## Built-in transforms

| Transform | Arguments | Effect |
| --- | --- | --- |
| `upper` | the piped value | Uppercase the piped value |
| `lower` | the piped value | Lowercase the piped value |
| `trim` | the piped value | Strip leading and trailing whitespace |
| `default` | the piped value, plus a fallback | Substitute the fallback when the piped value is [missing](#fallbacks-for-missing-values) |
| `omit` | the piped value | [Drop the field](#dropping-a-field-when-its-source-is-absent) when the piped value is absent |
| `uuid` | an optional group name | Generate a [v4 UUID](#generating-an-id) — a source, so it cannot follow a `\|`. Fresh per occurrence, or shared across every `{{uuid:name}}` with the same name |
| `faker` | a `module.method` path, plus [positional arguments](#generating-fake-data) for a curated few methods | Draw a [fake data value](#generating-fake-data) from Faker — a source, so it cannot follow a `\|`. [Seeded](#determinism-and-seeding), unlike `uuid` |
| `pick` | one or more literal values | [Choose one](#choosing-a-value-from-your-own-list) of the listed values — a source, so it cannot follow a `\|`. [Seeded](#determinism-and-seeding), unlike `uuid` |

They compose left to right, so `{{$.name | trim | upper}}` trims first and
uppercases the result.

Every built-in takes a **fixed number of arguments**, counting the piped value as
the first one — except `uuid`, which takes an optional group name and so accepts
0 or 1, and `faker`/`pick`, which take one or more (a method path, or a list of
candidate values) and so have no upper bound. Calling one with the wrong count —
`{{$.name | default}}`, `{{$.name | uuid}}` (hands a value to a built-in that
takes none), or bare `{{faker}}`/`{{pick}}` (no method path or candidates) — is a
catalog error at startup, not a `500` on the first request that reaches the
fixture. Custom functions are ordinary JavaScript and take whatever they take.

Fake data and seeded randomness are covered by `faker` and `pick`; hashing and
encoding remain candidates for future built-ins on this same mechanism.
Built-in names (including `now`, `body`, `path`, `query`, `header`, and
`profileKey`) are reserved — a custom function may not use them.

### What a transform accepts

`upper`, `lower`, and `trim` take **text**, and a placeholder can carry any JSON
value, so they state what they do with the rest:

- **Numbers and booleans are stringified.** `{{$.count | upper}}` against
  `{ "count": 42 }` renders `"42"` — the transform is a no-op on the digits, but
  the value is now a string.
- **A JSON `null` passes straight through, untransformed.** `{{$.nickname | upper}}`
  against `{ "nickname": null }` renders `null`. Nothing is uppercased and
  nothing fails — the same way `UPPER(NULL)` is `NULL` in SQL.
- **Objects and arrays fail the request** with a `500` naming the transform and
  what it received. There is no useful uppercase of an object, and the
  alternative — `"[object Object]"` in a response body — is a silent wrong
  answer.

### Fallbacks for missing values

By default an unresolved placeholder fails the request with a `500`, which is what
catches fixture typos. When a field is genuinely optional, pipe it through
`default` to supply a value instead:

```json
{
  "name": "{{$.name | default:Guest}}",
  "nickname": "{{$.nickname | default:''}}",
  "retries": "{{$.retries | default:0}}",
  "requestId": "{{header:x-request-id | default:unknown}}"
}
```

`default` fires when its input is **absent** — a body key that isn't there, an
out-of-range array index, a header or query parameter the caller didn't send — or
when the value is explicitly JSON `null`. An empty string and `false` are real
values and pass straight through, so `{{$.nickname | default:Guest}}` against
`{ "nickname": "" }` renders the empty string, not `Guest`.

The fallback is a [typed argument](#placeholder-expressions) like any other:
`default:Guest` and `default:'N/A'` are strings, `default:''` is the empty
string, `default:0` is the number, `default:true` is the boolean, and
`default:$.other` reads another body field — so fallbacks chain,
`{{$.nickname | default:$.name | default:'anonymous'}}`.

!!! note "Empty values skip the transforms in between"

    An absent value and a `null` both travel down the pipe untouched: every
    [transform](#built-in-transforms) between the selector and the `default` is
    **skipped**, so `{{$.name | upper | default:Guest}}` renders `Guest` rather
    than uppercasing nothing. Order doesn't matter, and the two kinds of empty
    behave the same:

    | Placeholder | `name` absent | `"name": null` |
    | --- | --- | --- |
    | `{{$.name}}` | `500` | `null` |
    | <code>{{$.name \| upper}}</code> | `500` | `null` |
    | <code>{{$.name \| default:Guest}}</code> | `Guest` | `Guest` |
    | <code>{{$.name \| upper \| default:Guest}}</code> | `Guest` | `Guest` |

    Wherever there is a `default`, the two columns agree. Without one they part
    company for the reason they are different things: absence has no value to
    render and fails loudly, while `null` **is** a value and renders as itself.

    Custom functions differ on one point: an absent value skips them too —
    `{{describe:$.name | default:Guest}}` never calls `describe` — because there
    is nothing to pass. A `null` **is** passed to them, since your own code can
    decide what a null means. To have a function handle absence itself, give it
    something concrete first: `{{$.name | default:'' | describe}}`.

### Dropping a field when its source is absent

`default` supplies a *value* when the source is missing; `omit` supplies
*structural absence* — it removes the field entirely. This lets an echo fixture
mirror the request: an optional field the caller leaves out is simply left out of
the response.

```json
{ "id": "{{$.id}}", "middleName": "{{$.middleName | omit}}" }
```

```text
request { "id": "x" }                → response { "id": "x" }
request { "id": "x", "middleName": "Q" } → response { "id": "x", "middleName": "Q" }
```

`omit` fires **only on absence** — a key that isn't there, an out-of-range array
index, a header the caller didn't send. This is the one place `omit` and
`default` deliberately diverge:

| `middleName` in the request | with `default:'N/A'` | with `omit` |
| --- | --- | --- |
| `"middleName": "Q"` | `"Q"` | `"Q"` |
| `"middleName": null` | `"N/A"` | `null` (key kept) |
| `middleName` absent | `"N/A"` | key dropped |

`default` fills a `null`; `omit` **mirrors** it. That is what lets `omit` mock an
API where *absent* and *present-but-null* mean different things — JSON Merge
Patch, for instance, where `null` means "delete" and absent means "leave
untouched". Dropping the `null` would erase exactly the distinction such an
endpoint is built on.

!!! warning "`omit` may only be the whole value of a field or header"

    Because `omit` removes a **named** slot, it is valid only as the entire value
    of an object property or a response header. Anywhere it has nothing to drop is
    a **catalog error at startup**, not a runtime surprise:

    - inside a larger string — `"hi {{$.x | omit}}!"`
    - as an array element — `["{{$.x | omit}}"]`
    - as the whole response body
    - anywhere but the **last** stage of a pipe — `{{$.x | omit | upper}}`

    Startup is deliberate: a misused `omit` would otherwise only fail on the
    request that actually omits the field, passing every test where it happens to
    be present. Response **headers** may be dropped the same way —
    `{ "x-trace": "{{header:x-trace | omit}}" }` sends the header only when the
    caller sent one.

    Dropping a field the [response schema](schemas.md) marks **required** is still
    a `500` at request time — an omitted required field is a real contract
    violation, and validation catches it.

## Custom functions (`_functions.mjs`)

When the built-ins can't express what a fixture needs — formatting, derived
values, combining request inputs — export your own functions from a
`_functions.mjs` file in the catalog:

```js
// catalog/hello-system/_functions.mjs
export const label = (_ctx, status) => `CUSTOMER: ${String(status).toUpperCase()}`
```

```json
{ "label": "{{label:$.status}}" }
```

Each **named export** becomes a callable function. The contract is
`(context, ...args)`. A `default` export has no name for a placeholder to call,
so it is a catalog error at startup — export named functions instead.

- **Prefer explicit arguments.** Pass request data in as arguments
  (`label:$.status`) — it keeps functions inspectable and reusable. Arguments
  arrive already resolved: selectors as their extracted values, literals as
  typed values, the piped value first.
- **`context` is the escape hatch** for multi-source cases: `context.request`
  carries `method`, `path`, `pathParams`, `query`, `headers`, and `body`;
  `context.now` is the request timestamp; `context.seed` is stable per
  `(profile, endpoint)` for reproducible pseudo-randomness.

A `_functions` file may live at three levels, and the **nearest definition
wins** when names collide:

| Level | Location | Visible to |
| --- | --- | --- |
| Catalog | `catalog/_functions.mjs` | every endpoint |
| System | `catalog/<system>/_functions.mjs` | that system's endpoints |
| Endpoint | `catalog/<system>/<endpoint>/_functions.mjs` | that endpoint's fixtures |

Functions run in the same sandbox as
[scenario resolvers](dynamic.md#compilation-sandboxing-and-timeouts): compiled
once at startup, executed in an empty `node:vm` context with a **100 ms
per-call timeout**, no `require`, `process`, `fetch`, or `console`. In
practice:

- **No imports.** The sandbox has no `require`, so an `import` fails at
  catalog load. Everything a function needs arrives through its arguments and
  `context`.
- **Write pure functions.** Module-level mutable state survives across requests
  for the life of the process — it is not part of the contract. Derive
  variability from `context.now` and `context.seed` instead of `Date`/`Math.random`
  so responses stay reproducible.
- **Failures are loud.** A function that throws, exceeds its timeout, or
  returns something unusable fails the request with a `500` naming the function
  and the placeholder — never a silent empty string.

### Editor support (optional)

For autocomplete on `context` in any editor, paste this self-contained JSDoc
block at the top of the file — it needs nothing installed and no
`tsconfig.json`, and is safe to delete:

```js
// @ts-check
/** @typedef {{request: {method: string, path: string,
 *   pathParams: Record<string,string>, query: Record<string,string[]>,
 *   headers: Record<string,string>, body: unknown},
 *   now: Date, seed: string}} FnContext */

/** @param {FnContext} ctx */
export const whoami = (ctx) => ctx.request.headers['x-user'] ?? 'anonymous'
```

With `// @ts-check` on, the editor also flags typos like
`ctx.request.params` (it is `pathParams`) before a request ever runs.

### Errors

Catalog errors are raised at startup, so the server never begins serving with a
broken `_functions` file. Request errors return a `500` and are recorded in the
[request trace](../driving/request-logs.md) under their own code.

| Situation | Trace error code | When |
| --- | --- | --- |
| The file fails to transpile or throws while evaluating | — | Startup. The catalog does not load. |
| The file has a `default` export, or exports a [reserved name](#built-in-transforms) | — | Startup. The catalog does not load. |
| A `_functions.ts` file exists (`.ts` authoring was removed) | — | Startup. The catalog does not load — rename it to `_functions.mjs` and remove type annotations. |
| The function throws | `function_error` | Request time. |
| The function exceeds its 100&nbsp;ms timeout | `function_timeout` | Request time — guards against a runaway synchronous loop. |
| The function returns something with no JSON representation — `undefined`, a function, a symbol, a bigint, or a non-finite number (`NaN`, `Infinity`) | `function_error` | Request time. |
| The placeholder itself fails — an unresolved selector, or an unknown function name | `template_error` | Request time. |

The function codes are deliberately distinct from `template_error` so a log
reader can tell an author's function apart from a bad placeholder; the `500`
body is identical either way.

## Typed substitution

Substitution preserves types. When a fixture string is **exactly one
placeholder**, the resolved value is emitted raw — numbers stay numbers,
booleans stay booleans, and a function may even return an object or array:

```json
{ "amount": "{{$.amount}}" }   // → { "amount": 42 }, not { "amount": "42" }
```

When a placeholder is **interpolated** into surrounding text (including two
adjacent placeholders), the value is coerced to a string — objects and arrays
as JSON. Response **header** values are always rendered as strings, whatever
the placeholder shape.

!!! note "Body selectors extract any JSON value"

    A `$.…` selector pulls out **whatever JSON value the field holds** — strings,
    numbers, booleans, `null`, and whole object or array subtrees. `{{$.isActive}}`
    against `{ "isActive": false }` emits `false`; `{{$.user}}` echoes the entire
    `user` subtree. A field that is literally JSON `null` resolves to `null` — a
    *present* value, distinct from an absent one. Only a path that isn't there at
    all (a missing key or an out-of-range array index) is unresolved, and that
    fails with a `500` like any other unresolved placeholder.

!!! warning "Placeholders must resolve"

    If a selector placeholder can't find its value in the request, or a custom
    function fails, the endpoint returns `500` for that request — unless the
    placeholder supplies a [`default`](#fallbacks-for-missing-values). Everything
    checkable ahead of time is checked at startup — malformed expressions,
    unknown `now:` formats, unknown function names (including a function defined
    only in *another* system's scope), and built-ins called with the wrong number
    of arguments are catalog errors — but resolution against a specific request
    is the one thing validation can't pre-check.

    One slice of it *is* pre-checkable, though: when the endpoint has a
    [request schema](schemas.md), a placeholder over a body field the schema
    marks **optional**, with no `default`/`omit`, is caught at startup — see
    [Optional fields must have a fallback](schemas.md#optional-fields-must-have-a-fallback).
