import { timingSafeEqual } from 'node:crypto'
import type { Catalog, SystemDef } from './catalog/types'

// A system listener forwards each request to the admin port under this first
// path segment, so Next's own routes (/ui, /_next, /) never see mocked traffic
// and every system request lands in the catch-all route.
export const SYSTEM_PATH_SEGMENT = '__mock-system__'
export const SYSTEM_TOKEN_HEADER = 'x-mock-server-system-token'
// Set by the process that opens the system listeners, read by the app; never user configuration.
export const SYSTEM_TOKEN_ENV = 'MOCK_SERVER_INTERNAL_SYSTEM_TOKEN'

export function systemPathPrefix(slug: string): string {
  return `/${SYSTEM_PATH_SEGMENT}/${encodeURIComponent(slug)}`
}

export function adminPortConflicts(catalog: Catalog, adminPort: number): string[] {
  return catalog.systems
    .filter((system) => system.port === adminPort)
    .map(
      (system) =>
        `system "${system.slug}": port ${system.port} is the admin port (PORT); give the system a different port`,
    )
}

export function isSystemToken(presented: string | undefined, expected: string | undefined): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Which system a catch-all request belongs to: the system named by the
 * reserved first segment, when the request carries this boot's token. Anything
 * else reached the admin port directly.
 */
export function resolveSystemRequest(
  catalog: Catalog,
  segments: string[],
  token: string | undefined,
  expectedToken: string | undefined,
): { system: SystemDef; segments: string[] } | null {
  if (segments[0] !== SYSTEM_PATH_SEGMENT || segments.length < 2) return null
  if (!isSystemToken(token, expectedToken)) return null
  const system = catalog.systems.find((s) => s.slug === segments[1])
  return system ? { system, segments: segments.slice(2) } : null
}

export function adminPortNotFoundBody(catalog: Catalog): Record<string, unknown> {
  return {
    error: 'not a mocked API port',
    message:
      "This port serves only the admin UI (/ui) and the control API (/ui/api). Each catalog system's mocked API is served on its own port.",
    systems: catalog.systems.map((system) => ({ slug: system.slug, port: system.port })),
  }
}
