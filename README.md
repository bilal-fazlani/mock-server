# Mock Server

A data-driven HTTP mock server. You describe upstream endpoints as JSON files in a
`catalog/` tree — no request-handling code — and the server routes incoming requests
to canned responses. Which response a given caller gets is chosen per **profile**
(a business ID such as `customer-123`) and per **scenario** (a named outcome like
`default`, `frozen`, or `failure`), all editable from a built-in web UI. Any endpoint
can also proxy through to a real upstream (`real` passthrough).

Built with [Next.js](https://nextjs.org) and MongoDB.

## Features

- **Catalog-as-data** — add endpoints by creating directories and JSON files; the
  engine loads them at startup.
- **Profiles & scenarios** — pick, per caller, which scenario each endpoint returns;
  picks can be ordered sequences served call-by-call.
- **Profile-ID selectors** — resolve the caller from the request body, path, query,
  or a Bearer token/JWT claim.
- **Placeholders** — echo request values and timestamps into responses.
- **Schema validation** — optional per-endpoint request/response JSON Schema checks.
- **`real` passthrough** — proxy any endpoint to its configured live upstream.
- **Request logs** — every request captured with a full decision trace, browsable in
  the UI.

## Getting started

Requirements: Node.js 20+ and a MongoDB instance.

```bash
npm install
cp .env.example .env.local   # then edit as needed
npm run dev
```

- Mock endpoints are served at the **root** of the origin — an endpoint whose catalog
  `path` is `/hello/world` answers at `http://localhost:3000/hello/world`.
- The management UI lives under `http://localhost:3000/ui`.

The repository ships a small example system (`catalog/hello-system/`) with a couple of
endpoints so you have something to call and edit. Try it:

```bash
curl -s -X POST http://localhost:3000/hello/world \
  -H 'content-type: application/json' \
  -d '{"customerId":"customer-123"}'
```

## Running via Docker

Published images live in the GitHub Container Registry at
[`ghcr.io/bilal-fazlani/mock-server`](https://github.com/bilal-fazlani/mock-server/pkgs/container/mock-server)
(multi-arch: `linux/amd64` and `linux/arm64`). Use `latest`, a pinned version tag like
`1.2.0`, or `edge` for the current `main`.

```bash
docker run --rm -p 3000:3000 \
  -e MONGODB_CONNECTION_STRING='mongodb://host.docker.internal:27017' \
  ghcr.io/bilal-fazlani/mock-server:latest
```

The server listens on port `3000`; mocks answer at the root and the UI at `/ui`, exactly
as with the dev server. It needs a reachable MongoDB — pass its URI via
`MONGODB_CONNECTION_STRING` (plus any other variables from the table below).

The image bakes in the example `catalog/` tree. To serve your own catalog without
rebuilding, mount it over the baked-in one:

```bash
docker run --rm -p 3000:3000 \
  -e MONGODB_CONNECTION_STRING='mongodb://host.docker.internal:27017' \
  -v "$(pwd)/catalog:/app/catalog:ro" \
  ghcr.io/bilal-fazlani/mock-server:latest
```

## Configuration

Environment variables (see `.env.example` for the full list):

| Variable | Purpose |
| --- | --- |
| `MONGODB_CONNECTION_STRING` | MongoDB URI for profiles, global mocks, mappings, and logs. |
| `MONGODB_DB` | Database name (default `mockDB`). |
| `PASSTHROUGH_AS_DEFAULT` | Whether `real` is the implicit scenario. |
| `UNMOCKED_USERS` | Fallback for unknown profile IDs (`ERROR` / `DEFAULT_MOCK` / `REAL`). |
| `MOCK_CONSOLE_LOG_LEVEL` | Console request-log threshold. |
| `PASSTHROUGH_TIMEOUT_MS` | Timeout for `real` upstream requests. |
| `<SYSTEM>_URL` | Real upstream base URL per system (e.g. `HELLO_SYSTEM_URL`). |

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

A full guide to authoring the catalog and every framework feature lives under
[`docs/site/`](docs/site/) (built with [Zensical](https://zensical.org)):

```bash
cd docs/site
python3 -m venv .venv && .venv/bin/pip install zensical
.venv/bin/zensical serve
```

Start with `docs/site/docs/index.md` for the mental model and the getting-started
walkthrough.
