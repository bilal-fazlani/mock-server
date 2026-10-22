'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { resetDynamicHistory } from '../../../lib/dynamic/history-store'
import {
  clearGlobalMockScenario,
  getDb,
  upsertGlobalMockScenario,
} from '../../../lib/profiles/store'
import { getRuntime } from '../../../lib/runtime'
import { implicitScenario, isGlobalEndpoint, isScenarioDeclared } from '../../../lib/scenarios'

export async function saveGlobalMocks(formData: FormData): Promise<void> {
  const { catalog, passthroughAsDefault } = getRuntime()
  const implicit = implicitScenario(passthroughAsDefault)
  const db = await getDb()

  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      if (!isGlobalEndpoint(endpoint)) continue
      const value = formData.get(`scenario:${system.slug}:${endpoint.slug}`)
      if (typeof value !== 'string' || value === '') continue
      if (!isScenarioDeclared(endpoint, value)) {
        throw new Error(`endpoint "${endpoint.slug}": scenario "${value}" is not declared`)
      }
      if (value === implicit) {
        await clearGlobalMockScenario(db, system.slug, endpoint.slug)
      } else {
        await upsertGlobalMockScenario(db, {
          system: system.slug,
          endpoint: endpoint.slug,
          scenario: value,
        })
      }
    }
  }

  redirect('/ui/global-mocks')
}

export async function resetGlobalDynamicHistoryAction(
  systemSlug: string,
  endpointSlug: string,
): Promise<void> {
  if (!systemSlug || !endpointSlug) throw new Error('system and endpoint are required')

  await resetDynamicHistory(await getDb(), 'global', systemSlug, endpointSlug)
  revalidatePath('/ui/global-mocks')
}
