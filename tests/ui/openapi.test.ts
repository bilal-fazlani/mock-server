import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GET } from '../../src/app/ui/api/openapi.json/route'

// The runtime-control API's contract is hand-written at
// src/lib/control-api/openapi.json and served at GET /ui/api/openapi.json.
// Nothing generates it from the handlers, so a new route — or a route that grew
// a method — would otherwise ship with no spec entry and nothing would fail.
// These tests walk src/app/ui/api/** and hold the two surfaces in step both
// ways: every route+method has an operation, and every documented operation
// still exists in the tree. They deliberately do NOT check field-level accuracy;
// that stays a review concern (see AGENTS.md).
const API_DIR = path.join(__dirname, '..', '..', 'src', 'app', 'ui', 'api')

// Covers every way a handler is exported today and the shapes it plausibly
// grows into: `export function GET(`, `export async function GET<T>(`,
// `export const GET = async (…) =>`, and `export const GET = handler`. The
// trailing \b stops `GETTER` and `DELETE_ME` from matching. An aliased
// re-export (`export { handler as GET }`) is deliberately out of scope — no
// route uses that shape, and catching it would mean parsing, not scanning.
const METHOD_EXPORT_RE =
  /export\s+(?:const\s+|(?:async\s+)?function\s+)(GET|PUT|POST|PATCH|DELETE|HEAD|OPTIONS)\b/g

interface RouteFile {
  /** OpenAPI path, e.g. `/ui/api/profiles/{profileId}`. */
  apiPath: string
  /** Lowercased HTTP methods the handler exports. */
  methods: string[]
}

function routeFilesUnder(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...routeFilesUnder(full))
    else if (entry.name === 'route.ts') files.push(full)
  }
  return files
}

function toRouteFile(file: string): RouteFile {
  // `src/app/ui/api/profiles/[profileId]/route.ts` → `/ui/api/profiles/{profileId}`.
  const segments = path.relative(API_DIR, path.dirname(file)).split(path.sep).filter(Boolean)
  const apiPath = ['/ui/api', ...segments.map((s) => s.replace(/^\[(.+)\]$/, '{$1}'))].join('/')
  const source = fs.readFileSync(file, 'utf8')
  const methods = [...source.matchAll(METHOD_EXPORT_RE)].map(([, method]) => method.toLowerCase())
  return { apiPath, methods }
}

const routes = routeFilesUnder(API_DIR).map(toRouteFile)

describe('GET /ui/api/openapi.json', () => {
  it('serves the document as JSON', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
    expect(JSON.parse(await response.text())).toBeTypeOf('object')
  })

  it('serves an OpenAPI 3.1 document with its own contract version', async () => {
    const doc = await (await GET()).json()
    expect(doc.openapi).toMatch(/^3\.1(\.|$)/)
    // Versions the contract, not the build — /ui/api/health reports the build.
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(doc.info.title).toBeTypeOf('string')
  })
})

describe('the spec covers every /ui/api route', () => {
  // Guards the walk itself: a mapping bug that found nothing would otherwise
  // make every it.each below vacuously pass.
  it('finds the route handlers', () => {
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.flatMap((r) => r.methods).length).toBeGreaterThan(routes.length)
  })

  it.each(routes.map((r) => [r.apiPath, r]))('%s is documented', async (_path, route) => {
    const doc = await (await GET()).json()
    expect(Object.keys(doc.paths)).toContain(route.apiPath)
    expect(route.methods.length).toBeGreaterThan(0)
    expect(Object.keys(doc.paths[route.apiPath]).sort()).toEqual([...route.methods].sort())
  })

  it('documents no path that has no route handler', async () => {
    const doc = await (await GET()).json()
    expect(Object.keys(doc.paths).sort()).toEqual(routes.map((r) => r.apiPath).sort())
  })
})
