import type { Catalog, EndpointDef } from '../catalog/types'
import { isScenarioDeclared } from '../scenarios'
import type { MockProfile } from './store'

export function staleScenarios(profile: MockProfile, catalog: Catalog): Record<string, string> {
  const endpoints = new Map<string, EndpointDef>(
    catalog.systems.flatMap((s) => s.endpoints.map((e) => [e.name, e] as const)),
  )
  const stale: Record<string, string> = {}
  for (const [endpointName, selection] of Object.entries(profile.endpointScenarios)) {
    const steps = Array.isArray(selection) ? selection : [selection]
    const endpoint = endpoints.get(endpointName)
    const invalid = endpoint ? steps.filter((s) => !isScenarioDeclared(endpoint, s)) : steps
    if (invalid.length > 0) stale[endpointName] = invalid.join(', ')
  }
  return stale
}

/**
 * Restricts a stale-by-endpoint map to endpoints that still exist in the
 * catalog. A pin to an endpoint the catalog no longer has renders no
 * card/control the user could touch, and `parseEndpointScenarios` drops it on
 * save anyway (self-heal) — so it must not gate the Save button.
 */
export function renderableStaleEndpoints(
  staleByEndpoint: Record<string, string[]>,
  catalog: Catalog,
): Record<string, string[]> {
  const present = new Set(catalog.systems.flatMap((s) => s.endpoints.map((e) => e.name)))
  return Object.fromEntries(
    Object.entries(staleByEndpoint).filter(([name]) => present.has(name)),
  )
}

/**
 * Given the dangling slugs per endpoint (`staleByEndpoint`, e.g. from
 * `staleScenarios` split back into arrays) and the user's current in-form
 * selections per endpoint, returns the endpoint names whose stale pin is not
 * yet resolved — i.e. the current selection is empty/absent, or still contains
 * a dangling slug. Used to block saving until the user picks a valid scenario.
 */
export function unresolvedStaleEndpoints(
  staleByEndpoint: Record<string, string[]>,
  currentSelections: Record<string, string[]>,
): string[] {
  const unresolved: string[] = []
  for (const [endpointName, dangling] of Object.entries(staleByEndpoint)) {
    const current = currentSelections[endpointName]
    if (current === undefined || current.length === 0) {
      unresolved.push(endpointName)
      continue
    }
    if (current.some((slug) => dangling.includes(slug))) unresolved.push(endpointName)
  }
  return unresolved
}
