import type { ScenarioKind } from '../../lib/scenarios'
import type { ScenarioView } from '../ui/catalog/scenario-view'

/** Ragged line widths, so the placeholder reads as code rather than as a bar chart. */
const CODE_LINES = [
  { width: '38%', indent: '0' },
  { width: '72%', indent: '1.25rem' },
  { width: '54%', indent: '1.25rem' },
  { width: '81%', indent: '1.25rem' },
  { width: '46%', indent: '1.25rem' },
  { width: '22%', indent: '0' },
]

/**
 * Stands in for {@link ScenarioContent} while the view is still being fetched.
 *
 * The server highlights the code with shiki before returning it, which on a
 * cold grammar load is slow enough to notice, so this deliberately mirrors the
 * real block — same bordered container, a comparable number of lines — rather
 * than showing a bare box. That keeps the dialog from jumping as much when the
 * content lands, and makes the wait legible as "code is coming".
 */
export function ScenarioContentSkeleton({ kind }: { kind: ScenarioKind }) {
  return (
    <div className="grid gap-2" role="status" aria-label="Loading response">
      {kind === 'resolver' && <div className="shimmer h-3.5 w-56 max-w-full rounded-[3px]" />}
      <div className="rounded-sm border border-border p-3">
        <div className="grid gap-2" aria-hidden="true">
          {CODE_LINES.map((line, i) => (
            <div
              key={i}
              className="shimmer h-3 rounded-[3px]"
              style={{ width: line.width, marginLeft: line.indent }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ScenarioContent({ scenario }: { scenario: ScenarioView }) {
  if (scenario.kind === 'passthrough') {
    return (
      <p className="font-mono text-[0.85rem] text-secondary-foreground">
        Passthrough - {scenario.url ?? `(env ${scenario.baseUrlEnv} not set)`}
      </p>
    )
  }

  if (scenario.kind === 'resolver') {
    return (
      <div className="grid gap-2">
        <p className="font-mono text-[0.85rem] text-secondary-foreground">
          Resolved at request time by <code>{scenario.key}.mjs</code>
        </p>
        <div
          className="code-scroll overflow-x-auto rounded-sm border border-border text-[0.8rem] [&_pre]:inline-block [&_pre]:min-w-full [&_pre]:p-3"
          dangerouslySetInnerHTML={{ __html: scenario.html }}
        />
      </div>
    )
  }

  if (scenario.kind === 'error') {
    return <p className="text-[var(--warning-text)]">{scenario.message}</p>
  }

  return <FixtureContent json={scenario.json} html={scenario.html} />
}

function FixtureContent({ json, html }: { json: string; html: string }) {
  const fixture = parseFixtureJson(json)
  const headers = fixture && isRecord(fixture.headers) ? Object.entries(fixture.headers).map(([name, value]) => [name, formatHeaderValue(value)] as const) : []

  return (
    <div className="grid gap-3">
      {headers.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <dl className="flex flex-wrap gap-1.5">
              {headers.map(([name, value]) => (
                <div
                  key={name}
                  className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-border bg-card"
                >
                  <dt className="min-w-0 inline-flex min-h-[28px] items-center border-r border-border bg-background px-2.5 py-1">
                    <code className="text-foreground font-bold">{name}</code>
                  </dt>
                  <dd className="min-w-0 inline-flex min-h-[28px] items-center bg-[var(--accent-tint)] px-2.5 py-1">
                    <code className="text-secondary-foreground [overflow-wrap:anywhere]">{value}</code>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
      <div
        className="code-scroll overflow-x-auto rounded-sm border border-border text-[0.8rem] [&_pre]:inline-block [&_pre]:min-w-full [&_pre]:p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export function parseFixtureJson(json: string): Record<string, unknown> | null {
  try {
    const fixture = JSON.parse(json) as unknown
    return isRecord(fixture) ? fixture : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatHeaderValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
