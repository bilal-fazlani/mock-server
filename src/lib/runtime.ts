import fs from 'node:fs'
import { loadCatalog } from './catalog/load'
import { schemaKey, type SchemaRegistry } from './catalog/schema'
import type { Catalog } from './catalog/types'
import { validateAppConfig, validateCatalog } from './catalog/validate'
import {
  parseConsoleLogLevel,
  parseDynamicHistoryLimit,
  parsePassthroughAsDefault,
  parseUnmockedUsers,
  resolveCatalogDir,
  type ConsoleLogLevel,
  type UnmockedUsers,
} from './config'
import { fixtureFilePath, FixtureError, loadFixture, type Fixture } from './mock-engine/fixtures'
import {
  compileResolver,
  dynamicFilePath,
  type CompiledResolver,
} from './mock-engine/resolver'

export interface Runtime {
  catalog: Catalog
  catalogDir: string
  passthroughAsDefault: boolean
  unmockedUsers: UnmockedUsers
  consoleLogLevel: ConsoleLogLevel
  timeoutMs: number
  schemas: SchemaRegistry
  dynamicHistoryLimit: number
  loadFixture: (systemSlug: string, endpointName: string, scenario: string) => Fixture
  getCompiledResolver: (systemSlug: string, endpointName: string) => CompiledResolver | null
}

let runtime: Runtime | null = null

// Compiles every endpoint's _dynamic.ts at startup, aggregating failures so
// they fold into the same fail-fast error list as catalog/config problems —
// a broken resolver means the server won't boot.
export function compileResolvers(
  catalog: Catalog,
  catalogDir: string,
): { resolvers: Map<string, CompiledResolver>; errors: string[] } {
  const resolvers = new Map<string, CompiledResolver>()
  const errors: string[] = []
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      if (!endpoint.hasResolver) continue
      const label = `${system.slug}/${endpoint.name}`
      try {
        const source = fs.readFileSync(
          dynamicFilePath(catalogDir, system.slug, endpoint.name),
          'utf8',
        )
        resolvers.set(schemaKey(system.slug, endpoint.name), compileResolver(source, label))
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }
  }
  return { resolvers, errors }
}

// Dev-mode counterpart to compileResolvers: re-reads and re-compiles a single
// endpoint's _dynamic.ts per call so edits apply live. A compile error here
// surfaces as a request-time 500 rather than a startup failure.
function devCompileResolver(
  catalog: Catalog,
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
): CompiledResolver | null {
  const endpoint = catalog.systems
    .find((s) => s.slug === systemSlug)
    ?.endpoints.find((e) => e.name === endpointName)
  if (!endpoint?.hasResolver) return null
  const source = fs.readFileSync(dynamicFilePath(catalogDir, systemSlug, endpointName), 'utf8')
  return compileResolver(source, `${systemSlug}/${endpointName}`)
}

// Startup validation gate: the first request (or page render) that touches
// the runtime fails hard if catalog, fixtures, and app config are out of sync.
export function getRuntime(): Runtime {
  if (runtime) return runtime
  const passthroughAsDefault = parsePassthroughAsDefault(process.env.PASSTHROUGH_AS_DEFAULT)
  const unmockedUsers = parseUnmockedUsers(process.env.UNMOCKED_USERS)
  const consoleLogLevel = parseConsoleLogLevel(process.env.MOCK_CONSOLE_LOG_LEVEL)
  const dynamicHistoryLimit = parseDynamicHistoryLimit(process.env.DYNAMIC_HISTORY_LIMIT)

  const catalogDir = resolveCatalogDir(process.env.CATALOG_PATH)
  const catalog = loadCatalog(catalogDir)
  const { errors: catalogErrors, fixtures, schemas } = validateCatalog(catalog, catalogDir)
  const configErrors = validateAppConfig(catalog, process.env, passthroughAsDefault)
  const { resolvers, errors: resolverErrors } = compileResolvers(catalog, catalogDir)
  const errors = [...catalogErrors, ...configErrors, ...resolverErrors]
  if (errors.length > 0) {
    throw new Error(`catalog validation failed:\n - ${errors.join('\n - ')}`)
  }

  // Fixtures are re-read from disk per request in development so edits apply
  // live; in production they're served from the cache built during startup
  // validation, so a file deleted or corrupted after startup can't 500 a request.
  const isDev = process.env.NODE_ENV !== 'production'
  runtime = {
    catalog,
    catalogDir,
    passthroughAsDefault,
    unmockedUsers,
    consoleLogLevel,
    timeoutMs: Number(process.env.PASSTHROUGH_TIMEOUT_MS ?? 30000),
    schemas,
    dynamicHistoryLimit,
    loadFixture: isDev
      ? (systemSlug, endpointName, scenario) =>
          loadFixture(catalogDir, systemSlug, endpointName, scenario)
      : (systemSlug, endpointName, scenario) => {
          const file = fixtureFilePath(catalogDir, systemSlug, endpointName, scenario)
          const cached = fixtures.get(file)
          if (!cached) throw new FixtureError(`fixture not found: ${file}`)
          return cached
        },
    getCompiledResolver: isDev
      ? (systemSlug, endpointName) => devCompileResolver(catalog, catalogDir, systemSlug, endpointName)
      : (systemSlug, endpointName) => resolvers.get(schemaKey(systemSlug, endpointName)) ?? null,
  }
  return runtime
}
