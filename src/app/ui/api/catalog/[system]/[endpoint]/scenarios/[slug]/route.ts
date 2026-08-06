import { findEndpointBySlug } from '../../../../../../../../lib/catalog/find'
import { errorResponse } from '../../../../../../../../lib/control-api/errors'
import { getRuntime } from '../../../../../../../../lib/runtime'
import { buildScenarioView } from '../../../../../../catalog/scenario-view'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ system: string; endpoint: string; slug: string }> }

// Serves the catalog-style rendering of ONE declared scenario for the picker
// response modal. `real` is implicit (no file) and dangling pins aren't
// declared, so both 404 here — the UI never offers the modal for them.
export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  const { system, endpoint, slug } = await params
  const { catalog, catalogDir } = getRuntime()
  const found = findEndpointBySlug(catalog, system, endpoint)
  if (!found) {
    return errorResponse(`unknown endpoint ${system}/${endpoint}`, 'unknown_endpoint', 404)
  }
  if (!Object.hasOwn(found.endpoint.scenarios, slug)) {
    return errorResponse(`unknown scenario "${slug}"`, 'unknown_scenario', 404)
  }
  const view = await buildScenarioView(found.system, found.endpoint, slug, catalogDir)
  return Response.json({ view })
}
