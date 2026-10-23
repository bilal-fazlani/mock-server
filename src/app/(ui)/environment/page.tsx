import { buildEnvironmentRows } from '../../../lib/environment'
import { getRuntime } from '../../../lib/runtime'
import { EnvironmentView } from './EnvironmentView'

export const dynamic = 'force-dynamic'

export default function EnvironmentPage() {
  const { catalog } = getRuntime()
  return <EnvironmentView rows={buildEnvironmentRows(catalog, process.env)} />
}
