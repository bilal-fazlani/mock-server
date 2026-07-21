import Link from 'next/link'
import { SquareArrowOutUpRight } from 'lucide-react'
import type { Catalog } from '../../../lib/catalog/types'
import { renderableStaleEndpoints, staleScenarios } from '../../../lib/profiles/stale'
import type { MockProfile } from '../../../lib/profiles/store'
import { implicitScenario, isProfiledEndpoint, scenariosWithPassthrough } from '../../../lib/scenarios'
import { Alert } from '../../components/Alert'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { MethodBadge } from '../../components/MethodBadge'
import { resetDynamicHistoryAction, resetScenarioProgressAction, saveProfile } from './actions'
import { CopyProfileIdButton } from './CopyProfileIdButton'
import { ScenarioConfig } from './ScenarioConfig'
import { StaleSelectionGuard } from './StaleSelectionGuard'

export function ProfileForm({
  catalog,
  profile,
  passthroughAsDefault,
  scenarioProgress = {},
  formId = 'profile-form',
}: {
  catalog: Catalog
  profile?: MockProfile
  passthroughAsDefault: boolean
  /** Calls served per endpoint against the currently saved sequence. */
  scenarioProgress?: Record<string, number>
  formId?: string
}) {
  const stale = profile ? staleScenarios(profile, catalog) : {}
  // Only endpoints that still render a control can be resolved by the user, so
  // the Save guard must ignore pins to endpoints the catalog no longer has
  // (those self-heal on save via parseEndpointScenarios).
  const staleByEndpoint = renderableStaleEndpoints(
    Object.fromEntries(Object.entries(stale).map(([name, joined]) => [name, joined.split(', ')])),
    catalog,
  )
  const gapFallback = implicitScenario(passthroughAsDefault)
  return (
    <>
      <form id={formId} action={saveProfile} className="grid w-full min-w-0 max-w-[1200px] gap-5">
        <section className="grid grid-cols-2 items-start gap-3.5 rounded-lg border border-border bg-card px-5 py-[18px] shadow-sm max-[700px]:grid-cols-1">
          <div className="grid min-w-0 grid-rows-[auto_minmax(1rem,auto)_auto] gap-1 max-[700px]:grid-rows-none">
            <Label className="text-[0.9rem] font-semibold" htmlFor="profileId">
              Profile ID
            </Label>
            <span className="text-[0.8rem] text-muted-foreground">
              Business identifier, e.g. customer-123
            </span>
            <span className="row-start-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                id="profileId"
                name="profileId"
                defaultValue={profile?.profileId}
                readOnly={!!profile}
                className={
                  profile
                    ? 'cursor-default border-[color-mix(in_srgb,var(--border)_75%,var(--background))] bg-background text-muted-foreground focus-visible:border-[color-mix(in_srgb,var(--border)_75%,var(--background))] focus-visible:ring-0 dark:bg-background'
                    : undefined
                }
              />
              {profile && <CopyProfileIdButton value={profile.profileId} />}
            </span>
          </div>
          <label className="grid min-w-0 grid-rows-[auto_minmax(1rem,auto)_auto] gap-1 max-[700px]:grid-rows-none">
            <span className="text-[0.9rem] font-semibold">
              Display name{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Input
              name="displayName"
              defaultValue={profile?.displayName}
              className="row-start-3 max-[700px]:row-start-auto"
            />
          </label>
        </section>
        {catalog.systems.map((system) => {
          // Global endpoints are served from the global-mocks store and never
          // consult a profile, so they don't belong in the profile form; a
          // system left with no profiled endpoints renders no section at all.
          const endpoints = system.endpoints.filter(isProfiledEndpoint)
          if (endpoints.length === 0) return null
          return (
          <section key={system.name} className="grid min-w-0 gap-3">
            <h2 className="mt-1 text-secondary-foreground">{system.name}</h2>
            {endpoints.map((endpoint) => {
              const selected = profile?.endpointScenarios[endpoint.name]
              const isStale = endpoint.name in stale
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
                  {isStale && (
                    <Alert>
                      Stale selection &ldquo;{stale[endpoint.name]}&rdquo; no longer valid — pick a
                      new scenario and save.
                    </Alert>
                  )}
                  <ScenarioConfig
                    endpointName={endpoint.name}
                    scenarios={scenariosWithPassthrough(endpoint, passthroughAsDefault)}
                    selection={selected}
                    fallback={gapFallback}
                    servedCount={scenarioProgress[endpoint.name]}
                    resetAction={
                      profile ? resetScenarioProgressAction.bind(null, endpoint.name) : undefined
                    }
                    resetDynamicAction={
                      profile ? resetDynamicHistoryAction.bind(null, endpoint.name) : undefined
                    }
                    resolverSlugs={endpoint.resolverScenarios}
                  />
                  <div className="-mt-1 flex justify-end">
                    <Link
                      href={`/ui/catalog/${system.slug}/${endpoint.name}`}
                      className="inline-flex items-center gap-1.5 text-[0.78rem] text-muted-foreground hover:text-foreground hover:no-underline"
                    >
                      <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
                      View in catalog
                    </Link>
                  </div>
                </div>
              )
            })}
          </section>
          )
        })}
        {profile && Object.keys(staleByEndpoint).length > 0 && (
          <StaleSelectionGuard
            formId={formId}
            saveButtonId="profile-save-button"
            staleByEndpoint={staleByEndpoint}
          />
        )}
      </form>
    </>
  )
}
