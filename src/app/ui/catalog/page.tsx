import { getRuntime } from '../../../lib/runtime'
import { CatalogView } from './CatalogView'

export const dynamic = 'force-dynamic'

export default function CatalogPage() {
  const { catalog, passthroughAsDefault } = getRuntime()
  return (
    <CatalogView
      catalog={catalog}
      env={process.env}
      passthroughAsDefault={passthroughAsDefault}
    />
  )
}
