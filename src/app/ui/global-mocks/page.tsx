import { getDb, listGlobalMockScenarios } from '../../../lib/profiles/store'
import { getRuntime } from '../../../lib/runtime'
import styles from '../profiles/profilePage.module.css'
import { GlobalMocksForm } from './GlobalMocksForm'

export const dynamic = 'force-dynamic'

export default async function GlobalMocksPage() {
  const { catalog, passthroughAsDefault } = getRuntime()
  const selections = await listGlobalMockScenarios(await getDb())
  return (
    <main className={styles.page}>
      <h1>Global mocks</h1>
      <GlobalMocksForm
        catalog={catalog}
        selections={selections}
        passthroughAsDefault={passthroughAsDefault}
        env={process.env}
      />
    </main>
  )
}
