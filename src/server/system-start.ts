import { randomBytes } from 'node:crypto'
import { loadCatalog } from '../lib/catalog/load'
import { parseAdminPort, parseConsoleLogLevel, parseLogFormat, resolveCatalogDir, type ConsoleLogLevel, type LogFormat } from '../lib/config'
import { writeConsoleLog } from '../lib/logs/console'
import { adminPortConflicts, SYSTEM_TOKEN_ENV } from '../lib/system-ports'
import { loopbackFor, startSystemListeners } from './system-listeners'

export class SystemStartError extends Error {}

/**
 * Reads the catalog's system ports, opens a listener for each and writes this
 * boot's token into `env` for the app to check. Every failure — a bad PORT, a
 * catalog that won't load, a port clash or a port that can't be bound — comes
 * back as a `SystemStartError`.
 */
export async function prepareSystemListeners(
  env: Record<string, string | undefined>,
  bindAddress: string,
): Promise<void> {
  let adminPort: number
  let systems: { slug: string; port: number }[]
  let level: ConsoleLogLevel
  let format: LogFormat
  try {
    adminPort = parseAdminPort(env.PORT)
    level = parseConsoleLogLevel(env.MOCK_CONSOLE_LOG_LEVEL)
    format = parseLogFormat(env.MOCK_LOG_FORMAT)
    const catalogDir = resolveCatalogDir(env.CATALOG_PATH)
    const catalog = loadCatalog(catalogDir)
    // Next's server.js changes directory, so the app must not re-resolve a relative path.
    env.CATALOG_PATH = catalogDir
    const conflicts = adminPortConflicts(catalog, adminPort)
    if (conflicts.length > 0) throw new Error(conflicts.join('\n - '))
    systems = catalog.systems.map(({ slug, port }) => ({ slug, port }))
  } catch (err) {
    throw new SystemStartError(err instanceof Error ? err.message : String(err))
  }

  const token = randomBytes(32).toString('hex')
  env[SYSTEM_TOKEN_ENV] = token
  try {
    await startSystemListeners({
      systems,
      bindAddress,
      target: { host: loopbackFor(bindAddress), port: adminPort },
      token,
    })
  } catch (err) {
    throw new SystemStartError(err instanceof Error ? err.message : String(err))
  }

  const host = bindAddress.includes(':') ? `[${bindAddress}]` : bindAddress
  writeConsoleLog('info', `mock-server: admin UI and control API on http://${host}:${adminPort}/`, {
    level,
    format,
    fields: { 'event.action': 'admin_listening', 'server.port': adminPort },
  })
  for (const system of systems) {
    writeConsoleLog('info', `mock-server: system ${system.slug} on http://${host}:${system.port}`, {
      level,
      format,
      fields: { 'event.action': 'system_listening', 'mock.system': system.slug, 'server.port': system.port },
    })
  }
}
