import { notFound } from 'next/navigation'
import { formatUtc } from '../../../../lib/format'
import { listLogEntries } from '../../../../lib/logs/store'
import { getDb, getProfile, getScenarioProgress } from '../../../../lib/profiles/store'
import type { MockProfile, ScenarioProgress } from '../../../../lib/profiles/store'
import { getRuntime } from '../../../../lib/runtime'
import { toLogEntryView } from '../../logs/types'
import { ProfileForm } from '../ProfileForm'
import { ProfilePageHeader } from '../ProfilePageHeader'
import { RecentActivity } from '../RecentActivity'

export const dynamic = 'force-dynamic'

const profileFormId = 'profile-form'

export default async function ProfileDetailPage({
  params,
}: {
  params: Promise<{ profileId: string }>
}) {
  const { profileId } = await params
  const db = await getDb()
  const runtime = getRuntime()
  const profile = await getProfile(db, decodeURIComponent(profileId))
  if (!profile) notFound()
  const [progress, recentLogs] = await Promise.all([
    getScenarioProgress(db, profile.profileId),
    listLogEntries(db, { profileId: profile.profileId, limit: 10 }),
  ])
  const captureSelectorLabels = Object.fromEntries(
    runtime.catalog.systems.flatMap((s) =>
      s.endpoints.flatMap((e) =>
        (e.captureProfileKeys ?? []).map((capture) => [
          `${s.slug}/${e.name}/${capture.namespace}`,
          capture.keySelector,
        ]),
      ),
    ),
  )
  return (
    <main className="grid gap-4">
      <ProfilePageHeader
        title={profile.displayName ?? profile.profileId}
        profileId={profile.profileId}
        meta={`Created ${formatUtc(profile.createdAt)} · Modified ${formatUtc(profile.modifiedAt)}`}
        formId={profileFormId}
      />
      <ProfileForm
        catalog={runtime.catalog}
        profile={profile}
        passthroughAsDefault={runtime.passthroughAsDefault}
        scenarioProgress={progressByEndpoint(profile, progress)}
        formId={profileFormId}
      />
      <RecentActivity
        profileId={profile.profileId}
        initialEntries={recentLogs.map(toLogEntryView)}
        systemLabels={Object.fromEntries(runtime.catalog.systems.map((s) => [s.slug, s.name]))}
        scenarioLabels={Object.fromEntries(
          runtime.catalog.systems.flatMap((s) =>
            s.endpoints.flatMap((e) =>
              Object.entries(e.scenarios).map(([scenario, label]) => [
                `${s.slug}/${e.name}/${scenario}`,
                label,
              ]),
            ),
          ),
        )}
        captureSelectorLabels={captureSelectorLabels}
      />
    </main>
  )
}

// Progress only counts against the sequence the profile currently stores;
// a counter left over from an older sequence restarts on the next call.
function progressByEndpoint(
  profile: MockProfile,
  progress: ScenarioProgress[],
): Record<string, number> {
  const byEndpoint: Record<string, number> = {}
  for (const p of progress) {
    const selection = profile.endpointScenarios[p.endpointName]
    if (Array.isArray(selection) && JSON.stringify(selection) === JSON.stringify(p.steps)) {
      byEndpoint[p.endpointName] = p.served
    }
  }
  return byEndpoint
}
