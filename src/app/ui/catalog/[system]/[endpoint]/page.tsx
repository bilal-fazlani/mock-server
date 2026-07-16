import { notFound } from 'next/navigation'
import { findEndpointBySlug } from '../../../../../lib/catalog/find'
import { getRuntime } from '../../../../../lib/runtime'
import { EndpointView } from '../../EndpointView'
import { buildScenarioViews } from '../../scenario-view'

export const dynamic = 'force-dynamic'

export default async function EndpointDetailPage({
  params,
}: {
  params: Promise<{ system: string; endpoint: string }>
}) {
  const { system: systemParam, endpoint: endpointParam } = await params
  const { catalog, catalogDir, passthroughAsDefault } = getRuntime()
  const match = findEndpointBySlug(catalog, systemParam, endpointParam)
  if (!match) notFound()
  const scenarios = await buildScenarioViews(
    match.system,
    match.endpoint,
    catalogDir,
    process.env,
    passthroughAsDefault,
  )
  const baseUrl = process.env[match.system.baseUrlEnv] ?? null
  return (
    <EndpointView
      system={match.system}
      endpoint={match.endpoint}
      scenarios={scenarios}
      baseUrl={baseUrl}
      showBaseUrl={true}
      catalog={catalog}
    />
  )
}
