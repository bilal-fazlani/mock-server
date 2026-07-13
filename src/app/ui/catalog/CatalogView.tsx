import Link from 'next/link'
import type { Catalog } from '../../../lib/catalog/types'
import { MethodBadge } from '../../components/MethodBadge'
import { SchemaBadge } from '../../components/SchemaBadge'
import styles from './catalog.module.css'

export function CatalogView({
  catalog,
  env,
  passthroughAsDefault,
}: {
  catalog: Catalog
  env: Record<string, string | undefined>
  passthroughAsDefault: boolean
}) {
  const hasEndpoints = catalog.systems.some((s) => s.endpoints.length > 0)
  return (
    <main className={styles.page}>
      <h1>Catalog</h1>
      {!hasEndpoints ? (
        <div className={styles.empty}>No endpoints defined in the catalog.</div>
      ) : (
        catalog.systems.map((system) => (
          <section key={system.name} className={styles.system}>
            <div className={styles.systemHeader}>
              <h2 className={styles.systemName}>{system.name}</h2>
              <code className={styles.baseUrlEnv}>
                {env[system.baseUrlEnv] ?? '(not set)'}
              </code>
            </div>
            {system.endpoints.map((endpoint) => (
              <Link
                key={endpoint.name}
                href={`/ui/catalog/${system.slug}/${endpoint.name}`}
                className={styles.endpointCard}
              >
                <div className={styles.endpointHeader}>
                  <MethodBadge method={endpoint.method} />
                  <code className={styles.path}>{endpoint.path}</code>
                  <span className={styles.endpointName}>{endpoint.displayName}</span>
                  {(endpoint.mockType ?? 'profiled') === 'global' && (
                    <span className={styles.globalTag}>global</span>
                  )}
                  {endpoint.schema && <SchemaBadge />}
                </div>
                <div className={styles.endpointMeta}>
                  <span>default: {endpoint.scenarios.default}</span>
                  <span>
                    {Object.keys(endpoint.scenarios).length} scenarios
                    {' + passthrough'}
                    {passthroughAsDefault && ' default'}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        ))
      )}
    </main>
  )
}
