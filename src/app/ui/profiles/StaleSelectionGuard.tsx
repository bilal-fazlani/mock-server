'use client'

import { useEffect, useState } from 'react'
import { unresolvedStaleEndpoints } from '../../../lib/profiles/stale'
import { Alert } from '../../components/Alert'

/**
 * Client-side guard that blocks the profile Save button while any stale
 * (dangling) scenario pin is still selected. It never mutates the selection —
 * it only disables Save and shows a banner until the user picks a valid
 * scenario for every stale endpoint. The server-side `assertDeclared`
 * (parseEndpointScenarios) remains the no-JS backstop.
 */
export function StaleSelectionGuard({
  formId,
  saveButtonId,
  staleByEndpoint,
}: {
  formId: string
  saveButtonId: string
  staleByEndpoint: Record<string, string[]>
}) {
  const [blocked, setBlocked] = useState(true)

  useEffect(() => {
    const form = document.getElementById(formId)
    const saveButton = document.getElementById(saveButtonId) as HTMLButtonElement | null
    if (!form || !saveButton) return

    const readCurrent = (endpointName: string): string[] => {
      const inputs = Array.from(form.querySelectorAll('input'))
      const sequence = inputs.find((i) => i.name === `scenarioSequence:${endpointName}`)
      if (sequence) {
        try {
          const parsed: unknown = JSON.parse(sequence.value)
          if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
        } catch {
          /* fall through to empty */
        }
        return []
      }
      const checked = inputs.find(
        (i) => i.name === `scenario:${endpointName}` && i.type === 'radio' && i.checked,
      )
      return checked ? [checked.value] : []
    }

    const recompute = () => {
      const currentSelections: Record<string, string[]> = {}
      for (const endpointName of Object.keys(staleByEndpoint)) {
        currentSelections[endpointName] = readCurrent(endpointName)
      }
      const unresolved = unresolvedStaleEndpoints(staleByEndpoint, currentSelections)
      const isBlocked = unresolved.length > 0
      saveButton.disabled = isBlocked
      setBlocked(isBlocked)
    }

    // React updates controlled hidden fields (sequence mode) after its render,
    // so defer the read one frame to observe the post-update DOM.
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(recompute)
    }

    recompute()
    form.addEventListener('change', schedule)
    form.addEventListener('input', schedule)
    form.addEventListener('click', schedule)

    return () => {
      cancelAnimationFrame(frame)
      form.removeEventListener('change', schedule)
      form.removeEventListener('input', schedule)
      form.removeEventListener('click', schedule)
      saveButton.disabled = false
    }
  }, [formId, saveButtonId, staleByEndpoint])

  if (!blocked) return null
  return (
    <Alert>Resolve the stale selection(s) highlighted above before saving.</Alert>
  )
}
