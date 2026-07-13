'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LogRow } from '../logs/LogRow'
import type { LogEntryView } from '../logs/types'
import styles from '../logs/logs.module.css'

const POLL_INTERVAL_MS = 2000
const LIMIT = 10

export function RecentActivity({
  profileId,
  initialEntries,
  systemLabels,
  scenarioLabels,
  captureSelectorLabels,
}: {
  profileId: string
  initialEntries: LogEntryView[]
  systemLabels?: Record<string, string>
  scenarioLabels?: Record<string, string>
  captureSelectorLabels?: Record<string, string>
}) {
  const [entries, setEntries] = useState(initialEntries)
  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    const timer = setInterval(() => {
      const newest = entriesRef.current[0]?.logId
      const params = new URLSearchParams({ profile: profileId, limit: String(LIMIT) })
      if (newest) params.set('since', newest)
      fetch(`/ui/api/logs?${params}`)
        .then((res) => res.json())
        .then((data: { entries: LogEntryView[] }) => {
          if (data.entries.length === 0) return
          setEntries((current) => {
            const known = new Set(current.map((e) => e.logId))
            const fresh = data.entries.filter((e) => !known.has(e.logId))
            return fresh.length === 0 ? current : [...fresh, ...current].slice(0, LIMIT)
          })
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [profileId])

  return (
    <section className={styles.recentCard} aria-label="Recent activity">
      <div className={styles.recentHeader}>
        <h2 className={styles.recentTitle}>Recent activity</h2>
        <Link href={`/ui/logs?profile=${encodeURIComponent(profileId)}`} className="btnSecondary">
          View all logs
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className={styles.recentEmpty}>
          No requests logged for this profile yet — activity from the last 24 hours shows up here
          live.
        </p>
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => (
            <LogRow
              key={entry.logId}
              entry={entry}
              systemLabels={systemLabels}
              scenarioLabels={scenarioLabels}
              captureSelectorLabels={captureSelectorLabels}
            />
          ))}
        </div>
      )}
    </section>
  )
}
