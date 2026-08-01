# Install & run

Requirements: **Node.js 22+**. MongoDB is optional — if
`MONGODB_CONNECTION_STRING` isn't set, an in-memory MongoDB starts automatically
(data is ephemeral, lost on restart). Set it to persist profiles, global mock
selections, mappings, and request logs across restarts. For when to use each, see
[Using it in dev & CI](../driving/dev-and-ci.md#ephemeral-vs-persistent-data).

Mock endpoints are served at the **root** of the origin — an endpoint whose
catalog `path` is `/hello/world` answers at `http://localhost:3000/hello/world`.
The management UI lives under `http://localhost:3000/ui`.

## Ways to run it

There are four, and they suit different moments:

| Way | Best for | Catalog comes from |
| --- | --- | --- |
| [npx](#npx-quickest) | Local runs, CI jobs | A directory on the machine |
| [Docker, run + mount](#docker-run-the-image-dev-loop) | The dev loop, quick trials | A directory mounted into the container |
| [Docker, extend the image](#docker-extend-the-image-deployment) | Deployment to k8s/ECS/staging | Baked into a versioned image |
| [From source](#from-source-development) | Working on the mock server itself | The repository's example catalog |

Whichever you pick, you can check a catalog without starting anything — see
[Validating a catalog](../building/validate.md).

## npx (quickest)

```bash
npx @bilal-fazlani/mock-server ./catalog
```

The positional argument is the catalog directory (default `./catalog`, relative
to your current directory); it overrides the `CATALOG_PATH` environment variable.

```text
Usage:
  mock-server [catalogPath] [options]
  mock-server validate [catalogPath]

Commands:
  validate               Check a catalog and exit, without starting the server.
                         Run "mock-server validate --help" for details.

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

The image also bakes in the example `catalog/` tree. Your own catalog gets there
one of two ways, and both are supported.

### Docker: run the image (dev loop)

Mount your catalog over the baked-in one. Nothing is built, so an edit is one
container restart away:

```bash
docker run --rm -p 3000:3000 \
  -v "$(pwd)/catalog:/app/catalog:ro" \
  ghcr.io/bilal-fazlani/mock-server:latest
```

The same image can check that catalog instead of serving it — useful when you
want the validation output but have no Node.js on the machine:

```bash
docker run --rm \
  -v "$(pwd)/catalog:/app/catalog:ro" \
  ghcr.io/bilal-fazlani/mock-server:latest mock-server validate
```

### Docker: extend the image (deployment)

For anything long-lived — k8s, ECS, a staging environment — build a derived image
with the catalog copied in. The result is a single versioned artifact that needs
no volume at run time, and `RUN mock-server validate` makes a broken catalog fail
the build rather than the deploy:

```dockerfile
FROM ghcr.io/bilal-fazlani/mock-server:latest
COPY --chown=nextjs:nodejs catalog /app/catalog
RUN mock-server validate
```

```bash
docker build -t my-mocks:1.4.0 .
docker run --rm -p 3000:3000 my-mocks:1.4.0
```

The `--chown=nextjs:nodejs` matters: the image drops to the unprivileged `nextjs`
user, which is also who runs the `RUN` line above. `ENTRYPOINT`, `CMD`, `EXPOSE`,
and the health check are all inherited, so the derived image needs none of them.

!!! note "`mock-server` is a shim, not the CMD"

    The image's `CMD` still starts the server directly, so plain `docker run`
    behaves exactly as before. `mock-server` is a small script on `PATH` that
    dispatches `serve` (the default) and `validate` — it exists so a derived
    build and an ad-hoc `docker run` can reach the validator.

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

A source checkout also has `npm run validate:catalog`, which checks that example
catalog against the checkout's own environment — see
[Validating a catalog](../building/validate.md#ways-to-validate).

## Health check

`GET /ui/api/health` returns `200 {"status":"ok","mongo":"up",…}` when MongoDB
is reachable, or `503 {"status":"error","mongo":"down",…}` otherwise — useful as
a readiness probe when scripting startup (see
[Using it in dev & CI](../driving/dev-and-ci.md)). Both bodies also carry the
running build's `version` and `sha`.

## Next steps

- Full environment-variable list → [Configuration](../reference/configuration.md).
- Add your own endpoint → [Your first mock endpoint](first-mock.md).
- Check a catalog without running it → [Validating a catalog](../building/validate.md).
- Drive a running server from tests → [Driving mocks](../driving/api.md).
