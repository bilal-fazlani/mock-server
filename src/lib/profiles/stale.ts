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
