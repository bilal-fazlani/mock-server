import type { Catalog, EndpointDef } from '../catalog/types'
import { isProfiledEndpoint, isScenarioDeclared } from '../scenarios'
import type { ScenarioSelection } from './store'

/**
 * Reads the profile form's per-endpoint scenario fields. Sequence fields
 * (`scenarioSequence:<endpoint>`, a JSON string array) take precedence over
 * the single-scenario radios (`scenario:<endpoint>`). Delta save: selections
 * equal to the implicit scenario are dropped, and a one-step sequence is
 * normalized to a single selection.
 */
export function parseEndpointScenarios(
  formData: FormData,
  catalog: Catalog,
  implicit: string,
): Record<string, ScenarioSelection> {
  const endpointScenarios: Record<string, ScenarioSelection> = {}
  for (const system of catalog.systems) {
    // Global endpoints are served from the global-mocks store and never consult
    // a profile, so a selection for one is dead data — skip them (this also
    // self-heals any legacy profile that persisted a global-endpoint pin).
    for (const endpoint of system.endpoints) {
      if (!isProfiledEndpoint(endpoint)) continue
      const selection = parseEndpointSelection(formData, endpoint, implicit)
      if (selection !== undefined) endpointScenarios[endpoint.name] = selection
    }
  }
  return endpointScenarios
}

function parseEndpointSelection(
  formData: FormData,
  endpoint: EndpointDef,
  implicit: string,
): ScenarioSelection | undefined {
  const sequenceRaw = formData.get(`scenarioSequence:${endpoint.name}`)
  if (typeof sequenceRaw === 'string') {
    const steps = parseSequence(endpoint, sequenceRaw)
    for (const step of steps) assertDeclared(endpoint, step)
    if (steps.length === 0) return undefined
    if (steps.length > 1) return steps
    return steps[0] === implicit ? undefined : steps[0]
  }

  const value = formData.get(`scenario:${endpoint.name}`)
  if (typeof value !== 'string' || value === '' || value === implicit) return undefined
  assertDeclared(endpoint, value)
  return value
}

function parseSequence(endpoint: EndpointDef, raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`endpoint "${endpoint.name}": scenario sequence is not valid JSON`)
  }
  if (!Array.isArray(parsed) || !parsed.every((step) => typeof step === 'string')) {
    throw new Error(`endpoint "${endpoint.name}": scenario sequence must be an array of strings`)
  }
  return parsed
}

function assertDeclared(endpoint: EndpointDef, scenario: string): void {
  if (!isScenarioDeclared(endpoint, scenario)) {
    throw new Error(`endpoint "${endpoint.name}": scenario "${scenario}" is not declared`)
  }
}
