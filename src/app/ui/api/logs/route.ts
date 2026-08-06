import { listLogEntries, listLogSummaries, parseValidationFilter } from '../../../../lib/logs/store'
import { getDb } from '../../../../lib/profiles/store'
import { toLogEntryView, toLogSummaryView } from '../../logs/types'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 200

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const requestedLimit = Number.parseInt(params.get('limit') ?? '', 10)
  const db = await getDb()
  const options = {
    profileId: params.get('profile') || undefined,
    endpoint: params.get('endpoint') || undefined,
    errorsOnly: params.get('errorsOnly') === '1',
    // An unrecognised value is dropped rather than rejected: the list is a
    // narrowing convenience, and a bad one should not fail the page's poll.
    validation: parseValidationFilter(params.get('validation')),
    logIdQuery: params.get('logId') || undefined,
    traceId: params.get('traceId') || undefined,
    sinceId: params.get('since') || undefined,
    beforeId: params.get('before') || undefined,
    limit: Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
      : undefined,
  }
  // Only the literal `full` opts into full payloads (request/response bodies
  // included); any other value — or an absent param — keeps the lighter
  // summary projection the live-polling list defaults to. Same lenient-param
  // style as `errorsOnly`/`validation` above.
  const entries =
    params.get('include') === 'full'
      ? (await listLogEntries(db, options)).map(toLogEntryView)
      : (await listLogSummaries(db, options)).map(toLogSummaryView)
  return Response.json({ entries })
}
