import type { LogSummaryView } from './types'

/**
 * Whether this entry names a profile that did not exist when the request ran.
 *
 * Read off the entry rather than looked up, because the entry already records
 * it and a lookup would answer a subtly different question. Two ways the router
 * reports it, one per `UNMOCKED_USERS` policy:
 *
 * - `DEFAULT_MOCK` / `REAL` serve something anyway and mark the choice
 *   `scenarioSource: 'unmocked_policy'`.
 * - `ERROR` fails the request with `profile_not_found`.
 *
 * There is deliberately no check for "does it exist *now*": deleting a profile
 * also deletes its request logs (see `deleteProfile`), so a row naming a
 * profile that has since been removed cannot survive to be rendered. That
 * leaves the never-existed case as the only one, which is exactly what these
 * two signals cover — and unlike a live lookup, it stays true to what the log
 * is a record of.
 */
export function profileWasMissing(
  entry: Pick<LogSummaryView, 'profileId' | 'trace' | 'error'>,
): boolean {
  if (!entry.profileId) return false
  if (entry.trace?.scenarioSource === 'unmocked_policy') return true
  return entry.error?.code === 'profile_not_found'
}
