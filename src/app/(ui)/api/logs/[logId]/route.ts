import { errorResponse } from '../../../../../lib/control-api/errors'
import { getLogEntry } from '../../../../../lib/logs/store'
import { getDb } from '../../../../../lib/profiles/store'
import { buildBodyHtml } from '../../../logs/body-html'
import { toLogEntryView } from '../../../logs/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ logId: string }> },
): Promise<Response> {
  const { logId } = await params
  const entry = await getLogEntry(await getDb(), logId)
  if (!entry) return errorResponse('not_found', 'log_not_found', 404)

  const bodyHtml = await buildBodyHtml(entry.request, entry.response)
  return Response.json({ entry: toLogEntryView(entry), ...(bodyHtml && { bodyHtml }) })
}
