'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { resetDynamicHistory } from '../../../lib/dynamic/history-store'
import { writeAdminLog } from '../../../lib/logs/admin-log'
import { parseEndpointScenarios } from '../../../lib/profiles/form'
import {
  deleteProfile,
  getDb,
  resetScenarioProgress,
  slideProfileExpiryById,
  upsertProfile,
} from '../../../lib/profiles/store'
import { getRuntime } from '../../../lib/runtime'
import { implicitScenario } from '../../../lib/scenarios'

export async function saveProfile(formData: FormData): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim() || crypto.randomUUID()
  const displayName = String(formData.get('displayName') ?? '').trim() || undefined

  const { catalog, passthroughAsDefault } = getRuntime()
  const implicit = implicitScenario(passthroughAsDefault)
  const endpointScenarios = parseEndpointScenarios(formData, catalog, implicit)

  await upsertProfile(await getDb(), { profileId, displayName, endpointScenarios })
  await writeAdminLog(await getDb(), profileId, 'profile_saved')
  redirect('/ui')
}

export async function deleteProfileAction(formData: FormData): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim()
  if (!profileId) throw new Error('profileId is required')

  await deleteProfile(await getDb(), profileId)
  redirect('/ui')
}

export async function resetScenarioProgressAction(
  endpointSlug: string,
  formData: FormData,
): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim()
  if (!profileId || !endpointSlug) throw new Error('profileId and endpoint are required')

  await resetScenarioProgress(await getDb(), profileId, endpointSlug)
  await slideProfileExpiryById(await getDb(), profileId)
  await writeAdminLog(await getDb(), profileId, 'progress_reset', endpointSlug)
  revalidatePath(`/ui/profiles/${encodeURIComponent(profileId)}`)
}

export async function resetDynamicHistoryAction(
  endpointSlug: string,
  formData: FormData,
): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim()
  if (!profileId || !endpointSlug) throw new Error('profileId and endpoint are required')

  await resetDynamicHistory(await getDb(), 'profile', profileId, endpointSlug)
  await slideProfileExpiryById(await getDb(), profileId)
  await writeAdminLog(await getDb(), profileId, 'progress_reset', endpointSlug)
  revalidatePath(`/ui/profiles/${encodeURIComponent(profileId)}`)
}
