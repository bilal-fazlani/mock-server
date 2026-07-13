'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { ScenarioView } from './scenario-view'
import styles from './endpoint.module.css'

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
    <section className={styles.scenariosSection}>
      <div className={styles.scenarioSectionHeader}>
        <h2 className={styles.sectionTitle}>Scenarios</h2>
        {scenarios.length > 0 && (
          <div className={styles.scenarioActions}>
            <button type="button" className={styles.scenarioActionButton} onClick={expandAll}>
              Expand all
            </button>
            <button type="button" className={styles.scenarioActionButton} onClick={collapseAll}>
              Collapse all
            </button>
          </div>
        )}
      </div>

      {scenarios.length === 0 ? (
        <p className={styles.emptyScenarios}>No scenarios declared.</p>
      ) : (
        <div className={styles.scenarioList}>
          {scenarios.map((scenario, index) => {
            const isOpen = !collapsedKeys.has(scenario.key)
            const panelId = scenarioPanelId(scenario.key, index)
            const status = scenario.kind === 'fixture' ? fixtureStatusFromJson(scenario.json) : null
            return (
              <article key={scenario.key} className={styles.scenarioCard}>
                <button
                  type="button"
                  className={styles.scenarioToggle}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleScenario(scenario.key)}
                >
                  <span className={styles.scenarioHeading}>
                    <span className={`${styles.scenarioChevron} ${isOpen ? styles.scenarioChevronOpen : ''}`} aria-hidden="true" />
                    <span className={styles.scenarioTitle}>
                      <span className={styles.scenarioLabel}>{scenario.label}</span>
                      {status && (
                        <span className={`${styles.fixtureStatus} ${styles.scenarioHeaderStatus} ${statusToneClassName(status.tone)}`}>
                          {status.label}
                        </span>
                      )}
                    </span>
                  </span>
                  {scenario.isDefault && (
                    <span className={styles.defaultMarker}>
                      <Check className={styles.defaultMarkerIcon} aria-hidden="true" />
                      Default
                    </span>
                  )}
                </button>
                <div id={panelId} className={styles.scenarioBody} hidden={!isOpen}>
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
      <p className={styles.passthrough}>
        Passthrough - {scenario.url ?? `(env ${scenario.baseUrlEnv} not set)`}
      </p>
    )
  }

  if (scenario.kind === 'error') {
    return <p className={styles.error}>{scenario.message}</p>
  }

  return <FixtureContent json={scenario.json} />
}

function FixtureContent({ json }: { json: string }) {
  const fixture = parseFixtureJson(json)
  if (!fixture) {
    return <pre className={styles.fixture}>{json}</pre>
  }

  const headers = isRecord(fixture.headers) ? Object.entries(fixture.headers).map(([name, value]) => [name, formatHeaderValue(value)] as const) : []
  const bodyJson = fixture.body === undefined ? null : formatBodyJson(fixture.body)

  return (
    <div className={styles.fixtureDetails}>
      {headers.length > 0 && (
        <div className={styles.fixtureMeta}>
          <div className={styles.fixtureHeaders}>
            <dl className={styles.headerGrid}>
              {headers.map(([name, value]) => (
                <div key={name} className={styles.headerRow}>
                  <dt className={styles.headerKey}>
                    <code>{name}</code>
                  </dt>
                  <dd className={styles.headerValue}>
                    <code>{value}</code>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
      {bodyJson && <pre className={styles.fixture}>{bodyJson}</pre>}
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
  if (tone === 'success') return styles.fixtureStatusSuccess
  if (tone === 'redirect') return styles.fixtureStatusRedirect
  if (tone === 'error') return styles.fixtureStatusError
  return styles.fixtureStatusNeutral
}

function formatBodyJson(body: unknown): string | null {
  const serialized = JSON.stringify(body, null, 2)
  return serialized || null
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
