# Mock Server

A data-driven HTTP mock server. You describe upstream endpoints as JSON files in a
`catalog/` tree — no request-handling code — and the server routes incoming requests
to canned responses. Which response a given caller gets is chosen per **profile**
(a business ID such as `customer-123`) and per **scenario** (a named outcome like
`default`, `frozen`, or `failure`), all editable from a built-in web UI. When a
scenario has to be *decided* rather than pinned, back it with a small JavaScript
resolver instead of a fixture. Any endpoint can also proxy through to a real
upstream (`real` passthrough).

Built with [Next.js](https://nextjs.org) and MongoDB.

## Quickstart

Requirements: **Node.js 22+**. MongoDB is optional — if `MONGODB_CONNECTION_STRING`
isn't set, an in-memory MongoDB starts automatically (data is ephemeral).

```bash
# via npx
npx @bilal-fazlani/mock-server ./catalog

# or via Docker
docker run --rm -p 3000:3000 ghcr.io/bilal-fazlani/mock-server:latest

# check a catalog without starting anything (exit 0 clean, 1 on any error)
npx @bilal-fazlani/mock-server validate ./catalog
```

Mock endpoints answer at the **root** — an endpoint whose catalog `path` is
`/hello/world` responds at `http://localhost:3000/hello/world`; the management UI
is at `http://localhost:3000/ui`. The repo ships an example system
(`catalog/hello-system/`) to call and edit:

```bash
curl -s -X POST http://localhost:3000/hello/world \
  -H 'content-type: application/json' \
  -d '{"customerId":"customer-123"}'
```

Full install (npx options, Docker, from-source), CI usage, the runtime-control
API, and every environment variable are documented in the
**[guide](docs/site/)** — see [Documentation](#documentation) to run it locally.

## Scripts

```bash
npm run dev               # start the dev server
npm run build             # production build
npm start                 # run the production build
npm test                  # run the test suite (Vitest)
npm run lint              # lint
npm run validate:catalog  # validate this repo's catalog the way startup does
```

`validate:catalog` is the source-checkout twin of `mock-server validate`: it adds
the environment-config pass the shipped subcommand omits. See
[Validating a catalog](docs/site/docs/building/validate.md).

## Documentation

The full guide lives under [`docs/site/`](docs/site/) (built with
[Zensical](https://zensical.org)) and is the canonical source for install, Docker,
CI, configuration, and every framework feature. It's organized into **Building
mocks** (authoring the catalog) and **Driving mocks** (controlling a running
server from the UI or the runtime-control API). Run it locally:

```bash
cd docs/site
python3 -m venv .venv && .venv/bin/pip install zensical
.venv/bin/zensical serve
```

Start with `docs/site/docs/index.md` for the mental model, or
`docs/site/docs/get-started/install.md` to install and run.
