import Link from 'next/link'
import { SquareArrowOutUpRight } from 'lucide-react'
import type { Catalog } from '../../../lib/catalog/types'
import { staleScenarios } from '../../../lib/profiles/stale'
import type { MockProfile } from '../../../lib/profiles/store'
import { implicitScenario, scenariosWithPassthrough } from '../../../lib/scenarios'
import { Alert } from '../../components/Alert'
import { MethodBadge } from '../../components/MethodBadge'
import { resetScenarioProgressAction, saveProfile } from './actions'
import { CopyProfileIdButton } from './CopyProfileIdButton'
import { ScenarioConfig } from './ScenarioConfig'
import styles from './ProfileForm.module.css'

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
  const gapFallback = implicitScenario(passthroughAsDefault)
  return (
    <>
      <form id={formId} action={saveProfile} className={styles.form}>
        <section className={`${styles.card} ${styles.identityCard}`}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="profileId">
              Profile ID
            </label>
            <span className={styles.fieldHint}>Business identifier, e.g. customer-123</span>
            <span className={styles.profileIdControl}>
              <input
                id="profileId"
                name="profileId"
                defaultValue={profile?.profileId}
                readOnly={!!profile}
                className={profile ? styles.readOnlyInput : undefined}
              />
              {profile && <CopyProfileIdButton value={profile.profileId} />}
            </span>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Display name <span className={styles.optional}>(optional)</span>
            </span>
            <input name="displayName" defaultValue={profile?.displayName} />
          </label>
        </section>
        {catalog.systems.map((system) => (
          <section key={system.name} className={styles.system}>
            <h2 className={styles.systemName}>{system.name}</h2>
            {system.endpoints.map((endpoint) => {
              const selected = profile?.endpointScenarios[endpoint.name]
              const isStale = endpoint.name in stale
              return (
                <div key={endpoint.name} className={styles.card}>
                  <div className={styles.endpointHeader}>
                    <MethodBadge method={endpoint.method} />
                    <code className={styles.path}>{endpoint.path}</code>
                    <span className={styles.endpointName}>{endpoint.displayName}</span>
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
                    selection={isStale ? undefined : selected}
                    fallback={gapFallback}
                    servedCount={scenarioProgress[endpoint.name]}
                    resetAction={
                      profile ? resetScenarioProgressAction.bind(null, endpoint.name) : undefined
                    }
                  />
                  <div className={styles.cardFooter}>
                    <Link
                      href={`/ui/catalog/${system.slug}/${endpoint.name}`}
                      className={styles.catalogLink}
                    >
                      <SquareArrowOutUpRight className={styles.catalogLinkIcon} aria-hidden="true" />
                      View in catalog
                    </Link>
                  </div>
                </div>
              )
            })}
          </section>
        ))}
      </form>
    </>
  )
}
