import type { Catalog, EndpointDef } from '../catalog/types'
import { isProfiledEndpoint, isScenarioDeclared } from '../scenarios'
import type { MockProfile } from './store'

export function staleScenarios(profile: MockProfile, catalog: Catalog): Record<string, string> {
  const endpoints = new Map<string, EndpointDef>(
    catalog.systems.flatMap((s) => s.endpoints.map((e) => [e.slug, e] as const)),
  )
  const stale: Record<string, string> = {}
  for (const [endpointSlug, selection] of Object.entries(profile.endpointScenarios)) {
    const steps = Array.isArray(selection) ? selection : [selection]
    const endpoint = endpoints.get(endpointSlug)
    const invalid = endpoint ? steps.filter((s) => !isScenarioDeclared(endpoint, s)) : steps
    if (invalid.length > 0) stale[endpointSlug] = invalid.join(', ')
  }
  return stale
}

/**
 * Restricts a stale-by-endpoint map to endpoints the profile form still
 * renders a control for — i.e. profiled endpoints present in the catalog. A pin
 * to an endpoint the catalog dropped, or to a global endpoint (which the form
 * never shows), offers no control the user could touch, and
 * `parseEndpointScenarios` drops it on save anyway (self-heal) — so it must not
 * gate the Save button.
 */
export function renderableStaleEndpoints(
  staleByEndpoint: Record<string, string[]>,
  catalog: Catalog,
): Record<string, string[]> {
  const present = new Set(
    catalog.systems.flatMap((s) => s.endpoints.filter(isProfiledEndpoint).map((e) => e.slug)),
  )
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
  for (const [endpointSlug, dangling] of Object.entries(staleByEndpoint)) {
    const current = currentSelections[endpointSlug]
    if (current === undefined || current.length === 0) {
      unresolved.push(endpointSlug)
      continue
    }
    if (current.some((slug) => dangling.includes(slug))) unresolved.push(endpointSlug)
  }
  return unresolved
}
