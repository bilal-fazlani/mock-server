import { getRuntime } from '../../../lib/runtime'
import { CatalogView } from './CatalogView'

export const dynamic = 'force-dynamic'

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ system?: string | string[] }>
}) {
  const { system } = await searchParams
  const { catalog, passthroughAsDefault } = getRuntime()
  return (
    <CatalogView
      catalog={catalog}
      env={process.env}
      passthroughAsDefault={passthroughAsDefault}
      selectedSystem={Array.isArray(system) ? system[0] : system}
    />
  )
}
