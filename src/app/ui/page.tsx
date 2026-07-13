import Link from 'next/link'
import { formatUtc } from '../../lib/format'
import { staleScenarios } from '../../lib/profiles/stale'
import { getDb, listProfiles } from '../../lib/profiles/store'
import { getRuntime } from '../../lib/runtime'
import styles from './home.module.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const profiles = await listProfiles(await getDb())
  const { catalog } = getRuntime()
  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1>Mock profiles</h1>
        <Link href="/ui/profiles/new" className="btnPrimary">
          Create new profile
        </Link>
      </div>
      {profiles.length === 0 ? (
        <div className={styles.empty}>
          <p>No profiles yet.</p>
          <p className={styles.emptyHint}>Create a profile to choose mock scenarios per endpoint.</p>
        </div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Profile ID</th>
                <th>Display name</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const needsUpdate = Object.keys(staleScenarios(p, catalog)).length > 0
                return (
                  <tr key={p.profileId}>
                    <td>
                      <span className={styles.idCell}>
                        <Link href={`/ui/profiles/${encodeURIComponent(p.profileId)}`}>{p.profileId}</Link>
                        {needsUpdate && (
                          <span
                            className={styles.needsUpdate}
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
                    <td>{p.displayName ?? '—'}</td>
                    <td className={styles.timestamp}>{formatUtc(p.modifiedAt)}</td>
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
