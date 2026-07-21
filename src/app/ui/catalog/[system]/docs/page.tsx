import { notFound } from 'next/navigation'
import { getRuntime } from '../../../../../lib/runtime'
import { ScalarDocs } from './ScalarDocs'

export const dynamic = 'force-dynamic'

export default async function SystemDocsPage({
  params,
}: {
  params: Promise<{ system: string }>
}) {
  const { system } = await params
  const { catalog } = getRuntime()
  const match = catalog.systems.find((s) => s.slug === system)
  if (!match?.hasSpec) notFound()
  return (
    <main className="flex flex-col gap-4">
      <h1>{match.name} — API docs</h1>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <ScalarDocs specUrl={`/ui/api/catalog/${match.slug}/spec`} />
      </div>
    </main>
  )
}
