'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Trash2 } from 'lucide-react'
import { clearLogsAction } from './actions'
import { LogRow } from './LogRow'
import type { LogEntryView } from './types'
import styles from './logs.module.css'

const POLL_INTERVAL_MS = 2000
const MAX_ENTRIES = 200
const MAX_SUGGESTIONS = 8

export interface ProfileOption {
  profileId: string
  displayName?: string
}

export interface EndpointOption {
  name: string
  displayName: string
  method: string
  path: string
}

export interface LogFilterOptions {
  profiles: ProfileOption[]
  endpoints: EndpointOption[]
  systemLabels?: Record<string, string>
  scenarioLabels?: Record<string, string>
  captureSelectorLabels?: Record<string, string>
}

export function LogsView({
  initialEntries,
  options,
  initialProfile = '',
}: {
  initialEntries: LogEntryView[]
  options: LogFilterOptions
  initialProfile?: string
}) {
  const [entries, setEntries] = useState<LogEntryView[]>(initialEntries)
  const [profile, setProfile] = useState(initialProfile)
  const [endpoint, setEndpoint] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [logIdQuery, setLogIdQuery] = useState('')
  const [paused, setPaused] = useState(false)

  const entriesRef = useRef(entries)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  const query = useCallback(
    (since?: string) => {
      const params = new URLSearchParams()
      if (profile) params.set('profile', profile)
      if (endpoint) params.set('endpoint', endpoint)
      if (errorsOnly) params.set('errorsOnly', '1')
      if (logIdQuery) params.set('logId', logIdQuery)
      if (since) params.set('since', since)
      return `/ui/api/logs?${params}`
    },
    [profile, endpoint, errorsOnly, logIdQuery],
  )

  // Filter change: full refetch.
  useEffect(() => {
    let cancelled = false
    fetch(query())
      .then((res) => res.json())
      .then((data: { entries: LogEntryView[] }) => {
        if (!cancelled) setEntries(data.entries)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [query])

  // Live tail: poll for entries newer than the newest one we have.
  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => {
      const newest = entriesRef.current[0]?.logId
      fetch(query(newest))
        .then((res) => res.json())
        .then((data: { entries: LogEntryView[] }) => {
          if (data.entries.length === 0) return
          setEntries((current) => {
            const known = new Set(current.map((e) => e.logId))
            const fresh = data.entries.filter((e) => !known.has(e.logId))
            return fresh.length === 0 ? current : [...fresh, ...current].slice(0, MAX_ENTRIES)
          })
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [query, paused])

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.filters}>
          <ProfileFilter
            profiles={options.profiles}
            value={profile}
            onChange={setProfile}
            initialText={initialProfile}
          />
          <EndpointFilter endpoints={options.endpoints} value={endpoint} onChange={setEndpoint} />
          <input
            className={styles.filterInput}
            type="search"
            placeholder="Filter by log id"
            value={logIdQuery}
            onChange={(e) => setLogIdQuery(e.target.value.trim())}
            aria-label="Filter by log id"
          />
          <label className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.target.checked)}
            />
            Errors only
          </label>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.filterToggle}>
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            Pause
          </label>
          <span className={`${styles.liveDot} ${paused ? styles.livePaused : ''}`}>
            {paused ? 'paused' : 'live'}
          </span>
          <form
            action={clearLogsAction}
            onSubmit={() => {
              setEntries([])
            }}
          >
            {profile && <input type="hidden" name="profileId" value={profile} />}
            <button type="submit" className="btnSecondary">
              <Trash2 style={{ width: 13, height: 13, marginRight: 6, verticalAlign: '-2px' }} aria-hidden="true" />
              Clear {profile ? 'profile logs' : 'all logs'}
            </button>
          </form>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className={styles.empty}>No log entries yet — send a request to the mock server.</p>
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => (
            <LogRow
              key={entry.logId}
              entry={entry}
              systemLabels={options.systemLabels}
              scenarioLabels={options.scenarioLabels}
              captureSelectorLabels={options.captureSelectorLabels}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Text filter with suggestions: typing matches profile IDs and display names,
 * but the applied filter is always a profile ID.
 */
function ProfileFilter({
  profiles,
  value,
  onChange,
  initialText,
}: {
  profiles: ProfileOption[]
  value: string
  onChange: (profileId: string) => void
  initialText: string
}) {
  const [text, setText] = useState(initialText)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const lower = text.toLowerCase()
  const suggestions = (
    lower
      ? profiles.filter(
          (p) =>
            p.profileId.toLowerCase().includes(lower) ||
            p.displayName?.toLowerCase().includes(lower),
        )
      : profiles
  ).slice(0, MAX_SUGGESTIONS)

  const apply = (input: string) => {
    setText(input)
    const trimmed = input.trim()
    if (trimmed === '') {
      onChange('')
    } else if (profiles.some((p) => p.profileId === trimmed)) {
      onChange(trimmed)
    }
  }

  const pick = (p: ProfileOption) => {
    setText(p.profileId)
    onChange(p.profileId)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={styles.combo}>
      <input
        className={`${styles.filterInput} ${styles.comboInput} ${value ? styles.comboActive : ''}`}
        type="text"
        placeholder="Filter by profile"
        value={text}
        onChange={(e) => {
          apply(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && suggestions.length > 0) {
            e.preventDefault()
            pick(suggestions[0])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        aria-label="Filter by profile"
        aria-expanded={open}
        role="combobox"
        aria-autocomplete="list"
      />
      {open && suggestions.length > 0 && (
        <div className={styles.comboMenu} role="listbox" aria-label="Profiles">
          {suggestions.map((p) => (
            <button
              key={p.profileId}
              type="button"
              role="option"
              aria-selected={p.profileId === value}
              className={styles.comboOption}
              onClick={() => pick(p)}
            >
              <span className={styles.comboOptionLabel}>{p.displayName ?? p.profileId}</span>
              {p.displayName && <span className={styles.comboOptionSub}>{p.profileId}</span>}
              {p.profileId === value && <Check className={styles.comboCheck} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EndpointFilter({
  endpoints,
  value,
  onChange,
}: {
  endpoints: EndpointOption[]
  value: string
  onChange: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const selected = endpoints.find((e) => e.name === value)

  const pick = (name: string) => {
    onChange(name)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={styles.combo}>
      <button
        type="button"
        className={`${styles.endpointTrigger} ${value ? styles.comboActive : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by endpoint"
        onClick={() => setOpen(!open)}
      >
        <span className={styles.endpointTriggerLabel}>
          {selected ? selected.displayName : 'All endpoints'}
        </span>
        <ChevronsUpDown className={styles.comboChevron} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.comboMenu} role="listbox" aria-label="Endpoints">
          <button
            type="button"
            role="option"
            aria-selected={value === ''}
            className={styles.comboOption}
            onClick={() => pick('')}
          >
            <span className={styles.comboOptionLabel}>All endpoints</span>
            {value === '' && <Check className={styles.comboCheck} aria-hidden="true" />}
          </button>
          {endpoints.map((e) => (
            <button
              key={e.name}
              type="button"
              role="option"
              aria-selected={e.name === value}
              className={styles.comboOption}
              onClick={() => pick(e.name)}
            >
              <span className={styles.comboOptionLabel}>{e.displayName}</span>
              <span className={styles.comboOptionSub}>
                {e.method.toUpperCase()} {e.path}
              </span>
              {e.name === value && <Check className={styles.comboCheck} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
