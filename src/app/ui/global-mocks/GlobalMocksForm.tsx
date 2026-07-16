import { RotateCcw } from 'lucide-react'
import type { Catalog, EndpointDef, SystemDef } from '../../../lib/catalog/types'
import type { GlobalMockScenario } from '../../../lib/profiles/store'
import {
  implicitScenario,
  scenarioOptionsWithDangling,
  scenariosWithPassthrough,
} from '../../../lib/scenarios'
import { Alert } from '../../components/Alert'
import { Button } from '../../components/ui/button'
import { MethodBadge } from '../../components/MethodBadge'
import { ScenarioPicker } from '../../components/ScenarioPicker'
import { resetGlobalDynamicHistoryAction, saveGlobalMocks } from './actions'

function key(system: string, endpoint: string): string {
  return `${system}/${endpoint}`
}

function globalEndpoints(catalog: Catalog): Array<{ system: SystemDef; endpoint: EndpointDef }> {
  return catalog.systems.flatMap((system) =>
    system.endpoints
      .filter((endpoint) => (endpoint.mockType ?? 'profiled') === 'global')
      .map((endpoint) => ({ system, endpoint })),
  )
}

export function GlobalMocksForm({
  catalog,
  selections,
  passthroughAsDefault,
  env,
}: {
  catalog: Catalog
  selections: GlobalMockScenario[]
  passthroughAsDefault: boolean
  env: Record<string, string | undefined>
}) {
  const endpoints = globalEndpoints(catalog)
  const endpointKeys = new Set(endpoints.map(({ system, endpoint }) => key(system.slug, endpoint.name)))
  const selectionMap = new Map(selections.map((s) => [key(s.system, s.endpoint), s]))
  const orphans = selections.filter((s) => !endpointKeys.has(key(s.system, s.endpoint)))
  const implicit = implicitScenario(passthroughAsDefault)

  return (
    <form action={saveGlobalMocks} className="grid w-full min-w-0 max-w-[1200px] gap-5">
      {orphans.length > 0 && (
        <Alert>
          {orphans.length} saved global selection{orphans.length === 1 ? '' : 's'} no longer match a
          global catalog endpoint.
        </Alert>
      )}

      {endpoints.length === 0 ? (
        <section className="grid min-w-0 gap-3.5 rounded-lg border border-border bg-card px-5 py-[18px] shadow-sm">
          <p>No global endpoints defined in the catalog.</p>
        </section>
      ) : (
        catalog.systems.map((system) => {
          const systemEndpoints = system.endpoints.filter(
            (endpoint) => (endpoint.mockType ?? 'profiled') === 'global',
          )
          if (systemEndpoints.length === 0) return null
          return (
            <section key={system.slug} className="grid min-w-0 gap-3">
              <h2 className="mt-1 text-secondary-foreground">{system.name}</h2>
              {systemEndpoints.map((endpoint) => {
                const stored = selectionMap.get(key(system.slug, endpoint.name))?.scenario
                const offered = scenariosWithPassthrough(endpoint, passthroughAsDefault)
                const { options, unavailable } = scenarioOptionsWithDangling(offered, stored)
                const stale = unavailable.length > 0
                const selected = stored ?? implicit
                const missingPassthroughBaseUrl = selected === 'real' && !env[system.baseUrlEnv]
                return (
                  <div
                    key={endpoint.name}
                    className="grid min-w-0 gap-3.5 rounded-lg border border-border bg-card px-5 py-[18px] shadow-sm"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                      <MethodBadge method={endpoint.method} />
                      <code className="min-w-0 text-secondary-foreground [overflow-wrap:anywhere]">
                        {endpoint.path}
                      </code>
                      <span className="min-w-0 font-[550]">{endpoint.displayName}</span>
                    </div>
                    {stale && (
                      <Alert>
                        Stale selection &ldquo;{stored}&rdquo; no longer valid — pick a new scenario and
                        save.
                      </Alert>
                    )}
                    {missingPassthroughBaseUrl && (
                      <Alert>
                        Passthrough is selected, but {system.baseUrlEnv} is not set. Requests for this
                        endpoint will return 500 until the base URL is configured.
                      </Alert>
                    )}
                    <ScenarioPicker
                      endpointName={endpoint.name}
                      fieldName={`scenario:${system.slug}:${endpoint.name}`}
                      scenarios={options}
                      selected={selected}
                      unavailable={unavailable}
                      resolverSlugs={endpoint.resolverScenarios}
                    />
                    {stored !== undefined && endpoint.resolverScenarios.includes(stored) && (
                      <div className="mt-2.5 flex">
                        <button
                          formAction={resetGlobalDynamicHistoryAction.bind(
                            null,
                            system.slug,
                            endpoint.name,
                          )}
                          className="inline-flex items-center gap-1.5 bg-background px-2.5 py-1 text-[0.76rem] text-secondary-foreground hover:border-muted-foreground hover:text-foreground"
                        >
                          <RotateCcw className="size-[13px]" aria-hidden="true" />
                          Reset resolver history
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })
      )}

      <div>
        <Button type="submit">Save global mocks</Button>
      </div>
    </form>
  )
}
