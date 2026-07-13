'use client'

import { useState } from 'react'
import { Check, ChevronRight, Copy, Server, UserRound } from 'lucide-react'
import Link from 'next/link'
import { MethodBadge } from '../../components/MethodBadge'
import type { LogEntryView } from './types'
import styles from './logs.module.css'

export function LogRow({
  entry,
  systemLabels = {},
  scenarioLabels = {},
  captureSelectorLabels = {},
  defaultExpanded = false,
}: {
  entry: LogEntryView
  systemLabels?: Record<string, string>
  scenarioLabels?: Record<string, string>
  captureSelectorLabels?: Record<string, string>
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState(false)
  const isError = entry.outcome === 'error'
  const time = entry.ts.slice(11, 23)
  const systemLabel = entry.system ? (systemLabels[entry.system] ?? entry.system) : undefined
  const systemIsFallback = systemLabel === entry.system
  const scenarioLabel = (scenario: string) =>
    entry.system && entry.endpoint
      ? scenarioLabels[scenarioLabelKey(entry.system, entry.endpoint, scenario)] ?? scenario
      : scenario

  return (
    <article className={`${styles.row} ${isError ? styles.rowError : ''}`}>
      <button
        type="button"
        className={styles.rowSummary}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        />
        <span className={styles.time}>{time}</span>
        {entry.kind === 'admin' ? (
          <>
            <span className={styles.adminBadge}>admin</span>
            <span className={styles.adminAction}>
              {entry.trace.adminAction}
              {entry.trace.adminEndpoint && (
                <code className={styles.adminEndpoint}> {entry.trace.adminEndpoint}</code>
              )}
            </span>
          </>
        ) : (
          <>
            {entry.system && systemLabel && (
              entry.endpoint ? (
                <Link
                  href={`/ui/catalog/${encodeURIComponent(entry.system)}/${encodeURIComponent(entry.endpoint)}`}
                  className={styles.systemChip}
                  title={`Open ${systemLabel} in catalog`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Server className={styles.systemChipIcon} aria-hidden="true" />
                  <span className={systemIsFallback ? styles.systemChipFallback : undefined}>
                    {systemLabel}
                  </span>
                </Link>
              ) : (
                <span className={styles.systemChip}>
                  <Server className={styles.systemChipIcon} aria-hidden="true" />
                  <span className={systemIsFallback ? styles.systemChipFallback : undefined}>
                    {systemLabel}
                  </span>
                </span>
              )
            )}
            {entry.method && <MethodBadge method={entry.method} />}
            <code className={styles.path}>
              {entry.path}
              {entry.query}
            </code>
            {entry.trace.scenario && (
              <span className={`${styles.scenarioChip} ${scenarioChipClass(entry.trace.scenario)}`}>
                {scenarioLabel(entry.trace.scenario)}
              </span>
            )}
            {entry.error && <span className={styles.errorCode}>{entry.error.code}</span>}
            {entry.response && (
              <span className={`${styles.status} ${statusClass(entry.response.status)}`}>
                {entry.response.status}
              </span>
            )}
          </>
        )}
        {entry.profileId && (
          <span className={styles.profileRef}>
            <Link
              href={`/ui/profiles/${encodeURIComponent(entry.profileId)}`}
              className={styles.profileLink}
              onClick={(e) => e.stopPropagation()}
            >
              {entry.profileId}
            </Link>
          </span>
        )}
      </button>
      {expanded && (
        <LogDetail
          entry={entry}
          copied={copied}
          setCopied={setCopied}
          captureSelectorLabels={captureSelectorLabels}
        />
      )}
    </article>
  )
}

function LogDetail({
  entry,
  copied,
  setCopied,
  captureSelectorLabels,
}: {
  entry: LogEntryView
  copied: boolean
  setCopied: (v: boolean) => void
  captureSelectorLabels: Record<string, string>
}) {
  const trace = entry.trace
  const sourceView = trace.scenarioSource ? scenarioSourceView(trace.scenarioSource) : null
  const timing = timingView(entry)
  const metaTiming = entry.response ? null : timing
  const captureSelector = (namespace: string) =>
    entry.system && entry.endpoint
      ? captureSelectorLabels[captureSelectorLabelKey(entry.system, entry.endpoint, namespace)]
      : undefined
  const hasTraceFlow = entry.kind === 'request' && !!entry.error
  const hasTraceMeta =
    trace.upstream ||
    trace.profileResolution ||
    sourceView ||
    metaTiming ||
    trace.captures?.length ||
    trace.validation
  return (
    <div className={styles.detail}>
      {hasTraceFlow && (
        <div className={styles.traceFlow}>
          {entry.error && (
            <span className={styles.traceStep}>
              <span className={styles.errorCode}>{entry.error.code}</span>
              <span className={styles.traceValue}>{entry.error.message}</span>
            </span>
          )}
        </div>
      )}

      {hasTraceMeta && (
        <dl className={styles.traceMeta}>
          {trace.upstream && (
            <>
              <dt>upstream</dt>
              <dd>
                <span className={`${styles.segGroup} ${styles.upstreamPill}`}>
                  <span className={`${styles.seg} ${styles.segUpstreamIcon}`}>
                    <Server className={styles.upstreamIcon} aria-hidden="true" />
                  </span>
                  <code className={`${styles.seg} ${styles.segValue}`}>
                    {upstreamBaseUrl(trace.upstream.url)}
                  </code>
                </span>
              </dd>
            </>
          )}
          {trace.profileResolution && (
            <>
              <dt>profile id</dt>
              <dd className={sourceView ? styles.primaryMetaValue : undefined}>
                <ProfileResolutionValue
                  resolution={trace.profileResolution}
                  profileId={entry.profileId}
                />
                {sourceView && (
                  <SourceInfo view={sourceView} sequence={trace.sequence} align="end" />
                )}
              </dd>
            </>
          )}
          {sourceView && !trace.profileResolution && (
            <>
              <dt className={styles.sourceOnlyLabel} aria-hidden="true" />
              <dd className={styles.sourceOnlyValue}>
                <SourceInfo view={sourceView} sequence={trace.sequence} align="end" />
              </dd>
            </>
          )}
          {metaTiming && (
            <>
              <dt>{metaTiming.label}</dt>
              <dd>
                <span className={styles.traceValue}>{metaTiming.value}</span>
              </dd>
            </>
          )}
          {trace.captures && trace.captures.length > 0 && (
            <>
              <dt>captured</dt>
              <dd>
                {trace.captures.map((c) => (
                  <CapturedKeyPill
                    key={`${c.namespace}:${c.key}`}
                    namespace={c.namespace}
                    value={c.key}
                    selector={captureSelector(c.namespace)}
                  />
                ))}
              </dd>
            </>
          )}
          {trace.validation && (
            <>
              <dt>validation</dt>
              <dd>
                {trace.validation.request && (
                  <code className={styles.metaChip}>request: {trace.validation.request}</code>
                )}
                {trace.validation.response && (
                  <code className={styles.metaChip}>response: {trace.validation.response}</code>
                )}
              </dd>
            </>
          )}
        </dl>
      )}

      {entry.request && <PayloadBlock label="Request" payload={entry.request} />}
      {entry.response && (
        <PayloadBlock label="Response" payload={entry.response} meta={timing?.value} />
      )}

      <div className={styles.detailFooter}>
        <code className={styles.logId}>{entry.logId}</code>
        {entry.kind === 'request' && (
          <button
            type="button"
            className={styles.curlButton}
            onClick={() => {
              void navigator.clipboard.writeText(buildCurl(entry)).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <Check className={styles.curlIcon} aria-hidden="true" /> : <Copy className={styles.curlIcon} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy as cURL'}
          </button>
        )}
      </div>
    </div>
  )
}

function SourceInfo({
  view,
  sequence,
  align = 'start',
}: {
  view: { label: string; tooltip: string }
  sequence?: NonNullable<LogEntryView['trace']['sequence']>
  align?: 'start' | 'end'
}) {
  return (
    <span className={`${styles.sourceInfo} ${align === 'end' ? styles.sourceSide : ''}`}>
      <span className={styles.sourceLabel}>{view.label}</span>
      <span className={styles.sourceNote}>
        {view.tooltip}
        {sequence && ` Step ${sequence.step}/${sequence.of} · call ${sequence.served}.`}
      </span>
    </span>
  )
}

function CapturedKeyPill({
  namespace,
  value,
  selector,
}: {
  namespace: string
  value: string
  selector?: string
}) {
  return (
    <span className={styles.traceStep}>
      {selector && (
        <>
          <SelectorPill selector={selector} />
          <span className={styles.flowArrow} aria-hidden="true">→</span>
        </>
      )}
      <span className={styles.segGroup}>
        <code className={`${styles.seg} ${styles.segNamespace}`}>{namespace}</code>
        <code className={`${styles.seg} ${styles.segValue}`}>{value}</code>
      </span>
    </span>
  )
}

// Mirrors the catalog endpoint page's selector flow when a profileKey mapping is involved.
function ProfileResolutionValue({
  resolution,
  profileId,
}: {
  resolution: NonNullable<LogEntryView['trace']['profileResolution']>
  profileId?: string
}) {
  if (resolution.via === 'direct') {
    return (
      <span className={styles.traceStep}>
        <SelectorPill selector={resolution.selector} />
        <span className={styles.flowArrow} aria-hidden="true">→</span>
        <span className={`${styles.segGroup} ${styles.profileIdPill}`}>
          <span className={`${styles.seg} ${styles.segProfileIcon}`}>
            <UserRound className={styles.profileResultIcon} aria-hidden="true" />
          </span>
          <code className={`${styles.seg} ${styles.segValue}`}>{profileId ?? resolution.value}</code>
        </span>
      </span>
    )
  }

  const via = resolution.via
  const innerSelector = resolution.selector.slice(`profileKey:${via.namespace}:`.length)
  return (
    <span className={styles.traceStep}>
      <SelectorPill selector={innerSelector} />
      <span className={styles.flowArrow} aria-hidden="true">→</span>
      <span className={styles.segGroup}>
        <code className={`${styles.seg} ${styles.segProfileKey}`}>profileKey</code>
        <code className={`${styles.seg} ${styles.segNamespace}`}>{via.namespace}</code>
        <code className={`${styles.seg} ${styles.segValue}`}>{resolution.value}</code>
      </span>
      <span className={styles.flowArrow} aria-hidden="true">→</span>
      <span className={styles.profileChip}>
        <UserRound className={styles.profileChipIcon} aria-hidden="true" />
        {profileId ?? resolution.value}
      </span>
    </span>
  )
}

function SelectorPill({ selector }: { selector: string }) {
  const namedSelector = splitNamedSelector(selector)
  if (!namedSelector) return <code className={styles.selectorChip}>{selector}</code>

  return (
    <span className={`${styles.segGroup} ${styles.selectorPill}`}>
      <code className={`${styles.seg} ${styles.segSelectorSource}`}>{namedSelector.source}</code>
      {namedSelector.name && (
        <code className={`${styles.seg} ${styles.segSelectorName}`}>{namedSelector.name}</code>
      )}
    </span>
  )
}

function PayloadBlock({
  label,
  payload,
  meta,
}: {
  label: string
  payload: { body: unknown; truncated: boolean; status?: number }
  meta?: string
}) {
  if (payload.body === null || payload.body === undefined) return null
  return (
    <div className={styles.payload}>
      <span className={styles.payloadLabel}>
        {label}
        {meta && <span className={styles.payloadLabelMeta}>{meta}</span>}
        {payload.truncated && <span className={styles.truncated}>truncated</span>}
      </span>
      <pre className={styles.payloadJson}>
        {typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body, null, 2)}
      </pre>
    </div>
  )
}

function buildCurl(entry: LogEntryView): string {
  const parts = [`curl -X ${entry.method ?? 'GET'} '${window.location.origin}${entry.path}${entry.query ?? ''}'`]
  const contentType = entry.request?.headers['content-type']
  if (contentType) parts.push(`-H 'content-type: ${contentType}'`)
  if (entry.request?.body != null) {
    const body =
      typeof entry.request.body === 'string'
        ? entry.request.body
        : JSON.stringify(entry.request.body)
    parts.push(`-d '${body.replaceAll("'", "'\\''")}'`)
  }
  return parts.join(' \\\n  ')
}

function scenarioChipClass(scenario: string): string {
  if (scenario === 'real') return styles.chipReal
  if (scenario === 'default') return styles.chipDefault
  return styles.chipNonDefault
}

function scenarioLabelKey(system: string, endpoint: string, scenario: string): string {
  return `${system}/${endpoint}/${scenario}`
}

function captureSelectorLabelKey(system: string, endpoint: string, namespace: string): string {
  return `${system}/${endpoint}/${namespace}`
}

function upstreamBaseUrl(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function splitNamedSelector(
  selector: string,
): { source: 'path' | 'query' | 'bearer'; name?: string } | null {
  if (selector.startsWith('path:')) return { source: 'path', name: selector.slice('path:'.length) }
  if (selector.startsWith('query:')) return { source: 'query', name: selector.slice('query:'.length) }
  if (selector === 'bearer') return { source: 'bearer' }
  if (selector.startsWith('bearer:')) {
    return { source: 'bearer', name: selector.slice('bearer:'.length) }
  }
  return null
}

type ScenarioSource = NonNullable<LogEntryView['trace']['scenarioSource']>

const scenarioSourceViews: Record<ScenarioSource, { label: string; tooltip: string }> = {
  pin: {
    label: 'Profile pick',
    tooltip: 'This profile explicitly selects this scenario for the endpoint.',
  },
  sequence: {
    label: 'Sequence',
    tooltip: 'This profile uses a scenario sequence; this request served the shown step.',
  },
  implicit: {
    label: 'Default fallback',
    tooltip: 'No choice was set, so the runtime used the implicit scenario.',
  },
  global: {
    label: 'Global mock',
    tooltip: 'A global mock setting selected this scenario for the endpoint.',
  },
  unmocked_policy: {
    label: 'Unmocked user policy',
    tooltip: 'The profile was not found, so UNMOCKED_USERS chose this scenario.',
  },
}

function scenarioSourceView(source: ScenarioSource): { label: string; tooltip: string } {
  return scenarioSourceViews[source]
}

function timingView(entry: LogEntryView): { label: 'duration' | 'timing'; value: string } | null {
  if (entry.durationMs === undefined) return null
  if (entry.trace.upstream) {
    return {
      label: 'timing',
      value: `total ${entry.durationMs} ms · upstream ${entry.trace.upstream.durationMs} ms`,
    }
  }
  return { label: 'duration', value: `${entry.durationMs} ms` }
}

// Status tone convention (everywhere): 2xx green, 3xx yellow, 4xx/5xx red.
function statusClass(status: number): string {
  if (status >= 400) return styles.statusError
  if (status >= 300) return styles.statusRedirect
  return styles.statusOk
}
