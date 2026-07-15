# Using it in dev & CI

The mock server exists so your code can call it instead of real upstreams. Point
your app's upstream base URL (the value your app reads for a system, e.g. what
would otherwise be `HELLO_SYSTEM_URL`) at the running mock server, then choose
scenarios in the UI or over the [Runtime-control API](api.md).

## Local development

Run the server (`npx @bilal-fazlani/mock-server ./catalog`), set your app's
upstream URL to `http://localhost:3000`, and pick scenarios in `/ui`. Switch an
endpoint to the `real` scenario when you want that one call to hit the live
upstream — handy for migrating off real dependencies one endpoint at a time.

## Continuous integration

In CI the in-memory MongoDB is enough — each run starts clean and ephemeral data
is exactly what you want. Start the server, wait for `/ui/api/health`, then drive
it from your tests over the API.

```yaml
name: test
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Start mock server
        run: npx @bilal-fazlani/mock-server ./catalog &
      - name: Wait for health
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/ui/api/health && exit 0
            sleep 1
          done
          echo "mock server did not become healthy" >&2; exit 1
      - name: Run tests
        run: npm test
        env:
          HELLO_SYSTEM_URL: http://localhost:3000
```

### A worked control loop

Force a scenario, exercise your code, assert the call happened, clean up:

```bash
# 1. Force "charge" to the card_declined scenario for this caller
curl -sf -X PUT http://localhost:3000/ui/api/profiles/customer-123 \
  -H 'content-type: application/json' \
  -d '{"endpointScenarios":{"charge":"card_declined"}}'

# 2. ... run the code under test, which calls the mock as customer-123 ...

# 3. Assert your code actually called the endpoint
curl -sf 'http://localhost:3000/ui/api/logs?profile=customer-123&endpoint=charge'

# 4. Clean up
curl -sf -X DELETE http://localhost:3000/ui/api/profiles/customer-123
```

Use a **profile** (as above) for a profiled endpoint, or
`PUT /ui/api/global-mocks/{system}/{endpoint}` for a global one. Reset
[sequence](../building/scenarios.md#scenario-sequences) progress between tests
with `POST /ui/api/profiles/{id}/reset`. Full route details are in the
[Runtime-control API](api.md) reference.

## Ephemeral vs persistent data

| Setting | When | Data |
|---|---|---|
| No `MONGODB_CONNECTION_STRING` | CI, quick local runs | In-memory Mongo, wiped on restart |
| `MONGODB_CONNECTION_STRING` set | Shared dev/staging, teams | External Mongo, survives restarts |

Profiles, global-mock selections, sequence progress, and request logs all live in
MongoDB, so a shared long-lived environment needs a real connection string; a
throwaway CI run does not. See [Configuration](../reference/configuration.md) for
the full environment-variable list.
