import type { EndpointDef, SystemDef } from './catalog/types'
import { REAL_LABEL, REAL_SUMMARY } from './config'

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

export type ScenarioKind = 'fixture' | 'resolver' | 'passthrough'

export interface ScenarioOption {
  /** Friendly name (ScenarioMeta.label, or the dangling placeholder). */
  label: string
  /** ScenarioMeta.summary, or the fixed auto-summary for `real`. */
  summary?: string
  /** Fixture HTTP status; absent for resolvers, passthrough, and dangling pins. */
  status?: number
  kind: ScenarioKind
  /** Passthrough only: resolved upstream URL, or null when `baseUrlEnv` isn't set. */
  url?: string | null
  /** Passthrough only: the env var name backing `url`. */
  baseUrlEnv?: string
}

export function scenariosWithPassthrough(
  endpoint: EndpointDef,
  passthroughAsDefault: boolean,
  system: SystemDef,
  env: Record<string, string | undefined>,
): Record<string, ScenarioOption> {
  const declared: Record<string, ScenarioOption> = {}
  for (const [slug, meta] of Object.entries(endpoint.scenarios)) {
    declared[slug] = {
      label: meta.label,
      ...(meta.summary ? { summary: meta.summary } : {}),
      ...(meta.status !== undefined ? { status: meta.status } : {}),
      kind: endpoint.resolverScenarios.includes(slug) ? 'resolver' : 'fixture',
    }
  }
  const { default: defaultOption, ...rest } = declared
  const ordered =
    defaultOption === undefined ? declared : { [DEFAULT_SCENARIO]: defaultOption, ...rest }
  const real: ScenarioOption = {
    label: REAL_LABEL,
    summary: REAL_SUMMARY,
    kind: 'passthrough',
    baseUrlEnv: system.baseUrlEnv,
    url: env[system.baseUrlEnv] ?? null,
  }
  return passthroughAsDefault
    ? { [REAL_SCENARIO]: real, ...ordered }
    : { ...ordered, [REAL_SCENARIO]: real }
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
  offered: Record<string, ScenarioOption>,
  selection: string | string[] | undefined,
): { options: Record<string, ScenarioOption>; unavailable: string[] } {
  const selected = selection === undefined ? [] : Array.isArray(selection) ? selection : [selection]
  const options = { ...offered }
  const unavailable: string[] = []
  for (const slug of selected) {
    if (slug in options || unavailable.includes(slug)) continue
    options[slug] = { label: danglingScenarioLabel(slug), kind: 'fixture' }
    unavailable.push(slug)
  }
  return { options, unavailable }
}
