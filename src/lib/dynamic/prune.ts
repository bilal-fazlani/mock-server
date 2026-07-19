import type { Db } from 'mongodb'
import type { Catalog } from '../catalog/types'
import { getRuntime } from '../runtime'
import { pruneOrphanedDynamicHistory } from './history-store'

/** Every (endpoint, scenario) pair that is resolver-backed in the loaded catalog. */
export function liveResolverScenarios(
  catalog: Catalog,
): { endpointName: string; scenario: string }[] {
  return catalog.systems.flatMap((system) =>
    system.endpoints.flatMap((endpoint) =>
      endpoint.resolverScenarios.map((scenario) => ({ endpointName: endpoint.name, scenario })),
    ),
  )
}

/**
 * Startup sweep, run once per process from getDb(): drop resolver-history rows
 * for scenarios the catalog no longer backs with a resolver. Removing a
 * `<slug>.mjs` otherwise strands its windows forever — no owner deletion covers
 * them. Best-effort: a failure here must not stop the server from serving, so
 * it is logged and swallowed (the next boot retries).
 */
export async function pruneOrphanedHistoryOnce(db: Db): Promise<void> {
  try {
    const deleted = await pruneOrphanedDynamicHistory(db, liveResolverScenarios(getRuntime().catalog))
    if (deleted > 0) {
      console.warn(`resolver history: pruned ${deleted} window(s) for scenarios that are no longer resolver-backed`)
    }
  } catch (err) {
    console.warn(
      `resolver history: orphaned-window sweep skipped: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
