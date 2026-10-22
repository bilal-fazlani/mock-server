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
      displayName: system.displayName,
      baseUrlEnv: system.baseUrlEnv,
      port: system.port,
      ...(system.clientCertEnv !== undefined && { clientCertEnv: system.clientCertEnv }),
      ...(system.clientKeyEnv !== undefined && { clientKeyEnv: system.clientKeyEnv }),
      endpoints: system.endpoints.map((endpoint) => ({
        slug: endpoint.slug,
        displayName: endpoint.displayName,
        method: endpoint.method,
        path: endpoint.path,
        mockType: endpoint.mockType ?? 'profiled',
        // Both are catalog-authored and optional: present only on endpoints whose
        // _endpoint.json declares them, omitted (not null) otherwise — mirrors
        // EndpointDef exactly, no reformatting of the selector strings.
        ...(endpoint.profileIdSelector !== undefined && {
          profileIdSelector: endpoint.profileIdSelector,
        }),
        ...(endpoint.captureProfileKeys !== undefined && {
          captureProfileKeys: endpoint.captureProfileKeys,
        }),
        resolverScenarios: endpoint.resolverScenarios,
        // The runtime-control API contract exposes scenarios as slug → displayName
        // strings; the internal `summary` is surfaced only in the catalog UI.
        scenarios: Object.fromEntries(
          Object.entries(endpoint.scenarios).map(([slug, meta]) => [slug, meta.displayName]),
        ),
      })),
    })),
  }
}
