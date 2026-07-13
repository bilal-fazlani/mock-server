import { listLogEntries } from '../../../../lib/logs/store'
import { getDb } from '../../../../lib/profiles/store'
import { toLogEntryView } from '../../logs/types'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 200

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const requestedLimit = Number.parseInt(params.get('limit') ?? '', 10)
  const entries = await listLogEntries(await getDb(), {
    profileId: params.get('profile') || undefined,
    endpoint: params.get('endpoint') || undefined,
    errorsOnly: params.get('errorsOnly') === '1',
    logIdQuery: params.get('logId') || undefined,
    sinceId: params.get('since') || undefined,
    limit: Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : undefined,
  })
  return Response.json({ entries: entries.map(toLogEntryView) })
}
