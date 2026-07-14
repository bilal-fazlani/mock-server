import type { EndpointDef, SystemDef } from '../../../lib/catalog/types'
import { REAL_LABEL } from '../../../lib/config'
import { loadFixture } from '../../../lib/mock-engine/fixtures'
import { DYNAMIC_LABEL } from '../../../lib/scenarios'

export type ScenarioView = {
  key: string
  label: string
  isDefault: boolean
} & (
  | { kind: 'passthrough'; baseUrlEnv: string; url: string | null }
  | { kind: 'fixture'; json: string }
  | { kind: 'error'; message: string }
  | { kind: 'dynamic' }
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
  const dynamic: ScenarioView[] = endpoint.hasResolver
    ? [{ key: 'dynamic', label: DYNAMIC_LABEL, isDefault: false, kind: 'dynamic' }]
    : []

  return passthroughAsDefault
    ? [passthrough, ...declared, ...dynamic]
    : [...declared, ...dynamic, passthrough]
}
