'use client'

import { useSyncExternalStore } from 'react'
import { formatTimeZoneLabel, resolveTimeZone } from '../../../lib/format'

export interface TimeZoneState {
  /** IANA id passed to `formatTimestamp`, e.g. `Asia/Kolkata`. */
  id: string
  /** Display label, e.g. `Asia/Kolkata (GMT+5:30)`. */
  label: string
}

const UTC: TimeZoneState = { id: 'UTC', label: 'UTC' }

// Resolved once per page load and cached: `useSyncExternalStore` compares
// snapshots by identity, so returning a fresh object each call would re-render
// forever. The zone is also not something that changes under a live tab.
let resolved: TimeZoneState | undefined

function getSnapshot(): TimeZoneState {
  if (!resolved) {
    const id = resolveTimeZone()
    resolved = id === 'UTC' ? UTC : { id, label: formatTimeZoneLabel(id, new Date()) }
  }
  return resolved
}

function getServerSnapshot(): TimeZoneState {
  return UTC
}

/** No external source to watch — the zone is fixed for the life of the page. */
function subscribe(): () => void {
  return () => {}
}

/**
 * The browser's timezone, hydration-safe.
 *
 * Server rendering has no browser zone and must fall back to UTC, and the first
 * client render has to agree with that HTML or hydration mismatches. Passing a
 * distinct `getServerSnapshot` is how React is told the two legitimately differ:
 * it renders UTC through hydration, then re-renders once into the real zone.
 */
export function useTimeZone(): TimeZoneState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
