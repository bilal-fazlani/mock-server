'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { StatusPill } from '../../components/StatusPill'
import type { ScenarioView } from './scenario-view'

export function EndpointScenarios({ scenarios }: { scenarios: ScenarioView[] }) {
  const scenarioKeys = useMemo(() => scenarios.map((scenario) => scenario.key), [scenarios])
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())

  function expandAll() {
    setCollapsedKeys(new Set())
  }

  function collapseAll() {
    setCollapsedKeys(new Set(scenarioKeys))
  }

  function toggleScenario(key: string) {
    setCollapsedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[0.95rem]">Scenarios</h2>
        {scenarios.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="bg-card px-2.5 py-1.5 text-[0.82rem] font-[550] text-secondary-foreground hover:border-muted-foreground hover:text-foreground"
              onClick={expandAll}
            >
              Expand all
            </button>
            <button
              type="button"
              className="bg-card px-2.5 py-1.5 text-[0.82rem] font-[550] text-secondary-foreground hover:border-muted-foreground hover:text-foreground"
              onClick={collapseAll}
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      {scenarios.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-[18px] py-4 text-secondary-foreground">
          No scenarios declared.
        </p>
      ) : (
        <div className="grid gap-3">
          {scenarios.map((scenario, index) => {
            const isOpen = !collapsedKeys.has(scenario.key)
            const panelId = scenarioPanelId(scenario.key, index)
            const statusValue = scenario.kind === 'fixture' ? fixtureStatusValue(scenario.json) : null
            return (
              <article
                key={scenario.key}
                className="overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-colors duration-150 has-[:hover]:border-[rgba(var(--accent-rgb),0.58)] has-[:hover]:bg-[var(--accent-tint)] has-[:focus-visible]:border-[rgba(var(--accent-rgb),0.58)] has-[:focus-visible]:bg-[var(--accent-tint)]"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2.5 rounded-none border-0 bg-transparent px-3.5 py-3 text-left text-foreground focus-visible:-outline-offset-2"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleScenario(scenario.key)}
                >
                  <span className="inline-flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`size-[9px] flex-none border-b-2 border-r-2 border-muted-foreground transition-transform duration-150 ${isOpen ? 'rotate-45' : '-rotate-45'}`}
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <span className="text-[0.95rem] font-semibold text-foreground">{scenario.label}</span>
                        <StatusPill value={statusValue} />
                      </span>
                      {scenario.summary && (
                        <span className="text-[0.82rem] font-normal leading-[1.35] text-muted-foreground [overflow-wrap:anywhere]">
                          {scenario.summary}
                        </span>
                      )}
                    </span>
                  </span>
                  {scenario.isDefault && (
                    <span className="ml-auto inline-flex flex-none items-center justify-end gap-1.5 text-[0.78rem] font-[750] text-[var(--success)]">
                      <Check className="size-[15px] stroke-[2.6]" aria-hidden="true" />
                      Default
                    </span>
                  )}
                </button>
                <div id={panelId} className="pl-[33px] pr-3.5 pb-3.5 pt-0" hidden={!isOpen}>
                  <ScenarioContent scenario={scenario} />
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ScenarioContent({ scenario }: { scenario: ScenarioView }) {
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
          className="overflow-x-auto rounded-sm border border-border text-[0.8rem] [&_pre]:p-3"
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
        className="overflow-x-auto rounded-sm border border-border text-[0.8rem] [&_pre]:p-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function fixtureStatusValue(json: string): unknown {
  return parseFixtureJson(json)?.status ?? null
}

function parseFixtureJson(json: string): Record<string, unknown> | null {
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

function scenarioPanelId(key: string, index: number): string {
  return `scenario-${index}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}
