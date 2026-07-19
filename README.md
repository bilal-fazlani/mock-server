# Mock Server

A data-driven HTTP mock server. You describe upstream endpoints as JSON files in a
`catalog/` tree — no request-handling code — and the server routes incoming requests
to canned responses. Which response a given caller gets is chosen per **profile**
(a business ID such as `customer-123`) and per **scenario** (a named outcome like
`default`, `frozen`, or `failure`), all editable from a built-in web UI. When a
scenario has to be *decided* rather than pinned, back it with a small TypeScript
resolver instead of a fixture. Any endpoint can also proxy through to a real
upstream (`real` passthrough).

Built with [Next.js](https://nextjs.org) and MongoDB.

## Features

- **Catalog-as-data** — add endpoints by creating directories and JSON files; the
  engine loads them at startup.
- **Profiles & scenarios** — pick, per caller, which scenario each endpoint returns;
  picks can be ordered sequences served call-by-call.
- **Profile-ID selectors** — resolve the caller from the request body, path, query,
  or a Bearer token/JWT claim.
- **Code-backed resolvers** — back a scenario with a `<scenario>.ts` file: a pure,
  synchronous function that reads the request plus a bounded history of what it
  returned before, and picks which fixture-backed scenario (or `real`) answers this
  call. Models request-driven branching and multi-call flows like "pending twice,
  then success" without touching any profile.
- **Placeholders** — echo request values and timestamps into responses.
- **Schema validation** — optional per-endpoint request/response JSON Schema checks.
- **`real` passthrough** — proxy any endpoint to its configured live upstream.
- **Request logs** — every request captured with a full decision trace, browsable in
  the UI.

## Quickstart

Requirements: **Node.js 22+**. MongoDB is optional — if `MONGODB_CONNECTION_STRING`
isn't set, an in-memory MongoDB starts automatically (data is ephemeral).

```bash
# via npx
npx @bilal-fazlani/mock-server ./catalog

# or via Docker
docker run --rm -p 3000:3000 ghcr.io/bilal-fazlani/mock-server:latest
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
npm run validate:catalog  # validate the catalog the way startup does
```

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
