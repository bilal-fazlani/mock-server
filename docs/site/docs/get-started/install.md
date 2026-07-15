# Install & run

Requirements: **Node.js 22+**. MongoDB is optional — if
`MONGODB_CONNECTION_STRING` isn't set, an in-memory MongoDB starts automatically
(data is ephemeral, lost on restart). Set it to persist profiles, global mock
selections, mappings, and request logs across restarts. For when to use each, see
[Using it in dev & CI](../driving/dev-and-ci.md#ephemeral-vs-persistent-data).

Mock endpoints are served at the **root** of the origin — an endpoint whose
catalog `path` is `/hello/world` answers at `http://localhost:3000/hello/world`.
The management UI lives under `http://localhost:3000/ui`.

## npx (quickest)

```bash
npx @bilal-fazlani/mock-server ./catalog
```

The positional argument is the catalog directory (default `./catalog`, relative
to your current directory); it overrides the `CATALOG_PATH` environment variable.

```text
Usage:
  mock-server [catalogPath] [options]

Arguments:
  catalogPath            Path to the catalog directory (default: ./catalog).
                         Overrides the CATALOG_PATH environment variable.

Options:
  -p, --port <number>    Port to listen on (default: 3000, or $PORT).
  -h, --help             Show this help and exit.
  -v, --version          Print the version and exit.
```

## Docker

Published images live in the GitHub Container Registry at
[`ghcr.io/bilal-fazlani/mock-server`](https://github.com/bilal-fazlani/mock-server/pkgs/container/mock-server)
(multi-arch `linux/amd64` and `linux/arm64`). Use `latest` or a pinned version tag
like `1.2.0`; images are published only for tagged releases.

```bash
docker run --rm -p 3000:3000 ghcr.io/bilal-fazlani/mock-server:latest
```

The image bakes in `mongod`, so with no `MONGODB_CONNECTION_STRING` it starts an
in-memory MongoDB (ephemeral — lost when the container stops). Pass a connection
string for a real, persistent MongoDB instead:

```bash
docker run --rm -p 3000:3000 \
  -e MONGODB_CONNECTION_STRING='mongodb://host.docker.internal:27017' \
  ghcr.io/bilal-fazlani/mock-server:latest
```

The image bakes in the example `catalog/` tree. To serve your own catalog without
rebuilding, mount it over the baked-in one:

```bash
docker run --rm -p 3000:3000 \
  -v "$(pwd)/catalog:/app/catalog:ro" \
  ghcr.io/bilal-fazlani/mock-server:latest
```

## From source (development)

```bash
git clone https://github.com/bilal-fazlani/mock-server
cd mock-server
npm install
cp .env.example .env.local   # then edit as needed
npm run dev
```

The repository ships a small example system (`catalog/hello-system/`) so you have
something to call and edit right away:

```bash
curl -s -X POST http://localhost:3000/hello/world \
  -H 'content-type: application/json' \
  -d '{"customerId":"customer-123"}'
```

## Health check

`GET /ui/api/health` returns `200 {"status":"ok","mongo":"up"}` when MongoDB is
reachable, or `503 {"status":"error","mongo":"down"}` otherwise — useful as a
readiness probe when scripting startup (see
[Using it in dev & CI](../driving/dev-and-ci.md)).

## Next steps

- Full environment-variable list → [Configuration](../reference/configuration.md).
- Add your own endpoint → [Your first mock endpoint](first-mock.md).
- Drive a running server from tests → [Driving mocks](../driving/api.md).
