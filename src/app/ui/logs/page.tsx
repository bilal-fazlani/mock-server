import { listLogSummaries } from '../../../lib/logs/store'
import { getDb, listProfiles } from '../../../lib/profiles/store'
import { getRuntime } from '../../../lib/runtime'
import { LogsView } from './LogsView'
import { toLogSummaryView } from './types'

export const dynamic = 'force-dynamic'

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>
}) {
  const { profile } = await searchParams
  const db = await getDb()
  const runtime = getRuntime()
  const [entries, profiles] = await Promise.all([
    listLogSummaries(db, { profileId: profile || undefined }),
    listProfiles(db, 100),
  ])
  const endpoints = runtime
    .catalog.systems.flatMap((s) =>
      s.endpoints.map((e) => ({
        name: e.name,
        displayName: e.displayName,
        method: e.method,
        path: e.path,
      })),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
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
      <h1>Request logs</h1>
      <LogsView
        initialEntries={entries.map(toLogSummaryView)}
        options={{
          profiles: profiles.map((p) => ({ profileId: p.profileId, displayName: p.displayName })),
          endpoints,
          systemLabels: Object.fromEntries(runtime.catalog.systems.map((s) => [s.slug, s.name])),
          scenarioLabels: Object.fromEntries(
            runtime.catalog.systems.flatMap((s) =>
              s.endpoints.flatMap((e) =>
                Object.entries(e.scenarios).map(([scenario, meta]) => [
                  `${s.slug}/${e.name}/${scenario}`,
                  meta.label,
                ]),
              ),
            ),
          ),
          captureSelectorLabels,
        }}
        initialProfile={profile ?? ''}
      />
    </main>
  )
}
