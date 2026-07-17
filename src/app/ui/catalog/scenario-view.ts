import fs from 'node:fs'
import type { EndpointDef, SystemDef } from '../../../lib/catalog/types'
import { REAL_LABEL } from '../../../lib/config'
import { loadFixture } from '../../../lib/mock-engine/fixtures'
import { resolverFilePath } from '../../../lib/mock-engine/resolver'
import { highlight } from './highlight'

export type ScenarioView = {
  key: string
  label: string
  summary?: string
  isDefault: boolean
} & (
  | { kind: 'passthrough'; baseUrlEnv: string; url: string | null }
  | { kind: 'fixture'; json: string; html: string }
  | { kind: 'error'; message: string }
  | { kind: 'resolver'; code: string; html: string }
)

export async function buildScenarioViews(
  system: SystemDef,
  endpoint: EndpointDef,
  catalogDir: string,
  env: Record<string, string | undefined>,
  passthroughAsDefault: boolean,
): Promise<ScenarioView[]> {
  const declared: ScenarioView[] = await Promise.all(
    Object.entries(endpoint.scenarios).map(async ([key, label]) => {
      const isDefault = key === 'default'
      const summary = endpoint.scenarioSummaries?.[key]
      if (endpoint.resolverScenarios.includes(key)) {
        try {
          const code = fs.readFileSync(
            resolverFilePath(catalogDir, system.slug, endpoint.name, key),
            'utf8',
          )
          return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'resolver' as const, code, html: await highlight(code, 'typescript') }
        } catch (err) {
          return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'error' as const, message: (err as Error).message }
        }
      }
      try {
        const fixture = loadFixture(catalogDir, system.slug, endpoint.name, key)
        // `json` is the full fixture (status/headers/body) — kept for the header
        // status-chip parsing. `html` highlights the body only, matching the
        // body block the pre-highlighting UI rendered.
        const json = JSON.stringify(fixture, null, 2)
        const bodyJson = JSON.stringify(fixture.body, null, 2)
        return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'fixture' as const, json, html: await highlight(bodyJson, 'json') }
      } catch (err) {
        return { key, label, ...(summary ? { summary } : {}), isDefault, kind: 'error' as const, message: (err as Error).message }
      }
    }),
  )

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
