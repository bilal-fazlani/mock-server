import type { Catalog } from '../../../../lib/catalog/types'
import { getRuntime } from '../../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const { catalog } = getRuntime()
  return Response.json(toCatalogView(catalog))
}

function toCatalogView(catalog: Catalog) {
  return {
    systems: catalog.systems.map((system) => ({
      slug: system.slug,
      name: system.name,
      baseUrlEnv: system.baseUrlEnv,
      endpoints: system.endpoints.map((endpoint) => ({
        name: endpoint.name,
        displayName: endpoint.displayName,
        method: endpoint.method,
        path: endpoint.path,
        mockType: endpoint.mockType ?? 'profiled',
        resolverScenarios: endpoint.resolverScenarios,
        scenarios: endpoint.scenarios,
      })),
    })),
  }
}
