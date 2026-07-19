import fs from 'node:fs'
import { loadCatalog } from './catalog/load'
import { type SchemaRegistry } from './catalog/schema'
import type { Catalog } from './catalog/types'
import { validateAppConfig, validateCatalog } from './catalog/validate'
import {
  parseConsoleLogLevel,
  parsePassthroughAsDefault,
  parseRequestLogTtlSeconds,
  parseResolverHistoryLimit,
  parseUnmockedUsers,
  resolveCatalogDir,
  type ConsoleLogLevel,
  type UnmockedUsers,
} from './config'
import { fixtureFilePath, FixtureError, loadFixture, type Fixture } from './mock-engine/fixtures'
import {
  compileResolver,
  resolverFilePath,
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
  resolverHistoryLimit: number
  loadFixture: (systemSlug: string, endpointName: string, scenario: string) => Fixture
  getCompiledResolver: (
    systemSlug: string,
    endpointName: string,
    slug: string,
  ) => CompiledResolver | null
}

let runtime: Runtime | null = null

function resolverKey(systemSlug: string, endpointName: string, slug: string): string {
  return `${systemSlug}/${endpointName}/${slug}`
}

// Compiles every endpoint's <slug>.mjs resolvers at startup, aggregating
// failures into the same fail-fast error list as catalog/config problems.
// Also patches each resolver-backed scenario's UI label and summary from the
// compiled module's optional `description`/`summary` exports (label = slug
// otherwise).
export function compileResolvers(
  catalog: Catalog,
  catalogDir: string,
): { resolvers: Map<string, CompiledResolver>; errors: string[] } {
  const resolvers = new Map<string, CompiledResolver>()
  const errors: string[] = []
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      for (const slug of endpoint.resolverScenarios) {
        const label = `${system.slug}/${endpoint.name}/${slug}.mjs`
        try {
          const source = fs.readFileSync(
            resolverFilePath(catalogDir, system.slug, endpoint.name, slug),
            'utf8',
          )
          const compiled = compileResolver(source, label)
          resolvers.set(resolverKey(system.slug, endpoint.name, slug), compiled)
          const meta = (endpoint.scenarios[slug] ??= { label: slug })
          if (compiled.description) meta.label = compiled.description
          if (compiled.summary) meta.summary = compiled.summary
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err))
        }
      }
    }
  }
  return { resolvers, errors }
}

// Dev-mode counterpart to compileResolvers: re-reads and re-compiles a single
// endpoint's <slug>.mjs per call so edits apply live. A compile error here
// surfaces as a request-time 500 rather than a startup failure.
function devCompileResolver(
  catalog: Catalog,
  catalogDir: string,
  systemSlug: string,
  endpointName: string,
  slug: string,
): CompiledResolver | null {
  const endpoint = catalog.systems
    .find((s) => s.slug === systemSlug)
    ?.endpoints.find((e) => e.name === endpointName)
  if (!endpoint?.resolverScenarios.includes(slug)) return null
  const source = fs.readFileSync(resolverFilePath(catalogDir, systemSlug, endpointName, slug), 'utf8')
  return compileResolver(source, `${systemSlug}/${endpointName}/${slug}.mjs`)
}

// Startup validation gate: the first request (or page render) that touches
// the runtime fails hard if catalog, fixtures, and app config are out of sync.
export function getRuntime(): Runtime {
  if (runtime) return runtime
  const passthroughAsDefault = parsePassthroughAsDefault(process.env.PASSTHROUGH_AS_DEFAULT)
  const unmockedUsers = parseUnmockedUsers(process.env.UNMOCKED_USERS)
  const consoleLogLevel = parseConsoleLogLevel(process.env.MOCK_CONSOLE_LOG_LEVEL)
  const resolverHistoryLimit = parseResolverHistoryLimit(process.env.RESOLVER_HISTORY_LIMIT)
  // Validate REQUEST_LOG_TTL_DURATION at the same startup gate as the other
  // config; the value itself is re-parsed by ensureIndexes (which runs on first
  // DB connect, independent of the runtime), so we discard it here.
  parseRequestLogTtlSeconds(process.env.REQUEST_LOG_TTL_DURATION)

  const catalogDir = resolveCatalogDir(process.env.CATALOG_PATH)
  const catalog = loadCatalog(catalogDir)
  for (const warning of catalog.warnings ?? []) {
    console.warn(`catalog warning: ${warning}`)
  }
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
    resolverHistoryLimit,
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
      ? (systemSlug, endpointName, slug) =>
          devCompileResolver(catalog, catalogDir, systemSlug, endpointName, slug)
      : (systemSlug, endpointName, slug) =>
          resolvers.get(resolverKey(systemSlug, endpointName, slug)) ?? null,
  }
  return runtime
}
