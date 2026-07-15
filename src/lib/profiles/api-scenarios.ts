import type { Catalog, EndpointDef } from '../catalog/types'
import { isScenarioSelectable } from '../scenarios'
import type { ScenarioSelection } from './store'

export class InvalidScenarioSelectionError extends Error {}

/**
 * JSON-body counterpart to parseEndpointScenarios (form.ts). Validates every
 * endpoint name and scenario key against the catalog and applies the same
 * delta-save normalization: selections equal to the implicit scenario are
 * dropped, and a one-step sequence collapses to a single selection.
 */
export function parseEndpointScenariosFromJson(
  input: unknown,
  catalog: Catalog,
  implicit: string,
): Record<string, ScenarioSelection> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidScenarioSelectionError('endpointScenarios must be an object')
  }

  const byName = new Map<string, EndpointDef>()
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) byName.set(endpoint.name, endpoint)
  }

  const result: Record<string, ScenarioSelection> = {}
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    const endpoint = byName.get(name)
    if (!endpoint) throw new InvalidScenarioSelectionError(`unknown endpoint "${name}"`)
    const selection = normalizeSelection(endpoint, raw, implicit)
    if (selection !== undefined) result[name] = selection
  }
  return result
}

function normalizeSelection(
  endpoint: EndpointDef,
  raw: unknown,
  implicit: string,
): ScenarioSelection | undefined {
  if (Array.isArray(raw)) {
    if (!raw.every((step) => typeof step === 'string')) {
      throw new InvalidScenarioSelectionError(
        `endpoint "${endpoint.name}": scenario sequence must be an array of strings`,
      )
    }
    for (const step of raw) assertDeclared(endpoint, step)
    if (raw.length === 0) return undefined
    if (raw.length > 1) return raw
    return raw[0] === implicit ? undefined : raw[0]
  }
  if (typeof raw !== 'string') {
    throw new InvalidScenarioSelectionError(
      `endpoint "${endpoint.name}": scenario must be a string or array of strings`,
    )
  }
  if (raw === '' || raw === implicit) return undefined
  assertDeclared(endpoint, raw)
  return raw
}

function assertDeclared(endpoint: EndpointDef, scenario: string): void {
  if (!isScenarioSelectable(endpoint, scenario)) {
    throw new InvalidScenarioSelectionError(
      `endpoint "${endpoint.name}": scenario "${scenario}" is not declared`,
    )
  }
}
