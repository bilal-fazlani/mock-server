'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronsUpDown, Trash2 } from 'lucide-react'
import { clearLogsAction } from './actions'
import { LogRow } from './LogRow'
import {
  appendOlder,
  atTop,
  bufferPending,
  flushToTail,
  mergeTail,
  OLDER_PAGE_SIZE,
} from './list-state'
import type { LogSummaryView } from './types'
import styles from './logs.module.css'

const POLL_INTERVAL_MS = 2000
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
  initialEntries: LogSummaryView[]
  options: LogFilterOptions
  initialProfile?: string
}) {
  const [entries, setEntries] = useState<LogSummaryView[]>(initialEntries)
  const [pending, setPending] = useState<LogSummaryView[]>([])
  const [profile, setProfile] = useState(initialProfile)
  const [endpoint, setEndpoint] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [logIdQuery, setLogIdQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [atFloor, setAtFloor] = useState(false)
  const [capped, setCapped] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const entriesRef = useRef(entries)
  const pendingRef = useRef(pending)
  const browsingRef = useRef(browsing)
  const loadingOlderRef = useRef(false)
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => {
    browsingRef.current = browsing
  }, [browsing])

  const query = useCallback(
    (extra?: { since?: string; before?: string }) => {
      const params = new URLSearchParams()
      if (profile) params.set('profile', profile)
      if (endpoint) params.set('endpoint', endpoint)
      if (errorsOnly) params.set('errorsOnly', '1')
      if (logIdQuery) params.set('logId', logIdQuery)
      if (extra?.since) params.set('since', extra.since)
      if (extra?.before) {
        params.set('before', extra.before)
        params.set('limit', String(OLDER_PAGE_SIZE))
      }
      return `/ui/api/logs?${params}`
    },
    [profile, endpoint, errorsOnly, logIdQuery],
  )

  // Filter change: full refetch, reset to tail.
  useEffect(() => {
    let cancelled = false
    fetch(query())
      .then((res) => res.json())
      .then((data: { entries: LogSummaryView[] }) => {
        if (cancelled) return
        setEntries(data.entries)
        setPending([])
        setBrowsing(false)
        setAtFloor(false)
        setCapped(false)
        scrollRef.current?.scrollTo({ top: 0 })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [query])

  // Live poll: prepend in tail mode, buffer in browse mode.
  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => {
      const newest = entriesRef.current[0]?.logId
      fetch(query({ since: newest }))
        .then((res) => res.json())
        .then((data: { entries: LogSummaryView[] }) => {
          if (data.entries.length === 0) return
          if (browsingRef.current) {
            const known = new Set(entriesRef.current.map((e) => e.logId))
            setPending((current) => bufferPending(current, data.entries, known))
          } else {
            setEntries((current) => mergeTail(current, data.entries))
          }
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [query, paused])

  const loadOlder = useCallback(() => {
    if (loadingOlderRef.current || atFloor || capped) return
    const oldest = entriesRef.current[entriesRef.current.length - 1]?.logId
    if (!oldest) return
    loadingOlderRef.current = true
    fetch(query({ before: oldest }))
      .then((res) => res.json())
      .then((data: { entries: LogSummaryView[] }) => {
        if (data.entries.length < OLDER_PAGE_SIZE) setAtFloor(true)
        if (data.entries.length > 0) {
          setEntries((current) => {
            const { rows, capped: hitCap } = appendOlder(current, data.entries)
            if (hitCap) setCapped(true)
            return rows
          })
        }
      })
      .catch(() => {})
      .finally(() => {
        loadingOlderRef.current = false
      })
  }, [query, atFloor, capped])

  // Infinite scroll: load older when the sentinel enters view.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || atFloor || capped) return
    const observer = new IntersectionObserver(
      (records) => {
        if (records[0]?.isIntersecting) loadOlder()
      },
      { root: scrollRef.current, rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadOlder, atFloor, capped, entries.length])

  const onScroll = useCallback(() => {
    const top = scrollRef.current?.scrollTop ?? 0
    const nowBrowsing = !atTop(top)
    setBrowsing(nowBrowsing)
    // Returning to the top snaps back to the bounded tail (the next poll trims
    // via mergeTail). Clear the floor/cap markers so the sentinel re-arms —
    // otherwise a stale "Beginning of logs"/"Showing latest 500" sticks and
    // infinite scroll stays dead for the session.
    if (!nowBrowsing) {
      setAtFloor(false)
      setCapped(false)
    }
  }, [])

  const jumpToLatest = useCallback(() => {
    setEntries((current) => flushToTail(current, pendingRef.current))
    setPending([])
    setBrowsing(false)
    setAtFloor(false)
    setCapped(false)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [])

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
              setPending([])
              setBrowsing(false)
              setAtFloor(false)
              setCapped(false)
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

      {pending.length > 0 && (
        <button type="button" className={styles.newPill} onClick={jumpToLatest}>
          <ArrowUp style={{ width: 13, height: 13, marginRight: 6, verticalAlign: '-2px' }} aria-hidden="true" />
          {pending.length} new
        </button>
      )}

      {entries.length === 0 ? (
        <p className={styles.empty}>No log entries yet — send a request to the mock server.</p>
      ) : (
        <div className={styles.list} data-logs-scroll ref={scrollRef} onScroll={onScroll}>
          {entries.map((entry) => (
            <LogRow
              key={entry.logId}
              entry={entry}
              systemLabels={options.systemLabels}
              scenarioLabels={options.scenarioLabels}
              captureSelectorLabels={options.captureSelectorLabels}
            />
          ))}
          {capped ? (
            <p className={styles.floorMarker}>Showing latest 500 — narrow your filters to see older entries.</p>
          ) : atFloor ? (
            <p className={styles.floorMarker}>Beginning of logs.</p>
          ) : (
            <div data-logs-sentinel ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
          )}
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
