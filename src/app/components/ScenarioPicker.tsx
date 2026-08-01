import { FileCode, Globe, TriangleAlert } from 'lucide-react'
import type { ScenarioOption } from '../../lib/scenarios'
import { ScenarioDisclosure } from './ScenarioDisclosure'

type ScenarioTone = 'default' | 'nonDefault' | 'real'

function scenarioTone(key: string): ScenarioTone {
  if (key === 'real') return 'real'
  if (key !== 'default') return 'nonDefault'
  return 'default'
}

const cardBase =
  'relative flex items-center gap-2.5 max-w-full cursor-pointer select-none rounded-lg border border-border bg-card px-3.5 py-2 pl-2.5 transition-colors hover:border-muted-foreground ' +
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2'

const cardTone: Record<ScenarioTone, string> = {
  default: 'has-[:checked]:border-[var(--success)] has-[:checked]:bg-[var(--success-tint)]',
  nonDefault: 'has-[:checked]:border-[var(--warning-border)] has-[:checked]:bg-[var(--warning-bg)]',
  real: 'has-[:checked]:border-[#d92d20] has-[:checked]:bg-[rgba(217,45,32,0.12)]',
}

const dotBase = 'flex-none h-4 w-4 rounded-full border-2 border-border bg-card transition-colors'

const dotTone: Record<ScenarioTone, string> = {
  default: 'peer-checked:border-[5px] peer-checked:border-[var(--success)]',
  nonDefault: 'peer-checked:border-[5px] peer-checked:border-[var(--warning-text)]',
  real: 'peer-checked:border-[5px] peer-checked:border-[#d92d20]',
}

const iconTone: Record<ScenarioTone, string> = {
  default: 'peer-checked:text-[var(--success)]',
  nonDefault: 'peer-checked:text-[var(--warning-text)]',
  real: 'peer-checked:text-[#d92d20]',
}

// Resolvers and passthrough have no fixture body to preview, so the radio circle
// is spent on saying what the chip *is*: code, or the live upstream. Fixtures
// keep the dot. The slot sits right after the hidden `peer` radio either way, so
// the `peer-checked:` tone mechanics are identical.
function ScenarioSlot({ kind, tone }: { kind: ScenarioOption['kind']; tone: ScenarioTone }) {
  if (kind === 'fixture') {
    return <span aria-hidden="true" className={`${dotBase} ${dotTone[tone]}`} />
  }
  const Icon = kind === 'resolver' ? FileCode : Globe
  const label = kind === 'resolver' ? 'Resolved by code at request time' : 'Forwards to the live upstream'
  return (
    <span
      className={`inline-flex size-4 flex-none items-center justify-center text-muted-foreground transition-colors ${iconTone[tone]}`}
    >
      <Icon className="size-4" aria-label={label} role="img" />
    </span>
  )
}

export function ScenarioPicker({
  system,
  endpointName,
  endpointDisplayName,
  fieldName,
  scenarios,
  selected,
  unavailable,
}: {
  system: string
  endpointName: string
  endpointDisplayName: string
  fieldName?: string
  scenarios: Record<string, ScenarioOption>
  selected: string
  unavailable?: string[]
}) {
  const isUnavailable = (key: string) => unavailable?.includes(key) ?? false
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(scenarios).map(([key, option]) => {
        const tone = scenarioTone(key)
        const disabled = isUnavailable(key)
        const chip = (
          <label
            key={key}
            className={`${cardBase} ${cardTone[tone]}${disabled ? ' opacity-55 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name={fieldName ?? `scenario:${endpointName}`}
              value={key}
              defaultChecked={key === selected}
              disabled={disabled}
              className="peer absolute opacity-0 pointer-events-none"
            />
            <ScenarioSlot kind={option.kind} tone={tone} />
            <span
              className={`min-w-0 text-[0.9rem] font-medium [overflow-wrap:anywhere]${disabled ? ' line-through' : ''}`}
            >
              {option.label}
            </span>
            {option.kind === 'passthrough' && option.url == null && (
              <TriangleAlert
                className="size-3.5 flex-none text-destructive"
                aria-label={`${option.baseUrlEnv} is not set`}
                role="img"
              />
            )}
          </label>
        )
        // Dangling pins have nothing to disclose — no card, no modal.
        if (disabled) return chip
        return (
          <ScenarioDisclosure
            key={key}
            system={system}
            endpointName={endpointName}
            endpointDisplayName={endpointDisplayName}
            slug={key}
            option={option}
          >
            {chip}
          </ScenarioDisclosure>
        )
      })}
    </div>
  )
}
