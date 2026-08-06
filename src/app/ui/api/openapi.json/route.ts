import openapi from '../../../../lib/control-api/openapi.json'

export const dynamic = 'force-dynamic'

/**
 * Serves the runtime-control API's own contract.
 *
 * The document is hand-maintained at `src/lib/control-api/openapi.json` and
 * imported rather than read from disk: a file under `public/` would be served at
 * the root path, where mock endpoints live, and would shadow any mocked route
 * that happened to share its name. It carries its own `info.version`, which
 * versions the contract and not the build — `GET /ui/api/health` reports the
 * build's version and SHA.
 *
 * `force-dynamic` is the /ui convention (#32, #46) rather than a caching need:
 * this body is a build constant, but every /ui route declares its intent.
 */
export async function GET(): Promise<Response> {
  return Response.json(openapi)
}
