import type { EndpointDef, SystemDef } from '../../../lib/catalog/types'
import { REAL_LABEL } from '../../../lib/config'
import { loadFixture } from '../../../lib/mock-engine/fixtures'

export type ScenarioView = {
  key: string
  label: string
  isDefault: boolean
} & (
  | { kind: 'passthrough'; baseUrlEnv: string; url: string | null }
  | { kind: 'fixture'; json: string }
  | { kind: 'error'; message: string }
  | { kind: 'resolver' }
)

export function buildScenarioViews(
  system: SystemDef,
  endpoint: EndpointDef,
  catalogDir: string,
  env: Record<string, string | undefined>,
  passthroughAsDefault: boolean,
): ScenarioView[] {
  const declared: ScenarioView[] = Object.entries(endpoint.scenarios).map(([key, label]) => {
    const isDefault = key === 'default'
    if (endpoint.resolverScenarios.includes(key)) {
      return { key, label, isDefault, kind: 'resolver' }
    }
    try {
      const fixture = loadFixture(catalogDir, system.slug, endpoint.name, key)
      return { key, label, isDefault, kind: 'fixture', json: JSON.stringify(fixture, null, 2) }
    } catch (err) {
      return { key, label, isDefault, kind: 'error', message: (err as Error).message }
    }
  })

  // "real" is never declared in the catalog — it's an implicit capability of
  // every endpoint.
  const passthrough: ScenarioView = {
    key: 'real',
    label: REAL_LABEL,
    isDefault: passthroughAsDefault,
    kind: 'passthrough',
    baseUrlEnv: system.baseUrlEnv,
    url: env[system.baseUrlEnv] ?? null,
  }

  return passthroughAsDefault ? [passthrough, ...declared] : [...declared, passthrough]
}
