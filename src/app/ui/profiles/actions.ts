'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { insertLogEntry, newLogId } from '../../../lib/logs/store'
import { parseEndpointScenarios } from '../../../lib/profiles/form'
import {
  deleteProfile,
  getDb,
  resetScenarioProgress,
  upsertProfile,
} from '../../../lib/profiles/store'
import { getRuntime } from '../../../lib/runtime'
import { implicitScenario } from '../../../lib/scenarios'

async function writeAdminLog(
  profileId: string,
  adminAction: 'profile_saved' | 'progress_reset',
  adminEndpoint?: string,
): Promise<void> {
  try {
    await insertLogEntry(await getDb(), {
      logId: newLogId(),
      ts: new Date(),
      kind: 'admin',
      profileId,
      trace: { adminAction, ...(adminEndpoint && { adminEndpoint }) },
    })
  } catch (err) {
    console.warn('[mock-log] failed to write admin log entry:', err)
  }
}

export async function saveProfile(formData: FormData): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim() || crypto.randomUUID()
  const displayName = String(formData.get('displayName') ?? '').trim() || undefined

  const { catalog, passthroughAsDefault } = getRuntime()
  const implicit = implicitScenario(passthroughAsDefault)
  const endpointScenarios = parseEndpointScenarios(formData, catalog, implicit)

  await upsertProfile(await getDb(), { profileId, displayName, endpointScenarios })
  await writeAdminLog(profileId, 'profile_saved')
  redirect('/ui')
}

export async function deleteProfileAction(formData: FormData): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim()
  if (!profileId) throw new Error('profileId is required')

  await deleteProfile(await getDb(), profileId)
  redirect('/ui')
}

export async function resetScenarioProgressAction(
  endpointName: string,
  formData: FormData,
): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim()
  if (!profileId || !endpointName) throw new Error('profileId and endpoint are required')

  await resetScenarioProgress(await getDb(), profileId, endpointName)
  await writeAdminLog(profileId, 'progress_reset', endpointName)
  revalidatePath(`/ui/profiles/${encodeURIComponent(profileId)}`)
}
