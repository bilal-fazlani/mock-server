export interface ProfileKeyCaptureDef {
  namespace: string
  keySelector: string
}

export interface EndpointDef {
  name: string
  displayName: string
  method: string
  path: string
  mockType?: 'global' | 'profiled'
  profileIdSelector?: string
  captureProfileKeys?: ProfileKeyCaptureDef[]
  scenarios: Record<string, string>
  /**
   * Optional secondary line per scenario slug, shown under the friendly name.
   * Populated from a resolver's `summary` export or a fixture's `summary`
   * field; a slug is present only when it declares a non-empty summary.
   */
  scenarioSummaries?: Record<string, string>
  /**
   * Slugs in `scenarios` backed by a `<slug>.ts` resolver instead of a
   * `<slug>.json` fixture. Always present; empty when the endpoint has none.
   */
  resolverScenarios: string[]
  /** Raw parsed _schema.json (OpenAPI 3.1 operation object), if present. */
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
}
