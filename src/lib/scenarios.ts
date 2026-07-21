import type { EndpointDef } from './catalog/types'
import { REAL_LABEL } from './config'

export const DEFAULT_SCENARIO = 'default'
export const REAL_SCENARIO = 'real'

export function implicitScenario(passthroughAsDefault: boolean): string {
  return passthroughAsDefault ? REAL_SCENARIO : DEFAULT_SCENARIO
}

/**
 * `mockType` defaults to `profiled` when unset. These are the single source of
 * truth for that default so every surface — the router, the global-mocks page,
 * and the profile form — agrees on which endpoints a profile can address. A
 * global endpoint is served from the global-mocks store and never consults a
 * profile, so it must not appear in the profile form.
 */
export function isGlobalEndpoint(endpoint: EndpointDef): boolean {
  return (endpoint.mockType ?? 'profiled') === 'global'
}

export function isProfiledEndpoint(endpoint: EndpointDef): boolean {
  return !isGlobalEndpoint(endpoint)
}

export function scenariosWithPassthrough(
  endpoint: EndpointDef,
  passthroughAsDefault: boolean,
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const [slug, meta] of Object.entries(endpoint.scenarios)) labels[slug] = meta.label
  const { default: defaultLabel, ...rest } = labels
  const declared =
    defaultLabel === undefined ? labels : { [DEFAULT_SCENARIO]: defaultLabel, ...rest }
  return passthroughAsDefault
    ? { [REAL_SCENARIO]: REAL_LABEL, ...declared }
    : { ...declared, [REAL_SCENARIO]: REAL_LABEL }
}

/**
 * Single source of truth for "is this step selectable on this endpoint" — a
 * declared scenario (fixture- or resolver-backed; both live in
 * endpoint.scenarios) or the implicit `real` passthrough. Used by every
 * write/validation path so the UI and API stay consistent with the router.
 */
export function isScenarioDeclared(endpoint: EndpointDef, scenario: string): boolean {
  return scenario === REAL_SCENARIO || scenario in endpoint.scenarios
}

export function danglingScenarioLabel(slug: string): string {
  return `${slug} — unavailable`
}

export function scenarioOptionsWithDangling(
  offered: Record<string, string>,
  selection: string | string[] | undefined,
): { options: Record<string, string>; unavailable: string[] } {
  const selected = selection === undefined ? [] : Array.isArray(selection) ? selection : [selection]
  const options = { ...offered }
  const unavailable: string[] = []
  for (const slug of selected) {
    if (slug in options || unavailable.includes(slug)) continue
    options[slug] = danglingScenarioLabel(slug)
    unavailable.push(slug)
  }
  return { options, unavailable }
}
