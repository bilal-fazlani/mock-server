import path from 'node:path'
import { loadCatalog } from './catalog/load'
import type { SchemaRegistry } from './catalog/schema'
import type { Catalog } from './catalog/types'
import { validateAppConfig, validateCatalog } from './catalog/validate'
import {
  parseConsoleLogLevel,
  parsePassthroughAsDefault,
  parseUnmockedUsers,
  type ConsoleLogLevel,
  type UnmockedUsers,
} from './config'
import { fixtureFilePath, FixtureError, loadFixture, type Fixture } from './mock-engine/fixtures'

export interface Runtime {
  catalog: Catalog
  catalogDir: string
  passthroughAsDefault: boolean
  unmockedUsers: UnmockedUsers
  consoleLogLevel: ConsoleLogLevel
  timeoutMs: number
  schemas: SchemaRegistry
  loadFixture: (systemSlug: string, endpointName: string, scenario: string) => Fixture
}

let runtime: Runtime | null = null

// Startup validation gate: the first request (or page render) that touches
// the runtime fails hard if catalog, fixtures, and app config are out of sync.
export function getRuntime(): Runtime {
  if (runtime) return runtime
  const passthroughAsDefault = parsePassthroughAsDefault(process.env.PASSTHROUGH_AS_DEFAULT)
  const unmockedUsers = parseUnmockedUsers(process.env.UNMOCKED_USERS)
  const consoleLogLevel = parseConsoleLogLevel(process.env.MOCK_CONSOLE_LOG_LEVEL)

  const root = process.cwd()
  const catalogDir = path.join(root, 'catalog')
  const catalog = loadCatalog(catalogDir)
  const { errors: catalogErrors, fixtures, schemas } = validateCatalog(catalog, catalogDir)
  const configErrors = validateAppConfig(catalog, process.env, passthroughAsDefault)
  const errors = [...catalogErrors, ...configErrors]
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
    loadFixture: isDev
      ? (systemSlug, endpointName, scenario) =>
          loadFixture(catalogDir, systemSlug, endpointName, scenario)
      : (systemSlug, endpointName, scenario) => {
          const file = fixtureFilePath(catalogDir, systemSlug, endpointName, scenario)
          const cached = fixtures.get(file)
          if (!cached) throw new FixtureError(`fixture not found: ${file}`)
          return cached
        },
  }
  return runtime
}
