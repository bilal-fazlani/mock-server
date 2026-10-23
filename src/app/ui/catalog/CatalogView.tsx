import Link from 'next/link'
import { ArrowRight, Lock, TriangleAlert } from 'lucide-react'
import type { Catalog, SystemDef } from '../../../lib/catalog/types'
import { MethodBadge } from '../../components/MethodBadge'
import { SchemaBadge } from '../../components/SchemaBadge'

/** The catalog page address that opens with `slug` selected in the system nav. */
export function catalogSystemHref(slug: string): string {
  return `/ui/catalog?system=${encodeURIComponent(slug)}`
}

export function CatalogView({
  catalog,
  env,
  passthroughAsDefault,
  selectedSystem,
}: {
  catalog: Catalog
  env: Record<string, string | undefined>
  passthroughAsDefault: boolean
  /** Slug from `?system=`; a missing or unknown slug selects the first system. */
  selectedSystem?: string
}) {
  const selected =
    catalog.systems.find((system) => system.slug === selectedSystem) ?? catalog.systems[0]
  return (
    <main className="flex flex-col gap-5">
      <h1>Catalog</h1>
      {!selected ? (
        <div className="rounded-lg border border-border bg-card p-6 text-secondary-foreground">
          No endpoints defined in the catalog.
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <SystemNav catalog={catalog} env={env} selected={selected} />
          <SystemEndpoints
            system={selected}
            baseUrl={env[selected.baseUrlEnv]}
            passthroughAsDefault={passthroughAsDefault}
          />
        </div>
      )}
    </main>
  )
}

function scenarioCount(n: number): string {
  return n === 1 ? '1 scenario' : `${n} scenarios`
}

function SystemNav({
  catalog,
  env,
  selected,
}: {
  catalog: Catalog
  env: Record<string, string | undefined>
  selected: SystemDef
}) {
  return (
    <nav aria-label="Systems" className="flex flex-[1_1_280px] flex-col gap-2 sm:max-w-[320px]">
      <div className="flex items-baseline px-1 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        <span>System</span>
        <span className="ml-auto">Port</span>
      </div>
      {catalog.systems.map((system) => {
        const isSelected = system.slug === selected.slug
        const baseUrl = env[system.baseUrlEnv]
        return (
          <Link
            key={system.slug}
            href={catalogSystemHref(system.slug)}
            aria-current={isSelected ? 'page' : undefined}
            className={`flex flex-col gap-1.5 rounded-lg border px-3.5 py-3 text-foreground no-underline hover:no-underline ${
              isSelected
                ? 'border-foreground bg-card shadow-sm'
                : 'border-border bg-muted hover:border-muted-foreground'
            }`}
          >
            <span className="flex items-baseline gap-2">
              <span className={isSelected ? 'font-semibold' : 'font-medium'}>{system.displayName}</span>
              <span
                className={`ml-auto font-mono text-[1.35rem] font-semibold tracking-[-0.02em] ${
                  isSelected ? '' : 'text-secondary-foreground'
                }`}
              >
                :{system.port}
              </span>
            </span>
            {baseUrl ? (
              <span className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                <ArrowRight className="size-3.5 flex-none" aria-hidden="true" />
                <code className="[overflow-wrap:anywhere]">{baseUrl}</code>
                {system.clientCertEnv && (
                  <span
                    className="inline-flex flex-none text-secondary-foreground"
                    role="img"
                    title="Presents a client certificate when forwarding"
                    aria-label="Presents a client certificate when forwarding"
                  >
                    <Lock className="size-3" aria-hidden="true" />
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-[var(--warning-text)]">
                <TriangleAlert className="size-3.5 flex-none" aria-hidden="true" />
                base URL not set
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

function SystemEndpoints({
  system,
  baseUrl,
  passthroughAsDefault,
}: {
  system: SystemDef
  baseUrl: string | undefined
  passthroughAsDefault: boolean
}) {
  return (
    <section
      aria-label={`${system.displayName} endpoints`}
      className="flex min-w-0 flex-[999_1_560px] flex-col gap-3 sm:pt-6"
    >
      {!baseUrl && (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3.5 py-2.5 text-[0.82rem] text-[var(--warning-text)]"
        >
          <TriangleAlert className="mt-px size-4 flex-none" aria-hidden="true" />
          <span>
            Set <code className="font-semibold">{system.baseUrlEnv}</code> to forward passthrough and
            unmatched requests — until then they fail.
          </span>
        </div>
      )}
      {system.endpoints.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-secondary-foreground">
          No endpoints defined for this system.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          {system.endpoints.map((endpoint) => (
            <Link
              key={endpoint.slug}
              href={`/ui/catalog/${system.slug}/${endpoint.slug}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3.5 text-foreground no-underline last:border-b-0 hover:bg-muted hover:no-underline"
            >
              <MethodBadge method={endpoint.method} />
              <code className="font-mono text-[0.9rem]">{endpoint.path}</code>
              <span className="text-secondary-foreground">{endpoint.displayName}</span>
              {(endpoint.mockType ?? 'profiled') === 'global' && (
                <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[0.72rem] font-semibold uppercase text-[var(--accent)]">
                  global
                </span>
              )}
              {endpoint.schema && <SchemaBadge />}
              <span className="ml-auto text-[0.8rem] text-muted-foreground">
                default: {endpoint.scenarios.default?.displayName} ·{' '}
                {scenarioCount(Object.keys(endpoint.scenarios).length)}
                {' + passthrough'}
                {passthroughAsDefault && ' default'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
