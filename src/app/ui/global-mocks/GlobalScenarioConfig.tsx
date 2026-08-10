'use client'

import { useState } from 'react'
import { involvesResolver, type ScenarioOption } from '../../../lib/scenarios'
import { ResetButton } from '../../components/ResetButton'
import { ScenarioPicker } from '../../components/ScenarioPicker'

/**
 * The global-mocks counterpart of the profile form's `ScenarioConfig`: the
 * scenario radios plus the footer that hangs off whatever is *picked*.
 *
 * It exists to make "Reset resolver history" appear the moment a resolver-backed
 * scenario is selected, exactly as it does on a profile — the rest of
 * `GlobalMocksForm` stays a server component, so this is the smallest island
 * that can hold the live selection.
 */
export function GlobalScenarioConfig({
  system,
  endpointName,
  endpointDisplayName,
  fieldName,
  scenarios,
  selected,
  unavailable,
  resetDynamicAction,
  children,
}: {
  system: string
  endpointName: string
  endpointDisplayName: string
  /** Radio group name — the form is one big grid, so it is endpoint-scoped. */
  fieldName: string
  scenarios: Record<string, ScenarioOption>
  /** The effective selection to start from: stored, or the implicit default. */
  selected: string
  unavailable?: string[]
  /** Server action for the reset-resolver-history button, bound to this endpoint. */
  resetDynamicAction: (formData: FormData) => Promise<void>
  /** Footer content rendered beside the reset button — the catalog link. */
  children?: React.ReactNode
}) {
  const [picked, setPicked] = useState(selected)

  return (
    <>
      <div
        onChange={(e) => {
          const target = e.target as HTMLInputElement
          if (target?.name === fieldName) setPicked(target.value)
        }}
      >
        <ScenarioPicker
          system={system}
          endpointName={endpointName}
          endpointDisplayName={endpointDisplayName}
          fieldName={fieldName}
          scenarios={scenarios}
          selected={selected}
          unavailable={unavailable}
        />
      </div>
      <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2.5">
        {involvesResolver(scenarios, picked) && (
          <ResetButton formAction={resetDynamicAction}>Reset resolver history</ResetButton>
        )}
        {children}
      </div>
    </>
  )
}
