import { notFound } from 'next/navigation'

// Every /ui page declares force-dynamic (tests/ui/force-dynamic.test.ts
// enforces it). This catch-all is already request-dynamic, so the declaration
// only keeps the invariant uniform.
export const dynamic = 'force-dynamic'

// Any unmatched /ui/* path resolves inside the UI subtree and renders the UI
// 404 — it must never fall through to the root mock catch-all.
export default function UiNotFound() {
  notFound()
}
