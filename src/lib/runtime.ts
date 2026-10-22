import fs from 'node:fs'
import { loadCatalog } from './catalog/load'
import { type SchemaRegistry } from './catalog/schema'
import type { Catalog } from './catalog/types'
import { validateAppConfig, validateCatalog } from './catalog/validate'
import {
  parseBindAddress,
  parseConsoleLogLevel,
  parseLogFormat,
  parsePassthroughAsDefault,
  parseRequestLogTtlSeconds,
  parseResolverHistoryLimit,
  parseProfileApiTtl,
  parseProfileKeyTtlSeconds,
  parseResolverHistoryTtlSeconds,
  parseUnmockedUsers,
  resolveCatalogDir,
  type ConsoleLogLevel,
  type LogFormat,
  type UnmockedUsers,
} from './config'
import { writeConsoleLog } from './logs/console'
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
  logFormat: LogFormat
  timeoutMs: number
  schemas: SchemaRegistry
  resolverHistoryLimit: number
  resolverHistoryTtlSeconds: number
  profileKeyTtlSeconds: number
  /** PROFILE_API_TTL_DURATION as given; null when `off`. */
  profileApiTtl: string | null
  loadFixture: (systemSlug: string, endpointSlug: string, scenario: string) => Fixture
  getCompiledResolver: (
    systemSlug: string,
    endpointSlug: string,
    slug: string,
  ) => CompiledResolver | null
}

// Production shares one runtime across bundles via globalThis; dev keeps it per module so hot reloads rebuild it.
const globalScope = globalThis as typeof globalThis & { __mockServerRuntime?: Runtime }
let moduleRuntime: Runtime | null = null
const isProduction = () => process.env.NODE_ENV === 'production'

function resolverKey(systemSlug: string, endpointSlug: string, slug: string): string {
  return `${systemSlug}/${endpointSlug}/${slug}`
}

// Compiles every endpoint's <slug>.mjs resolvers at startup, aggregating
// failures into the same fail-fast error list as catalog/config problems.
// Also patches each resolver-backed scenario's UI name and summary from the
// compiled module's optional `displayName`/`summary` exports (displayName = slug
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
        const label = `${system.slug}/${endpoint.slug}/${slug}.mjs`
        try {
          const source = fs.readFileSync(
            resolverFilePath(catalogDir, system.slug, endpoint.slug, slug),
            'utf8',
          )
          const compiled = compileResolver(source, label)
          resolvers.set(resolverKey(system.slug, endpoint.slug, slug), compiled)
          const meta = (endpoint.scenarios[slug] ??= { displayName: slug })
          if (compiled.displayName) meta.displayName = compiled.displayName
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
  endpointSlug: string,
  slug: string,
): CompiledResolver | null {
  const endpoint = catalog.systems
    .find((s) => s.slug === systemSlug)
    ?.endpoints.find((e) => e.slug === endpointSlug)
  if (!endpoint?.resolverScenarios.includes(slug)) return null
  const source = fs.readFileSync(resolverFilePath(catalogDir, systemSlug, endpointSlug, slug), 'utf8')
  return compileResolver(source, `${systemSlug}/${endpointSlug}/${slug}.mjs`)
}

// Startup validation gate: the server builds this at boot (instrumentation.ts)
// and fails hard if catalog, fixtures, and app config are out of sync.
export function getRuntime(): Runtime {
  const cached = isProduction() ? globalScope.__mockServerRuntime : moduleRuntime
  if (cached) return cached
  // The listen address was already enforced before the server started (see
  // src/server/serve-main.ts); checked here too so `next dev` and any other
  // path that skips that entry point fails the same way.
  parseBindAddress(process.env.BIND_ADDRESS)
  const passthroughAsDefault = parsePassthroughAsDefault(process.env.PASSTHROUGH_AS_DEFAULT)
  const unmockedUsers = parseUnmockedUsers(process.env.UNMOCKED_USERS)
  const consoleLogLevel = parseConsoleLogLevel(process.env.MOCK_CONSOLE_LOG_LEVEL)
  const logFormat = parseLogFormat(process.env.MOCK_LOG_FORMAT)
  const resolverHistoryLimit = parseResolverHistoryLimit(process.env.RESOLVER_HISTORY_LIMIT)
  const resolverHistoryTtlSeconds = parseResolverHistoryTtlSeconds(
    process.env.RESOLVER_HISTORY_TTL_DURATION,
  )
  const profileKeyTtlSeconds = parseProfileKeyTtlSeconds(process.env.PROFILE_KEY_TTL_DURATION)
  const profileApiTtl = parseProfileApiTtl(process.env.PROFILE_API_TTL_DURATION)
  // Validate REQUEST_LOG_TTL_DURATION at the same startup gate as the other
  // config; the value itself is re-parsed by ensureIndexes (which runs on first
  // DB connect, independent of the runtime), so we discard it here.
  parseRequestLogTtlSeconds(process.env.REQUEST_LOG_TTL_DURATION)

  const catalogDir = resolveCatalogDir(process.env.CATALOG_PATH)
  const catalog = loadCatalog(catalogDir)
  for (const warning of catalog.warnings ?? []) {
    writeConsoleLog('warn', `catalog warning: ${warning}`, {
      level: consoleLogLevel,
      format: logFormat,
      fields: { 'event.action': 'catalog_warning' },
    })
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
  const built: Runtime = {
    catalog,
    catalogDir,
    passthroughAsDefault,
    unmockedUsers,
    consoleLogLevel,
    logFormat,
    timeoutMs: Number(process.env.PASSTHROUGH_TIMEOUT_MS ?? 30000),
    schemas,
    resolverHistoryLimit,
    resolverHistoryTtlSeconds,
    profileKeyTtlSeconds,
    profileApiTtl,
    loadFixture: isDev
      ? (systemSlug, endpointSlug, scenario) =>
          loadFixture(catalogDir, systemSlug, endpointSlug, scenario)
      : (systemSlug, endpointSlug, scenario) => {
          const file = fixtureFilePath(catalogDir, systemSlug, endpointSlug, scenario)
          const cached = fixtures.get(file)
          if (!cached) throw new FixtureError(`fixture not found: ${file}`)
          return cached
        },
    getCompiledResolver: isDev
      ? (systemSlug, endpointSlug, slug) =>
          devCompileResolver(catalog, catalogDir, systemSlug, endpointSlug, slug)
      : (systemSlug, endpointSlug, slug) =>
          resolvers.get(resolverKey(systemSlug, endpointSlug, slug)) ?? null,
  }
  if (isProduction()) globalScope.__mockServerRuntime = built
  else moduleRuntime = built
  return built
}
