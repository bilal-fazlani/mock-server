import { findEndpointBySlug } from '../../../../../../lib/catalog/find'
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
    return Response.json({ error: `unknown endpoint ${system}/${endpoint}` }, { status: 404 })
  }
  if (!isGlobalEndpoint(found.endpoint)) {
    return Response.json(
      { error: `endpoint "${endpoint}" is not a global mock` },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'request body is not valid JSON' }, { status: 400 })
  }
  const scenario = (body as { scenario?: unknown } | null)?.scenario
  if (typeof scenario !== 'string' || scenario === '') {
    return Response.json({ error: 'scenario is required' }, { status: 400 })
  }
  if (!isScenarioDeclared(found.endpoint, scenario)) {
    return Response.json({ error: `scenario "${scenario}" is not declared` }, { status: 400 })
  }

  await upsertGlobalMockScenario(await getDb(), { system, endpoint, scenario })
  return Response.json({ system, endpoint, scenario })
}

export async function DELETE(_request: Request, { params }: Ctx): Promise<Response> {
  const { system, endpoint } = await params
  const found = findEndpointBySlug(getRuntime().catalog, system, endpoint)
  if (!found) {
    return Response.json({ error: `unknown endpoint ${system}/${endpoint}` }, { status: 404 })
  }
  await clearGlobalMockScenario(await getDb(), system, endpoint)
  return new Response(null, { status: 204 })
}
