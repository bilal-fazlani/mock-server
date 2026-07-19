'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
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
            const status = scenario.kind === 'fixture' ? fixtureStatusFromJson(scenario.json) : null
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
                        {status && (
                          <span
                            className={`inline-flex min-h-6 items-center rounded-full border px-2 py-[3px] font-mono text-[0.72rem] font-bold leading-[1.2] ${statusToneClassName(status.tone)}`}
                          >
                            {status.label}
                          </span>
                        )}
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

function fixtureStatusFromJson(json: string): FormattedStatus | null {
  const fixture = parseFixtureJson(json)
  return fixture ? formatStatus(fixture.status) : null
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

function formatMetadataValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function formatHeaderValue(value: unknown): string {
  return formatMetadataValue(value) ?? ''
}

type StatusTone = 'success' | 'redirect' | 'error' | 'neutral'

type FormattedStatus = {
  label: string
  tone: StatusTone
}

function formatStatus(value: unknown): FormattedStatus | null {
  const rawStatus = formatMetadataValue(value)
  if (!rawStatus) return null

  const statusCode = Number(rawStatus)
  if (!Number.isInteger(statusCode)) return { label: `HTTP ${rawStatus}`, tone: 'neutral' }

  const reasonPhrase = STATUS_REASONS[statusCode]
  return {
    label: reasonPhrase ? `HTTP ${statusCode} ${reasonPhrase}` : `HTTP ${statusCode}`,
    tone: statusTone(statusCode),
  }
}

// Status tone convention (everywhere): 2xx green, 3xx yellow, 4xx/5xx red.
function statusTone(statusCode: number): StatusTone {
  if (statusCode >= 200 && statusCode <= 299) return 'success'
  if (statusCode >= 300 && statusCode <= 399) return 'redirect'
  if (statusCode >= 400 && statusCode <= 599) return 'error'
  return 'neutral'
}

function statusToneClassName(tone: StatusTone): string {
  if (tone === 'success') return 'border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)] text-[var(--success)]'
  if (tone === 'redirect') return 'border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]'
  if (tone === 'error') return 'border-[#d92d20] bg-[rgba(217,45,32,0.12)] text-[#d92d20]'
  return 'border-border bg-background text-secondary-foreground'
}

function scenarioPanelId(key: string, index: number): string {
  return `scenario-${index}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

const STATUS_REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}
