import { notFound } from 'next/navigation'

// Any unmatched /ui/* path resolves inside the UI subtree and renders the UI
// 404 — it must never fall through to the root mock catch-all.
export default function UiNotFound() {
  notFound()
}
