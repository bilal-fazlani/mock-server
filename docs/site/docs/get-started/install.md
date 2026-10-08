---
description: "Run the server via npx, Docker, or from source, and decide whether to persist state in MongoDB."
---

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

## Get a catalog to try

Neither the npm package nor the Docker image contains a catalog: the server needs
one from you, and exits with an error if it can't find it. To try the server
before writing your own, download the repository's example catalog
(`catalog/hello-system/`) into `./catalog`. It needs only `curl` and `tar`:

```bash
curl -fsSL https://github.com/bilal-fazlani/mock-server/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 mock-server-main/catalog
```

The example follows the repository's `main` branch, so it can be ahead of the
release you run. Then continue with a run below, or with
[Your first mock endpoint](first-mock.md), which starts from it.

## npx (quickest)

```bash
npx @bilal-fazlani/mock-server ./catalog
```

The positional argument is the catalog directory (default `./catalog`, relative
to your current directory); it overrides the `CATALOG_PATH` environment variable.
If the directory doesn't exist, or holds no systems, the server exits with an error saying so. Don't
have a catalog yet? [Download the example](#get-a-catalog-to-try).

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
  --bind <address>       IP address to listen on (default: 0.0.0.0, or
                         $BIND_ADDRESS). IPv4 or IPv6; a hostname is rejected.
  -h, --help             Show this help and exit.
  -v, --version          Print the version and exit.
```

## Docker

Published images live in the GitHub Container Registry at
[`ghcr.io/bilal-fazlani/mock-server`](https://github.com/bilal-fazlani/mock-server/pkgs/container/mock-server)
(multi-arch `linux/amd64` and `linux/arm64`). Use `latest` or a pinned version tag
like `0.10.0`; images are published only for tagged releases.

Tags track the [releases](https://github.com/bilal-fazlani/mock-server/releases)
one-for-one, so that page — or the [package
listing](https://github.com/bilal-fazlani/mock-server/pkgs/container/mock-server)
— is what to pin to. A server already running reports its own version at
`GET /ui/api/health`.

```bash
docker run --rm -p 3000:3000 \
  -v "$(pwd)/catalog:/app/catalog:ro" \
  ghcr.io/bilal-fazlani/mock-server:latest
```

The image contains no catalog, so this mounts yours at `/app/catalog`. Without one
the container exits with a `catalog directory not found` error rather than serving
nothing. A mount whose host path doesn't exist is created as an empty directory by
Docker, which exits with a `contains no systems` error in the same way. To try it first, [download the example catalog](#get-a-catalog-to-try).

The image bakes in `mongod`, so with no `MONGODB_CONNECTION_STRING` it starts an
in-memory MongoDB (ephemeral — lost when the container stops). Pass a connection
string for a real, persistent MongoDB instead:

```bash
docker run --rm -p 3000:3000 \
  -v "$(pwd)/catalog:/app/catalog:ro" \
  -e MONGODB_CONNECTION_STRING='mongodb://host.docker.internal:27017' \
  ghcr.io/bilal-fazlani/mock-server:latest
```

Your catalog gets into the image one of two ways, and both are supported.

### Docker: run the image (dev loop)

Mount your catalog at `/app/catalog`. Nothing is built, so an edit is one
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
and the [health check](#container-health-checks) are all inherited, so the derived
image needs none of them. So is the version the base image reports: a derived build cannot change it (see
[Naming your own build](#naming-your-own-build)).

!!! note "`mock-server` is a shim, not the CMD"

    The image's `CMD` still starts the server directly, so `docker run` needs no
    subcommand to serve. `mock-server` is a small script on `PATH` that
    dispatches `serve` (the default) and `validate` — it exists so a derived
    build and an ad-hoc `docker run` can reach the validator.

#### Trusting a database's CA

The image carries no CA bundle beyond the system's own, so it stays neutral about
where your MongoDB runs. When that database is signed by a private CA, or by a
managed database's CA such as Amazon DocumentDB's, add the bundle in a derived
image and point the connection string at it:

```dockerfile
# syntax=docker/dockerfile:1
FROM ghcr.io/bilal-fazlani/mock-server:latest
ADD --checksum=sha256:<hash> --chmod=0444 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/global-bundle.pem
COPY --chown=nextjs:nodejs catalog /app/catalog
RUN mock-server validate
```

Then run the image with the CA file named in the query string of
[`MONGODB_CONNECTION_STRING`](../reference/configuration.md), next to an explicit
`tls=true`:

```bash
docker run --rm -p 3000:3000 \
  -e MONGODB_CONNECTION_STRING='mongodb://user:pass@db.example.com:27017/?tls=true&tlsCAFile=/app/global-bundle.pem' \
  my-mocks:1.4.0
```

Three details in that `ADD` line:

- **No `USER` switch is needed.** `COPY` and `ADD` run as root whatever the base
  image's `USER` is, which is why the `COPY` line needs its `--chown` and the
  `ADD` line does not.
- **`--chmod=0444` is required.** A file fetched by a remote `ADD` lands with
  mode `600`, owned by root, which the image's unprivileged `nextjs` user cannot
  read — the connection then fails on the CA file rather than on the database.
- **`--checksum=sha256:<hash>` pins the download.** The build fails if the
  published bundle changes, instead of silently trusting a different one. When
  the provider rotates the bundle, update the hash; the image itself is not
  affected.

`ADD --checksum` needs BuildKit with Dockerfile frontend 1.6 or newer. The
`# syntax=docker/dockerfile:1` line at the top of the example fetches the current
frontend, so it works on any BuildKit-enabled Docker without checking versions.

For a bundle you already hold, `COPY --chmod=0444 my-ca.pem /app/my-ca.pem` does
the same without the download.

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
is reachable, or `503 {"status":"error","mongo":"down",…}` otherwise. It also
answers `503` with `"mongo":"unchecked"` when the server could not load its
configuration or catalog; a normally started server exits in that case, so you
see this under `npm run dev`. It is useful as
a readiness probe when scripting startup (see
[Using it in dev & CI](../driving/dev-and-ci.md)). Both bodies also carry the
running build's `version` and `sha`, the same pair the dashboard footer and the
[Environment page](../driving/ui.md#environment-uienvironment) show.

### Container health checks

The image declares its own `HEALTHCHECK`, which `docker run` and Docker Compose
honour. It asks the endpoint above from inside the container with Node:

```bash
node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/ui/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

Orchestrators usually run a check of their own instead — an ECS task
definition, a Compose `healthcheck:`, a Kubernetes `exec` probe — and ignore the
image's. `curl` is installed in the image for exactly that, so the usual form
works as it is:

```bash
curl -f http://localhost:3000/ui/api/health
```

Use your own port in place of `3000` if you changed `PORT`. `-f` makes `curl` exit non-zero on the `503` the endpoint returns when MongoDB is
down, which is what a probe needs. Use the Node form instead if you would rather
not depend on `curl`; both ship in the image.

Both forms connect to the loopback address, so they need the server listening on
it. The default does that: [`BIND_ADDRESS`](../reference/configuration.md) is `0.0.0.0`,
which includes loopback, and the `HOSTNAME` your platform sets to the container's
name has no effect on it. Any *specific* `BIND_ADDRESS` breaks something in a
container:

- A non-loopback address stops the server listening on `127.0.0.1`, so the image's
  `HEALTHCHECK` and any probe aimed at `127.0.0.1` or `localhost` fail with
  *connection refused*.
- A loopback address (`127.0.0.1`) leaves it unreachable from outside: published
  ports (`docker run -p`), load balancers and sidecars arrive on the container's
  own interface, not on loopback.

Leave it at the default in a container unless you know why you need otherwise.

### Naming your own build

Both values are fixed when the server is compiled, from two environment
variables read by `next build`:

| Variable | Default | Sets |
| --- | --- | --- |
| `APP_VERSION` | the `version` in `package.json` | The `version` in the health body, the dashboard footer, and the Environment page. Blank counts as unset. |
| `GIT_SHA` | `GITHUB_SHA`, else `unknown` | The `sha` in the same three places. The published image passes it as a Docker build-arg. |

That matters when you build this server from source into your own image: set
`APP_VERSION` to the tag you publish under, and the running server reports the
same string your registry, your deployment metadata, and your rollback tooling
use.

```bash
docker build --build-arg APP_VERSION=17.0 -t my-mocks:17.0 .
```

!!! warning "A derived image inherits the version it was built from"

    Setting `APP_VERSION` while building `FROM ghcr.io/bilal-fazlani/mock-server`
    does nothing: that base image was already compiled, so it keeps reporting the
    version it shipped with. Extending the published image gives you your own
    catalog, not your own version string — only a build from source can set one.

## Next steps

- Full environment-variable list → [Configuration](../reference/configuration.md).
- Add your own endpoint → [Your first mock endpoint](first-mock.md).
- Check a catalog without running it → [Validating a catalog](../building/validate.md).
- Drive a running server from tests → [Driving mocks](../driving/api.md).
