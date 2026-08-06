import { findEndpointBySlug } from '../../../../../../lib/catalog/find'
import { errorResponse } from '../../../../../../lib/control-api/errors'
import {
  clearGlobalMockScenario,
  getDb,
  upsertGlobalMockScenario,
} from '../../../../../../lib/profiles/store'
import { getRuntime } from '../../../../../../lib/runtime'
import { isGlobalEndpoint, isScenarioDeclared } from '../../../../../../lib/scenarios'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ system: string; endpoint: string }> }

export async function PUT(request: Request, { params }: Ctx): Promise<Response> {
  const { system, endpoint } = await params
  const found = findEndpointBySlug(getRuntime().catalog, system, endpoint)
  if (!found) {
    return errorResponse(`unknown endpoint ${system}/${endpoint}`, 'unknown_endpoint', 404)
  }
  if (!isGlobalEndpoint(found.endpoint)) {
    return errorResponse(`endpoint "${endpoint}" is not a global mock`, 'endpoint_not_global', 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('request body is not valid JSON', 'invalid_json', 400)
  }
  const scenario = (body as { scenario?: unknown } | null)?.scenario
  if (typeof scenario !== 'string' || scenario === '') {
    return errorResponse('scenario is required', 'scenario_required', 400)
  }
  if (!isScenarioDeclared(found.endpoint, scenario)) {
    return errorResponse(`scenario "${scenario}" is not declared`, 'scenario_not_declared', 400)
  }

  await upsertGlobalMockScenario(await getDb(), { system, endpoint, scenario })
  return Response.json({ system, endpoint, scenario })
}

export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { system, endpoint } = await params
  const found = findEndpointBySlug(getRuntime().catalog, system, endpoint)
  if (!found) {
    return errorResponse(`unknown endpoint ${system}/${endpoint}`, 'unknown_endpoint', 404)
  }
  await clearGlobalMockScenario(await getDb(), system, endpoint)
  return new Response(null, { status: 204 })
}
