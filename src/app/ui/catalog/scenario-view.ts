import fs from 'node:fs'
import type { EndpointDef, SystemDef } from '../../../lib/catalog/types'
import { unsetClientIdentityEnv } from '../../../lib/client-identity'
import { REAL_LABEL } from '../../../lib/config'
import { loadFixture } from '../../../lib/mock-engine/fixtures'
import { resolverFilePath } from '../../../lib/mock-engine/resolver'
import { highlight } from '../highlight'

export type ScenarioView = {
  slug: string
  displayName: string
  summary?: string
  isDefault: boolean
} & (
  | { kind: 'passthrough'; baseUrlEnv: string; url: string | null; clientIdentityUnset?: string[] }
  | { kind: 'fixture'; json: string; html: string }
  | { kind: 'error'; message: string }
  | { kind: 'resolver'; code: string; html: string }
)

export async function buildScenarioView(
  system: SystemDef,
  endpoint: EndpointDef,
  slug: string,
  catalogDir: string,
): Promise<ScenarioView> {
  const meta = endpoint.scenarios[slug]
  const { displayName, summary } = meta
  const isDefault = slug === 'default'
  if (endpoint.resolverScenarios.includes(slug)) {
    try {
      const code = fs.readFileSync(
        resolverFilePath(catalogDir, system.slug, endpoint.slug, slug),
        'utf8',
      )
      return { slug, displayName, ...(summary ? { summary } : {}), isDefault, kind: 'resolver' as const, code, html: await highlight(code, 'javascript') }
    } catch (err) {
      return { slug, displayName, ...(summary ? { summary } : {}), isDefault, kind: 'error' as const, message: (err as Error).message }
    }
  }
  try {
    const fixture = loadFixture(catalogDir, system.slug, endpoint.slug, slug)
    // `json` is the full fixture (status/headers/body) — kept for the header
    // status-chip parsing. `html` highlights the body only, matching the
    // body block the pre-highlighting UI rendered.
    const json = JSON.stringify(fixture, null, 2)
    const bodyJson = JSON.stringify(fixture.body, null, 2)
    return { slug, displayName, ...(summary ? { summary } : {}), isDefault, kind: 'fixture' as const, json, html: await highlight(bodyJson, 'json') }
  } catch (err) {
    return { slug, displayName, ...(summary ? { summary } : {}), isDefault, kind: 'error' as const, message: (err as Error).message }
  }
}

export async function buildScenarioViews(
  system: SystemDef,
  endpoint: EndpointDef,
  catalogDir: string,
  env: Record<string, string | undefined>,
  passthroughAsDefault: boolean,
): Promise<ScenarioView[]> {
  const declared: ScenarioView[] = await Promise.all(
    Object.keys(endpoint.scenarios).map((slug) => buildScenarioView(system, endpoint, slug, catalogDir)),
  )

  // "real" is never declared in the catalog — it's an implicit capability of
  // every endpoint.
  const passthrough: ScenarioView = {
    slug: 'real',
    displayName: REAL_LABEL,
    isDefault: passthroughAsDefault,
    kind: 'passthrough',
    baseUrlEnv: system.baseUrlEnv,
    url: env[system.baseUrlEnv] ?? null,
    clientIdentityUnset: unsetClientIdentityEnv(system, env),
  }

  return passthroughAsDefault ? [passthrough, ...declared] : [...declared, passthrough]
}
