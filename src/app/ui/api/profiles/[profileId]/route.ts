import { errorResponse } from '../../../../../lib/control-api/errors'
import { writeAdminLog } from '../../../../../lib/logs/admin-log'
import {
  InvalidScenarioSelectionError,
  parseEndpointScenariosFromJson,
} from '../../../../../lib/profiles/api-scenarios'
import { deleteProfile, getDb, getProfile, upsertProfile } from '../../../../../lib/profiles/store'
import { getRuntime } from '../../../../../lib/runtime'
import { implicitScenario } from '../../../../../lib/scenarios'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ profileId: string }> }

export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params
  const profile = await getProfile(await getDb(), profileId)
  if (!profile) return errorResponse('not_found', 'profile_not_found', 404)
  return Response.json(profile)
}

export async function PUT(request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('request body is not valid JSON', 'invalid_json', 400)
  }
  const raw = body as { displayName?: unknown; endpointScenarios?: unknown } | null

  const { catalog, passthroughAsDefault } = getRuntime()
  const implicit = implicitScenario(passthroughAsDefault)

  let endpointScenarios
  try {
    endpointScenarios = parseEndpointScenariosFromJson(
      raw?.endpointScenarios ?? {},
      catalog,
      implicit,
    )
  } catch (err) {
    if (err instanceof InvalidScenarioSelectionError) {
      return errorResponse(err.message, 'invalid_scenario_selection', 400)
    }
    throw err
  }

  const displayName =
    typeof raw?.displayName === 'string' && raw.displayName.trim() !== ''
      ? raw.displayName.trim()
      : undefined

  const db = await getDb()
  await upsertProfile(db, { profileId, displayName, endpointScenarios })
  await writeAdminLog(db, profileId, 'profile_saved')
  return Response.json(await getProfile(db, profileId))
}

export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { profileId } = await params
  await deleteProfile(await getDb(), profileId)
  return new Response(null, { status: 204 })
}
