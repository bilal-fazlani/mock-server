import type { EnvironmentRow, EnvironmentStatus } from '../../../lib/environment'
import styles from './environment.module.css'

export function EnvironmentView({ rows }: { rows: EnvironmentRow[] }) {
  const groups = groupRows(rows)

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1>Environment</h1>
        <span className={styles.count}>{rows.length} variables</span>
      </div>

      {groups.map((group) => (
        <section key={group.category} className={styles.group}>
          <div className={styles.groupHeader}>
            <h2>{group.category}</h2>
            <span className={styles.groupCount}>{group.rows.length}</span>
          </div>
          <div className={styles.tableCard}>
            <table className={styles.table}>
              <colgroup>
                <col className={styles.nameColumn} />
                <col className={styles.valueColumn} />
                <col className={styles.statusColumn} />
                <col className={styles.descriptionColumn} />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <code className={styles.name}>{row.name}</code>
                    </td>
                    <td>
                      <code className={`${styles.value} ${row.valueHidden ? styles.hiddenValue : ''}`}>
                        {row.value}
                      </code>
                    </td>
                    <td>
                      <span className={`${styles.status} ${statusClassName(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className={styles.description}>
                      <DescriptionContent row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  )
}

function groupRows(
  rows: EnvironmentRow[],
): Array<{ category: string; rows: EnvironmentRow[] }> {
  const groups = new Map<string, EnvironmentRow[]>()
  for (const row of rows) {
    const group = groups.get(row.category) ?? []
    group.push(row)
    groups.set(row.category, group)
  }
  return [...groups.entries()].map(([category, groupedRows]) => ({
    category,
    rows: groupedRows,
  }))
}

function DescriptionContent({ row }: { row: EnvironmentRow }) {
  if (!row.possibleValues || row.possibleValues.length === 0) {
    return row.description
  }

  return (
    <div className={styles.descriptionStack}>
      <span>{row.description}</span>
      <span className={styles.allowedValues}>
        <span className={styles.allowedValuesLabel}>Allowed values:</span>
        <span className={styles.valueList}>
          {row.possibleValues.map((value) => (
            <code key={value}>{value}</code>
          ))}
        </span>
      </span>
    </div>
  )
}

function statusLabel(status: EnvironmentStatus): string {
  if (status === 'set') return 'Set'
  if (status === 'default') return 'Default'
  return 'Unset'
}

function statusClassName(status: EnvironmentStatus): string {
  if (status === 'set') return styles.statusSet
  if (status === 'default') return styles.statusDefault
  return styles.statusUnset
}
