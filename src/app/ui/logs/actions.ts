'use server'

import { revalidatePath } from 'next/cache'
import { clearLogs } from '../../../lib/logs/store'
import { getDb } from '../../../lib/profiles/store'

export async function clearLogsAction(formData: FormData): Promise<void> {
  const profileId = String(formData.get('profileId') ?? '').trim() || undefined
  await clearLogs(await getDb(), profileId)
  revalidatePath('/ui/logs')
}
