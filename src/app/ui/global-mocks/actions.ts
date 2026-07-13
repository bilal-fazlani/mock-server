'use server'

import { redirect } from 'next/navigation'
import {
  clearGlobalMockScenario,
  getDb,
  upsertGlobalMockScenario,
} from '../../../lib/profiles/store'
import { getRuntime } from '../../../lib/runtime'
import { implicitScenario, isScenarioDeclared } from '../../../lib/scenarios'

export async function saveGlobalMocks(formData: FormData): Promise<void> {
  const { catalog, passthroughAsDefault } = getRuntime()
  const implicit = implicitScenario(passthroughAsDefault)
  const db = await getDb()

  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      if ((endpoint.mockType ?? 'profiled') !== 'global') continue
      const value = formData.get(`scenario:${system.slug}:${endpoint.name}`)
      if (typeof value !== 'string' || value === '') continue
      if (!isScenarioDeclared(endpoint, value)) {
        throw new Error(`endpoint "${endpoint.name}": scenario "${value}" is not declared`)
      }
      if (value === implicit) {
        await clearGlobalMockScenario(db, system.slug, endpoint.name)
      } else {
        await upsertGlobalMockScenario(db, {
          system: system.slug,
          endpoint: endpoint.name,
          scenario: value,
        })
      }
    }
  }

  redirect('/ui/global-mocks')
}
