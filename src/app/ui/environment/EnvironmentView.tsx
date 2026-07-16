import type { EnvironmentRow, EnvironmentStatus } from '../../../lib/environment'

export function EnvironmentView({ rows }: { rows: EnvironmentRow[] }) {
  const groups = groupRows(rows)

  return (
    <main className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Environment</h1>
        <span className="font-mono text-[0.82rem] text-muted-foreground">{rows.length} variables</span>
      </div>

      {groups.map((group) => (
        <section key={group.category} className="grid gap-2.5">
          <div className="flex items-baseline gap-2">
            <h2 className="m-0">{group.category}</h2>
            <span className="font-mono text-[0.78rem] text-muted-foreground">{group.rows.length}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-[0.9rem] max-[700px]:min-w-[760px]">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[26%]" />
                <col className="w-[12%]" />
                <col className="w-[38%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className="border-b border-border px-4 py-3 text-left text-[0.76rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                    Name
                  </th>
                  <th className="border-b border-border px-4 py-3 text-left text-[0.76rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                    Value
                  </th>
                  <th className="border-b border-border px-4 py-3 text-left text-[0.76rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                    Status
                  </th>
                  <th className="border-b border-border px-4 py-3 text-left text-[0.76rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="[&>tr:last-child>td]:border-b-0">
                {group.rows.map((row) => (
                  <tr key={row.name} className="hover:bg-[var(--accent-tint)]">
                    <td className="border-b border-border px-4 py-[13px] align-top">
                      <code className="font-semibold text-foreground [overflow-wrap:anywhere]">{row.name}</code>
                    </td>
                    <td className="border-b border-border px-4 py-[13px] align-top">
                      <code
                        className={`[overflow-wrap:anywhere] ${row.valueHidden ? 'text-muted-foreground' : 'text-secondary-foreground'}`}
                      >
                        {row.value}
                      </code>
                    </td>
                    <td className="border-b border-border px-4 py-[13px] align-top">
                      <span className={statusClassName(row.status)}>{statusLabel(row.status)}</span>
                    </td>
                    <td className="max-w-[320px] border-b border-border px-4 py-[13px] align-top text-secondary-foreground">
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
    <div className="grid gap-2">
      <span>{row.description}</span>
      <span className="grid gap-1">
        <span className="text-[0.78rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
          Allowed values:
        </span>
        <span className="flex flex-wrap gap-1.5">
          {row.possibleValues.map((value) => (
            <code
              key={value}
              className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-secondary-foreground"
            >
              {value}
            </code>
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
  const base = 'inline-flex min-w-[66px] items-center justify-center rounded-full px-2 py-[3px] text-xs font-semibold'
  if (status === 'set') return `${base} bg-[var(--success-tint)] text-[var(--success)]`
  if (status === 'default') return `${base} bg-[var(--accent-tint)] text-[var(--accent)]`
  return `${base} border border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]`
}
