import { getLogEntry } from '../../../../../lib/logs/store'
import { getDb } from '../../../../../lib/profiles/store'
import { toLogEntryView } from '../../../logs/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ logId: string }> },
): Promise<Response> {
  const { logId } = await params
  const entry = await getLogEntry(await getDb(), logId)
  if (!entry) return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ entry: toLogEntryView(entry) })
}
