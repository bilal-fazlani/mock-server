import Link from 'next/link'
import type { Catalog } from '../../../lib/catalog/types'
import { MethodBadge } from '../../components/MethodBadge'
import { SchemaBadge } from '../../components/SchemaBadge'

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
    <main className="flex flex-col gap-5">
      <h1>Catalog</h1>
      {!hasEndpoints ? (
        <div className="rounded-lg border border-border bg-card p-6 text-secondary-foreground">
          No endpoints defined in the catalog.
        </div>
      ) : (
        catalog.systems.map((system) => (
          <section key={system.name} className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-3">
              <h2>{system.name}</h2>
              <code className="font-mono text-[0.8rem] text-muted-foreground">
                {env[system.baseUrlEnv] ?? '(not set)'}
              </code>
            </div>
            {system.endpoints.map((endpoint) => (
              <Link
                key={endpoint.name}
                href={`/ui/catalog/${system.slug}/${endpoint.name}`}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5 text-foreground shadow-sm no-underline hover:border-primary hover:no-underline"
              >
                <div className="flex items-center gap-2.5">
                  <MethodBadge method={endpoint.method} />
                  <code className="font-mono text-[0.9rem]">{endpoint.path}</code>
                  <span className="text-secondary-foreground">{endpoint.displayName}</span>
                  {(endpoint.mockType ?? 'profiled') === 'global' && (
                    <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[0.72rem] font-semibold uppercase text-[var(--accent)]">
                      global
                    </span>
                  )}
                  {endpoint.schema && <SchemaBadge />}
                </div>
                <div className="flex gap-4 text-[0.8rem] text-muted-foreground">
                  <span>default: {endpoint.scenarios.default?.label}</span>
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
