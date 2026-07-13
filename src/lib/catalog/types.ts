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
