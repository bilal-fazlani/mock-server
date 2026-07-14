import { resetDynamicHistory } from '../../../../../../lib/dynamic/history-store'
import { writeAdminLog } from '../../../../../../lib/logs/admin-log'
import { getDb, resetScenarioProgress } from '../../../../../../lib/profiles/store'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ profileId: string }> }

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params

  let endpoint: string | undefined
  try {
    const body = (await request.json()) as { endpoint?: unknown } | null
    if (typeof body?.endpoint === 'string' && body.endpoint !== '') endpoint = body.endpoint
  } catch {
    // No body / malformed JSON → whole-profile reset.
  }

  const db = await getDb()
  await resetScenarioProgress(db, profileId, endpoint)
  await resetDynamicHistory(db, 'profile', profileId, endpoint)
  await writeAdminLog(db, profileId, 'progress_reset', endpoint)
  return new Response(null, { status: 204 })
}
