import type { CompiledFn } from '../mock-engine/functions'

export interface ProfileKeyCaptureDef {
  namespace: string
  keySelector: string
}

export interface ScenarioMeta {
  /** Friendly name shown for the scenario (a resolver's `description` export
   * or a fixture's `description`, falling back to the slug). */
  label: string
  /** Optional secondary line shown under the label in the catalog detail view
   * (a resolver's `summary` export or a fixture's `summary`); present only when
   * the scenario declares a non-empty summary. */
  summary?: string
}

export interface EndpointDef {
  name: string
  displayName: string
  method: string
  path: string
  mockType?: 'global' | 'profiled'
  profileIdSelector?: string
  captureProfileKeys?: ProfileKeyCaptureDef[]
  scenarios: Record<string, ScenarioMeta>
  /**
   * Slugs in `scenarios` backed by a `<slug>.mjs` resolver instead of a
   * `<slug>.json` fixture. Always present; empty when the endpoint has none.
   */
  resolverScenarios: string[]
  /** Raw operation object (OpenAPI 3.1) for this endpoint, if present — from a
   * per-endpoint `_schema.json`, or assembled from the system `_spec` file. */
  schema?: Record<string, unknown>
}

export interface SystemDef {
  name: string
  slug: string
  baseUrlEnv: string
  endpoints: EndpointDef[]
}

export interface Catalog {
  systems: SystemDef[]
  /** Non-fatal load diagnostics (e.g. an endpoint with no matching spec
   *  operation). Populated by loadCatalog; empty when there are none. */
  warnings?: string[]
  /** Resolves the merged (catalog < system < endpoint, nearest wins) user
   * function table for a given endpoint. Backed by loadFunctions' resolveTable;
   * optional so existing test fixtures of this type keep compiling. */
  resolveFunctions?: (systemSlug: string, endpointName: string) => ReadonlyMap<string, CompiledFn>
}
