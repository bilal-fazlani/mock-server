import type { EndpointDef } from './catalog/types'
import { REAL_LABEL } from './config'

export const DEFAULT_SCENARIO = 'default'
export const REAL_SCENARIO = 'real'
export const DYNAMIC_SCENARIO = 'dynamic'
export const DYNAMIC_LABEL = 'Dynamic'

export function implicitScenario(passthroughAsDefault: boolean): string {
  return passthroughAsDefault ? REAL_SCENARIO : DEFAULT_SCENARIO
}

export function scenariosWithPassthrough(
  endpoint: EndpointDef,
  passthroughAsDefault: boolean,
): Record<string, string> {
  const { default: defaultLabel, ...rest } = endpoint.scenarios
  const declared =
    defaultLabel === undefined ? endpoint.scenarios : { [DEFAULT_SCENARIO]: defaultLabel, ...rest }
  const withDynamic = endpoint.hasResolver
    ? { ...declared, [DYNAMIC_SCENARIO]: DYNAMIC_LABEL }
    : declared
  return passthroughAsDefault
    ? { [REAL_SCENARIO]: REAL_LABEL, ...withDynamic }
    : { ...withDynamic, [REAL_SCENARIO]: REAL_LABEL }
}

export function isScenarioDeclared(endpoint: EndpointDef, scenario: string): boolean {
  return scenario === REAL_SCENARIO || scenario in endpoint.scenarios
}

export function danglingScenarioLabel(slug: string): string {
  return slug === DYNAMIC_SCENARIO ? 'Dynamic — unavailable (no _dynamic.ts)' : `${slug} — unavailable`
}
