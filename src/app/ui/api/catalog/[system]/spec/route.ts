import fs from 'node:fs'
import path from 'node:path'
import { findSpecFile } from '../../../../../../lib/catalog/spec'
import { getRuntime } from '../../../../../../lib/runtime'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ system: string }> },
): Promise<Response> {
  const { system } = await params
  const { catalog, catalogDir } = getRuntime()
  const match = catalog.systems.find((s) => s.slug === system)
  if (!match?.hasSpec) return Response.json({ error: 'not_found' }, { status: 404 })
  const specFile = findSpecFile(path.join(catalogDir, system))
  if (!specFile) return Response.json({ error: 'not_found' }, { status: 404 })
  const contentType = specFile.endsWith('.json') ? 'application/json' : 'application/yaml'
  return new Response(fs.readFileSync(specFile, 'utf8'), {
    headers: { 'content-type': contentType },
  })
}
