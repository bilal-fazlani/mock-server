import type { Catalog, EndpointDef, SystemDef } from './types'

export type { Catalog } from './types'

export function findEndpointBySlug(
  catalog: Catalog,
  slug: string,
  endpointName: string,
): { system: SystemDef; endpoint: EndpointDef } | null {
  for (const system of catalog.systems) {
    if (system.slug !== slug) continue
    for (const endpoint of system.endpoints) {
      if (endpoint.name === endpointName) return { system, endpoint }
    }
  }
  return null
}
