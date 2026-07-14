import { getDb, listGlobalMockScenarios } from '../../../../lib/profiles/store'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const scenarios = await listGlobalMockScenarios(await getDb())
  return Response.json({ scenarios })
}
