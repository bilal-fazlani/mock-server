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

export function ScenarioPicker({
  endpointName,
  fieldName,
  scenarios,
  selected,
  unavailable,
}: {
  endpointName: string
  fieldName?: string
  scenarios: Record<string, string>
  selected: string
  unavailable?: string[]
}) {
  const isUnavailable = (key: string) => unavailable?.includes(key) ?? false
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(scenarios).map(([key, label]) => {
        const tone = scenarioTone(key)
        const disabled = isUnavailable(key)
        return (
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
            <span aria-hidden="true" className={`${dotBase} ${dotTone[tone]}`} />
            <span
              className={`min-w-0 text-[0.9rem] font-medium [overflow-wrap:anywhere]${disabled ? ' line-through' : ''}`}
            >
              {label}
            </span>
          </label>
        )
      })}
    </div>
  )
}
