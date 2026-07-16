import Link from 'next/link'
import { Button } from '@/app/components/ui/button'
import { formatUtc } from '../../lib/format'
import { staleScenarios } from '../../lib/profiles/stale'
import { getDb, listProfiles } from '../../lib/profiles/store'
import { getRuntime } from '../../lib/runtime'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const profiles = await listProfiles(await getDb())
  const { catalog } = getRuntime()
  return (
    <main className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Mock profiles</h1>
        <Button asChild>
          <Link href="/ui/profiles/new">Create new profile</Link>
        </Button>
      </div>
      {profiles.length === 0 ? (
        <div className="grid gap-1 rounded-lg border border-dashed border-border bg-card px-5 py-10 text-center">
          <p>No profiles yet.</p>
          <p className="text-[0.9rem] text-muted-foreground">Create a profile to choose mock scenarios per endpoint.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full border-collapse text-[0.92rem]">
            <thead>
              <tr>
                <th className="border-b border-border px-4 py-3 text-left text-[0.78rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  Profile ID
                </th>
                <th className="border-b border-border px-4 py-3 text-left text-[0.78rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  Display name
                </th>
                <th className="border-b border-border px-4 py-3 text-left text-[0.78rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  Modified
                </th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {profiles.map((p) => {
                const needsUpdate = Object.keys(staleScenarios(p, catalog)).length > 0
                return (
                  <tr key={p.profileId} className="hover:bg-[var(--accent-tint)]">
                    <td className="border-b border-border px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <Link href={`/ui/profiles/${encodeURIComponent(p.profileId)}`}>{p.profileId}</Link>
                        {needsUpdate && (
                          <span
                            className="inline-flex items-center text-[var(--warning-text)]"
                            role="img"
                            aria-label="Needs updating: has stale scenario selections"
                            title="Needs updating: has stale scenario selections"
                          >
                            <svg
                              width="15"
                              height="15"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                              <line x1="12" y1="9" x2="12" y2="13" />
                              <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="border-b border-border px-4 py-3">{p.displayName ?? '—'}</td>
                    <td className="border-b border-border px-4 py-3 font-mono text-[0.8rem] text-secondary-foreground">
                      {formatUtc(p.modifiedAt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
