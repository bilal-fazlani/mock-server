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

export function parseResolverHistoryLimit(raw: string | undefined): number {
  if (raw === undefined) return 10
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new ConfigError(`RESOLVER_HISTORY_LIMIT must be a positive integer, got "${raw}"`)
  }
  return n
}

const TTL_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

// Shared grammar for the TTL-duration env vars: <positive-integer><unit> where
// unit is s|m|h|d (e.g. "30m", "24h", "7d"). Unset/empty falls back to
// `fallbackSeconds`. Anything else — missing unit, unsupported unit, zero,
// non-integer, or compound like "1d12h" — is a startup-fatal ConfigError.
function parseTtlSeconds(name: string, raw: string | undefined, fallbackSeconds: number): number {
  if (raw === undefined || raw === '') return fallbackSeconds
  const match = /^(\d+)(s|m|h|d)$/.exec(raw)
  if (!match) {
    throw new ConfigError(
      `${name} must be a positive duration like "24h", "30m", or "7d" (units s|m|h|d), got "${raw}"`,
    )
  }
  const count = Number(match[1])
  if (count < 1) {
    throw new ConfigError(`${name} must be greater than zero, got "${raw}"`)
  }
  return count * TTL_UNIT_SECONDS[match[2]]
}

// Parse REQUEST_LOG_TTL_DURATION into seconds for the requestLogs TTL index.
// Unset/empty defaults to one day, matching the pre-config behavior.
export function parseRequestLogTtlSeconds(raw: string | undefined): number {
  return parseTtlSeconds('REQUEST_LOG_TTL_DURATION', raw, 86400)
}

// Parse RESOLVER_HISTORY_TTL_DURATION into seconds. This bounds ONLY the
// resolver-history windows of owner-less callers — a profile ID that resolved
// from the request but has no profile document (UNMOCKED_USERS=DEFAULT_MOCK on
// a resolver-backed scenario). Those keys are minted from arbitrary caller
// input and no owner deletion ever cleans them up. History belonging to a real
// profile or a global-mock selection carries no expiry and is kept
// indefinitely; see src/lib/dynamic/history-store.ts.
export function parseResolverHistoryTtlSeconds(raw: string | undefined): number {
  return parseTtlSeconds('RESOLVER_HISTORY_TTL_DURATION', raw, 86400)
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
