import { listLogSummaries, parseValidationFilter } from '../../../../lib/logs/store'
import { getDb } from '../../../../lib/profiles/store'
import { toLogSummaryView } from '../../logs/types'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 200

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const requestedLimit = Number.parseInt(params.get('limit') ?? '', 10)
  const entries = await listLogSummaries(await getDb(), {
    profileId: params.get('profile') || undefined,
    endpoint: params.get('endpoint') || undefined,
    errorsOnly: params.get('errorsOnly') === '1',
    // An unrecognised value is dropped rather than rejected: the list is a
    // narrowing convenience, and a bad one should not fail the page's poll.
    validation: parseValidationFilter(params.get('validation')),
    logIdQuery: params.get('logId') || undefined,
    sinceId: params.get('since') || undefined,
    beforeId: params.get('before') || undefined,
    limit: Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : undefined,
  })
  return Response.json({ entries: entries.map(toLogSummaryView) })
}
