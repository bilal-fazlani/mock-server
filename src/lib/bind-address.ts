import net from 'node:net'

// The address the shipped server listens on. Pure and dependency-free on
// purpose: src/server/serve-main.ts is bundled on its own into serve.cjs and
// must stay tiny, and it needs the same parsing as the startup gate in
// runtime.ts. One module, so the two cannot disagree about what is valid.

export const DEFAULT_BIND_ADDRESS = '0.0.0.0'

export class BindAddressError extends Error {}

/**
 * Resolves `BIND_ADDRESS`. Unset or empty means the default (all IPv4
 * interfaces). Anything else must be an IP literal — IPv4 or IPv6. A hostname is
 * rejected rather than resolved: a name goes through DNS, and a platform-assigned
 * name resolving to only the container's own interface is exactly what this
 * variable exists to avoid.
 */
export function parseBindAddress(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_BIND_ADDRESS
  const value = raw.trim()
  if (value === '') return DEFAULT_BIND_ADDRESS
  if (net.isIP(value) === 0) {
    throw new BindAddressError(
      `BIND_ADDRESS must be an IPv4 or IPv6 address such as 0.0.0.0, 127.0.0.1 or ::, got "${raw}"`,
    )
  }
  return value
}

/**
 * Points Next's standalone server at `BIND_ADDRESS`. That server takes its
 * listen address from `HOSTNAME` — which container platforms set to the
 * machine's own name — so whatever `HOSTNAME` held is overwritten, never
 * consulted. Throws `BindAddressError` for a value that is not an IP literal.
 */
export function applyBindAddress(env: Record<string, string | undefined>): string {
  const address = parseBindAddress(env.BIND_ADDRESS)
  env.HOSTNAME = address
  return address
}
