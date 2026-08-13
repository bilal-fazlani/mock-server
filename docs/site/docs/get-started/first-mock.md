---
description: "Add POST /accounts/balance to an existing system, with a default and an insufficient scenario, step by step."
---

# Step-by-step: add an endpoint

We'll add `POST /accounts/balance` to the existing "Hello System", returning a
customer's balance, with a `default` (balance available) and an `insufficient`
scenario.

## 1. Create the endpoint directory and its metadata

Under the system directory, make a new directory named after the endpoint and add
`_endpoint.json`:

`catalog/hello-system/account_balance/_endpoint.json`

```json
{
  "displayName": "Account Balance",
  "method": "POST",
  "path": "/accounts/balance",
  "profileIdSelector": "$.customerId"
}
```

Note what's *not* here: no `name` field (the directory name `account_balance` *is*
the endpoint name) and no scenario list — scenarios are just the `<scenario>.json`
files you drop in next, not something declared up front. There's also no `real`
entry to write — passthrough is implicit on every endpoint. Every field is
explained in the [Endpoints](../building/endpoints.md) reference. (If this is a
brand-new system, first create its directory with a `_system.json` — see
[Endpoints](../building/endpoints.md).)

## 2. Write a fixture for each scenario

Each scenario is one `<scenario>.json` file, named after the scenario, sitting
next to `_endpoint.json`:

`catalog/hello-system/account_balance/default.json`

```json
{
  "description": "Balance available",
  "status": 200,
  "body": {
    "customerId": "{{$.customerId}}",
    "balance": "4200.00",
    "currency": "USD",
    "asOf": "{{now:iso}}"
  }
}
```

`catalog/hello-system/account_balance/insufficient.json`

```json
{
  "description": "Insufficient funds",
  "status": 402,
  "headers": { "x-reason": "insufficient_funds" },
  "body": {
    "customerId": "{{$.customerId}}",
    "error": "INSUFFICIENT_FUNDS"
  }
}
```

The filename (`default`, `insufficient`) is the scenario key. `description` is
optional and is what shows up as the scenario's label in the UI; without it, the
UI falls back to the filename. There is never a fixture named `real.json` — that
scenario proxies to the live upstream instead of reading a file, and its presence
is a validation error.

## 3. Validate the catalog

Check it without starting anything:

```bash
npx @bilal-fazlani/mock-server validate ./catalog
```

```text
Catalog validation passed.
```

Every problem is reported at once, so fix what it lists before moving on — the
full rule list is in
[Validation rules](../reference/configuration.md#validation-rules).

The server runs the same catalog checks at startup and refuses to boot on any
error, so restarting is a valid check too; the subcommand just doesn't need a
port or a database to tell you. The other ways to run it — inside a `docker
build`, or from a source checkout — are in
[Validating a catalog](../building/validate.md).

!!! warning "Restart after catalog or fixture changes"

    The catalog **and all fixtures** are loaded once at startup and served from
    memory, so changes need a server restart (or container rebuild) to take
    effect in production. In development, fixture bodies are re-read per request
    so edits apply live.

## 4. Call it

Start the server and send the request. Nothing else is set up yet — that is the
point:

```bash
curl -s -X POST <origin>/accounts/balance \
  -H 'content-type: application/json' \
  -d '{"customerId":"customer-123"}'
```

```json
{
  "customerId": "customer-123",
  "balance": "4200.00",
  "currency": "USD",
  "asOf": "2026-08-13T09:14:02.881Z"
}
```

The engine extracted `customer-123` with your `$.customerId` selector, looked for
a profile with that ID, found none, and served `default.json` with its
placeholders resolved. That last step is
[`UNMOCKED_USERS`](../reference/configuration.md), which defaults to
`DEFAULT_MOCK` — every endpoint is required to have a `default` scenario, so
there is always something to serve.

The server says so on its side, at `warn`:

```text
[mock] POST /accounts/balance -> 200 4ms hello-system/account_balance profile=customer-123 scenario=default source=unmocked_policy selector=$.customerId outcome=fixture
```

`source=unmocked_policy` means "no profile matched" — which is the next thing to
fix, not an error. Set `UNMOCKED_USERS=ERROR` if you would rather this case be a
`404`.

## 5. Vary the response per caller

`default` is what *every* caller gets. A profile is how one caller gets something
else — here, how `customer-123` gets `insufficient` while everyone else keeps
seeing a balance.

Open [the dashboard](../driving/ui.md) at `/ui`, create a profile whose ID is
`customer-123`, pick **Insufficient funds** for **Account Balance**, and save.
Repeat the same curl:

```json
{
  "customerId": "customer-123",
  "error": "INSUFFICIENT_FUNDS"
}
```

`402`, from `insufficient.json`, and the console line no longer carries
`source=unmocked_policy`.

Profiles are **deltas**: leaving an endpoint on `default` stores nothing — that
profile simply follows the catalog. Only picks that differ from `default`
(another scenario, or `real` when enabled) are stored. Instead of a single pick,
an endpoint can also be given an ordered
[scenario sequence](../building/scenarios.md#scenario-sequences) served
call-by-call. You can browse all declared endpoints and their scenarios at
`/ui/catalog`.
