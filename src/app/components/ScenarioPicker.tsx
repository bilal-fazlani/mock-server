import styles from './ScenarioPicker.module.css'

function scenarioClassName(key: string): string {
  if (key === 'real') return `${styles.card} ${styles.real}`
  if (key !== 'default') return `${styles.card} ${styles.nonDefault}`
  return styles.card
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
    <div className={styles.group}>
      {Object.entries(scenarios).map(([key, label]) => (
        <label
          key={key}
          className={`${scenarioClassName(key)}${isUnavailable(key) ? ` ${styles.unavailable}` : ''}`}
        >
          <input
            type="radio"
            name={fieldName ?? `scenario:${endpointName}`}
            value={key}
            defaultChecked={key === selected}
            disabled={isUnavailable(key)}
            className={styles.input}
          />
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>{label}</span>
        </label>
      ))}
    </div>
  )
}
