import { RotateCcw } from 'lucide-react'
import type { Catalog, EndpointDef, SystemDef } from '../../../lib/catalog/types'
import type { GlobalMockScenario } from '../../../lib/profiles/store'
import {
  DYNAMIC_SCENARIO,
  implicitScenario,
  scenarioOptionsWithDangling,
  scenariosWithPassthrough,
} from '../../../lib/scenarios'
import { Alert } from '../../components/Alert'
import { MethodBadge } from '../../components/MethodBadge'
import { ScenarioPicker } from '../../components/ScenarioPicker'
import { resetGlobalDynamicHistoryAction, saveGlobalMocks } from './actions'
import styles from '../profiles/ProfileForm.module.css'

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
    <form action={saveGlobalMocks} className={styles.form}>
      {orphans.length > 0 && (
        <Alert>
          {orphans.length} saved global selection{orphans.length === 1 ? '' : 's'} no longer match a
          global catalog endpoint.
        </Alert>
      )}

      {endpoints.length === 0 ? (
        <section className={styles.card}>
          <p>No global endpoints defined in the catalog.</p>
        </section>
      ) : (
        catalog.systems.map((system) => {
          const systemEndpoints = system.endpoints.filter(
            (endpoint) => (endpoint.mockType ?? 'profiled') === 'global',
          )
          if (systemEndpoints.length === 0) return null
          return (
            <section key={system.slug} className={styles.system}>
              <h2 className={styles.systemName}>{system.name}</h2>
              {systemEndpoints.map((endpoint) => {
                const stored = selectionMap.get(key(system.slug, endpoint.name))?.scenario
                const offered = scenariosWithPassthrough(endpoint, passthroughAsDefault)
                const { options, unavailable } = scenarioOptionsWithDangling(offered, stored)
                const stale = unavailable.length > 0
                const selected = stored ?? implicit
                const missingPassthroughBaseUrl = selected === 'real' && !env[system.baseUrlEnv]
                return (
                  <div key={endpoint.name} className={styles.card}>
                    <div className={styles.endpointHeader}>
                      <MethodBadge method={endpoint.method} />
                      <code className={styles.path}>{endpoint.path}</code>
                      <span className={styles.endpointName}>{endpoint.displayName}</span>
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
                    />
                    {stored === DYNAMIC_SCENARIO && (
                      <div className={styles.resetFooter}>
                        <button
                          formAction={resetGlobalDynamicHistoryAction.bind(
                            null,
                            system.slug,
                            endpoint.name,
                          )}
                          className={styles.resetButton}
                        >
                          <RotateCcw className={styles.resetIcon} aria-hidden="true" />
                          Reset dynamic history
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
        <button type="submit" className="btnPrimary">
          Save global mocks
        </button>
      </div>
    </form>
  )
}
