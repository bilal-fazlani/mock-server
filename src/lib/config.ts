import path from 'node:path'

export type UnmockedUsers = 'ERROR' | 'DEFAULT_MOCK' | 'REAL'
export type ConsoleLogLevel = 'info' | 'warn' | 'error'

// UI label for the implicit "real" scenario — never declared in the catalog,
// so its display name lives here.
export const REAL_LABEL = 'Passthrough'

export class ConfigError extends Error {}

const UNMOCKED_USERS_VALUES: UnmockedUsers[] = ['ERROR', 'DEFAULT_MOCK', 'REAL']
const CONSOLE_LOG_LEVEL_VALUES: ConsoleLogLevel[] = ['info', 'warn', 'error']

export function parsePassthroughAsDefault(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const upper = raw.toUpperCase()
  if (upper === 'TRUE') return true
  if (upper === 'FALSE') return false
  throw new ConfigError(
    `PASSTHROUGH_AS_DEFAULT must be either true or false, got "${raw}"`,
  )
}

export function parseUnmockedUsers(raw: string | undefined): UnmockedUsers {
  if (raw === undefined) return 'ERROR'
  const upper = raw.toUpperCase()
  if (!UNMOCKED_USERS_VALUES.includes(upper as UnmockedUsers)) {
    throw new ConfigError(
      `UNMOCKED_USERS must be one of ${UNMOCKED_USERS_VALUES.join(', ')}, got "${raw}"`,
    )
  }
  return upper as UnmockedUsers
}

export function parseConsoleLogLevel(raw: string | undefined): ConsoleLogLevel {
  if (raw === undefined) return 'info'
  const lower = raw.toLowerCase()
  if (!CONSOLE_LOG_LEVEL_VALUES.includes(lower as ConsoleLogLevel)) {
    throw new ConfigError(
      `MOCK_CONSOLE_LOG_LEVEL must be one of ${CONSOLE_LOG_LEVEL_VALUES.join(', ')}, got "${raw}"`,
    )
  }
  return lower as ConsoleLogLevel
}

export function parseDynamicHistoryLimit(raw: string | undefined): number {
  if (raw === undefined) return 10
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ConfigError(`DYNAMIC_HISTORY_LIMIT must be a positive integer, got "${raw}"`)
  }
  return n
}

// Resolve the catalog directory from CATALOG_PATH. A relative value is
// resolved against the current working directory; an absolute value is used
// as-is. Defaults to ./catalog. The npx launcher always passes an absolute
// path here (its own cwd differs from the user's), so this stays cwd-agnostic.
//
// The catalog directory lives outside this project entirely (it's supplied
// by the user at runtime), so its resolved path is never used to require or
// bundle repo-internal modules. Without the turbopackIgnore hint, Next's
// output-file-tracing sees a dynamic path.resolve() argument feeding into
// later fs reads and — unable to prove it's confined to a safe subfolder —
// falls back to sweeping the entire project into the standalone build
// (leaking src/, tests/, docs/, etc.). See the "Encountered unexpected file
// in NFT list" build warning this silences.
export function resolveCatalogDir(raw: string | undefined): string {
  return path.resolve(/*turbopackIgnore: true*/ raw ?? 'catalog')
}
