# Validating a catalog

The catalog is checked in a single pass that reports **every** problem at once,
rather than stopping at the first. The server runs that pass at startup and
refuses to boot on any error, so restarting is always a valid check — but it
needs a port, a MongoDB, and a running process to tell you about a typo in a
fixture.

`mock-server validate` runs the same catalog checks and exits.

```bash
npx @bilal-fazlani/mock-server validate ./catalog
```

```text
Catalog validation passed.
```

The positional argument is the catalog directory (default `./catalog`, relative
to your current directory); it overrides the `CATALOG_PATH` environment
variable — the same precedence as serving. Nothing else about the environment is
read: no `.env` file is loaded, no MongoDB is contacted, no server starts, no
port is opened.

| Outcome | Exit code | Output |
| --- | --- | --- |
| Clean | `0` | `Catalog validation passed.` on stdout |
| Warnings only | `0` | Each warning as ` ! <message>` on stderr, then the pass line |
| Errors | `1` | `Catalog validation FAILED:` then one ` - <message>` per problem, on stderr |

Because it is exit-code driven and needs no services, it is the check to put in
front of anything that would otherwise discover a broken catalog late — a CI job,
or a container image build.

## What it checks

Everything that is a pure function of the files on disk:

- The **structural** walk of `catalog/` — systems, endpoints, metadata files,
  stray entries, scenario filenames.
- The **semantic** pass — path templates, selectors, placeholders, fixture bodies
  against `_schema.json`, overlapping paths.
- **Compilation** of every scenario resolver (`<slug>.mjs`) and every
  `_functions.mjs`, in the same sandbox the server uses.
- `_spec` **unmatched-operation warnings** — operations in a
  [system-level spec](schemas.md#system-level-_spec-file) that match no endpoint.

The full rule list is in
[Validation rules](../reference/configuration.md#validation-rules).

## What it deliberately does not check

**Environment configuration.** The startup gate additionally parses
`PASSTHROUGH_AS_DEFAULT` and, when it is `true`, requires every system's
`baseUrlEnv` to be set. `validate` skips both, because it is built to run where
upstream base URLs legitimately do not exist — a consumer's CI job, or a
`docker build` layer. Failing there would reject a perfectly good catalog edit
for a reason that has nothing to do with the edit.

!!! warning "A green validate is not a promise that the server will boot"

    With `PASSTHROUGH_AS_DEFAULT=true` and a system whose `baseUrlEnv` is unset,
    `validate` passes and startup still fails. That check belongs to the
    environment the server runs in, so it happens where that environment exists.
    Point a health check at `/ui/api/health` after deploy; see
    [Using it in dev & CI](../driving/dev-and-ci.md).

## Ways to validate

| Where you are | How | Also checks env config |
| --- | --- | --- |
| Any machine with Node.js 22+ | `npx @bilal-fazlani/mock-server validate ./catalog` | No |
| Building a derived image | `RUN mock-server validate` in your Dockerfile | No |
| Holding the published image | `docker run --rm -v "$(pwd)/catalog:/app/catalog:ro" ghcr.io/bilal-fazlani/mock-server:latest mock-server validate` | No |
| In a checkout of this repository | `npm run validate:catalog` | Yes |
| With no tooling at all | Start the server and watch it boot | Yes |

`npm run validate:catalog` is the one that also runs the environment pass: it
validates *this* repository's example catalog against *this* checkout's
environment, which is exactly the pairing startup would see. It is hardcoded to
`./catalog` and takes no argument — for anything else, use the subcommand.

## In CI

Gate catalog changes before anything is built or started. The step needs no
services and finishes in about a second:

```yaml
      - name: Validate the catalog
        run: npx @bilal-fazlani/mock-server validate ./catalog
```

A full workflow that then starts the server and drives it from tests is in
[Using it in dev & CI](../driving/dev-and-ci.md#continuous-integration).

## In a container image build

When you bake your catalog into a derived image, validate it in the same build.
A broken catalog then fails `docker build` — before an image exists to deploy:

```dockerfile
FROM ghcr.io/bilal-fazlani/mock-server:latest
COPY --chown=nextjs:nodejs catalog /app/catalog
RUN mock-server validate
```

`mock-server` is a small shim on the image's `PATH`; `mock-server validate`
resolves `./catalog` against the image's `WORKDIR` (`/app`), so the example above
needs no argument. See
[Install & run](../get-started/install.md#docker-extend-the-image-deployment) for
the two supported Docker patterns.
