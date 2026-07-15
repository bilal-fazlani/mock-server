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

```bash
cd ui
npm run validate:catalog
```

This runs the same checks the server runs at startup — see
[Validation rules](../reference/configuration.md#validation-rules). Fix anything it
reports before moving on. A green `Catalog validation passed.` means catalog,
fixtures, and app config are in sync.

!!! warning "Restart after catalog or fixture changes"

    The catalog **and all fixtures** are loaded once at startup and served from
    memory, so changes need a server restart (or container rebuild) to take
    effect in production. In development, fixture bodies are re-read per request
    so edits apply live.

## 4. Choose a scenario for a profile

Open the UI at `/ui`, create or open a profile whose ID matches the value your
selector will extract (here, a `customerId` like `customer-123`), and pick the
scenario for **Account Balance**. Save.

Profiles are **deltas**: leaving an endpoint on `default` stores nothing — that
profile simply follows the catalog. Only picks that differ from `default`
(another scenario, or `real` when enabled) are stored. Instead of a single pick,
an endpoint can also be given an ordered
[scenario sequence](../building/scenarios.md#scenario-sequences) served
call-by-call. You can browse all declared endpoints and their scenarios at
`/ui/catalog`.

## 5. Call the endpoint

```bash
curl -s -X POST <origin>/accounts/balance \
  -H 'content-type: application/json' \
  -d '{"customerId":"customer-123"}'
```

The engine extracts `customer-123`, loads that profile, sees the scenario you
picked (or falls back to `default`), and returns the matching fixture with
placeholders resolved.
