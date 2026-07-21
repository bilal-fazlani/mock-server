'use client'

import dynamic from 'next/dynamic'
import '@scalar/api-reference-react/style.css'

// Scalar drives the DOM directly, so it must only ever render on the client.
const ApiReferenceReact = dynamic(
  () => import('@scalar/api-reference-react').then((m) => m.ApiReferenceReact),
  { ssr: false, loading: () => <div className="p-6 text-muted-foreground">Loading API docs…</div> },
)

export function ScalarDocs({ specUrl }: { specUrl: string }) {
  return <ApiReferenceReact configuration={{ url: specUrl }} />
}
