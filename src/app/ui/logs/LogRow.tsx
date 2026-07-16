'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronRight, Copy, Server, UserRound } from 'lucide-react'
import Link from 'next/link'
import { MethodBadge } from '../../components/MethodBadge'
import type { LogEntryView, LogSummaryView } from './types'

const systemChipClass =
  'inline-flex min-h-6 max-w-[180px] items-center gap-[5px] rounded-full border border-[rgba(var(--accent-rgb),0.35)] bg-card px-2 py-0.5 text-[0.75rem] font-[650] leading-none text-secondary-foreground no-underline hover:border-[rgba(var(--accent-rgb),0.58)] hover:bg-[var(--accent-tint)] hover:text-foreground'

const errorCodeClass =
  'rounded-full border border-[#d92d20] bg-[rgba(217,45,32,0.12)] px-2 py-px font-mono text-[0.72rem] font-[650] text-[#d92d20]'

const curlButtonClass =
  'inline-flex items-center gap-1.5 bg-card px-2.5 py-1 text-[0.78rem] text-secondary-foreground hover:border-muted-foreground hover:text-foreground'

export function LogRow({
  entry,
  systemLabels = {},
  scenarioLabels = {},
  captureSelectorLabels = {},
  defaultExpanded = false,
  initialDetail,
}: {
  entry: LogSummaryView
  systemLabels?: Record<string, string>
  scenarioLabels?: Record<string, string>
  captureSelectorLabels?: Record<string, string>
  defaultExpanded?: boolean
  initialDetail?: LogEntryView
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState(false)
  const [detail, setDetail] = useState<LogEntryView | null>(initialDetail ?? null)
  const [detailError, setDetailError] = useState(false)

  // Fetch the full entry (payloads) the first time the row opens.
  useEffect(() => {
    if (!expanded || detail || detailError) return
    let cancelled = false
    fetch(`/ui/api/logs/${encodeURIComponent(entry.logId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('not_found'))))
      .then((data: { entry: LogEntryView }) => {
        if (!cancelled) setDetail(data.entry)
      })
      .catch(() => {
        if (!cancelled) setDetailError(true)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, detail, detailError, entry.logId])

  const isError = entry.outcome === 'error'
  const time = entry.ts.slice(11, 23)
  const systemLabel = entry.system ? (systemLabels[entry.system] ?? entry.system) : undefined
  const systemIsFallback = systemLabel === entry.system
  const scenarioLabel = (scenario: string) =>
    entry.system && entry.endpoint
      ? scenarioLabels[scenarioLabelKey(entry.system, entry.endpoint, scenario)] ?? scenario
      : scenario

  return (
    <article
      className={`overflow-hidden rounded-lg border bg-card ${isError ? 'border-[rgba(217,45,32,0.45)]' : 'border-border'}`}
    >
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2.5 rounded-none border-0 bg-transparent px-3 py-2 text-left text-foreground hover:bg-[var(--accent-tint)]"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`size-3.5 flex-none text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="flex-none font-mono text-[0.75rem] text-muted-foreground">{time}</span>
        {entry.kind === 'admin' ? (
          <>
            <span className="rounded-full border border-[rgba(var(--accent-rgb),0.58)] bg-[var(--accent-tint)] px-[9px] py-0.5 text-[0.72rem] font-[650] uppercase text-[var(--accent-strong)]">
              admin
            </span>
            <span className="text-[0.85rem] text-secondary-foreground">
              {entry.trace.adminAction}
              {entry.trace.adminEndpoint && (
                <code className="text-[0.8rem] text-muted-foreground"> {entry.trace.adminEndpoint}</code>
              )}
            </span>
          </>
        ) : (
          <>
            {entry.system &&
              systemLabel &&
              (entry.endpoint ? (
                <Link
                  href={`/ui/catalog/${encodeURIComponent(entry.system)}/${encodeURIComponent(entry.endpoint)}`}
                  className={systemChipClass}
                  title={`Open ${systemLabel} in catalog`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Server className="size-3 flex-none stroke-[2.3] text-[var(--accent-strong)]" aria-hidden="true" />
                  <span
                    className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${systemIsFallback ? 'font-mono text-[0.72rem]' : ''}`}
                  >
                    {systemLabel}
                  </span>
                </Link>
              ) : (
                <span className={systemChipClass}>
                  <Server className="size-3 flex-none stroke-[2.3] text-[var(--accent-strong)]" aria-hidden="true" />
                  <span
                    className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${systemIsFallback ? 'font-mono text-[0.72rem]' : ''}`}
                  >
                    {systemLabel}
                  </span>
                </span>
              ))}
            {entry.method && <MethodBadge method={entry.method} />}
            <code className="min-w-0 font-mono text-[0.82rem] text-foreground [overflow-wrap:anywhere]">
              {entry.path}
              {entry.query}
            </code>
            {entry.trace.scenario && (
              <span className={scenarioChipClass(entry.trace.scenario)}>{scenarioLabel(entry.trace.scenario)}</span>
            )}
            {entry.error && <span className={errorCodeClass}>{entry.error.code}</span>}
            {entry.response && <span className={statusClass(entry.response.status)}>{entry.response.status}</span>}
          </>
        )}
        {entry.profileId && (
          <span className="ml-auto min-w-0">
            <Link
              href={`/ui/profiles/${encodeURIComponent(entry.profileId)}`}
              className="font-mono text-[0.75rem] text-secondary-foreground [overflow-wrap:anywhere] hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              {entry.profileId}
            </Link>
          </span>
        )}
      </button>
      {expanded &&
        (detail ? (
          <LogDetail
            entry={detail}
            copied={copied}
            setCopied={setCopied}
            captureSelectorLabels={captureSelectorLabels}
          />
        ) : (
          <div className="px-3.5 py-2.5 text-xs text-muted-foreground">
            {detailError ? 'Entry no longer available.' : 'Loading…'}
          </div>
        ))}
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
    <div className="flex flex-col gap-3 border-t border-border bg-background pb-3.5 pl-9 pr-3.5 pt-3">
      {hasTraceFlow && (
        <div className="flex flex-col gap-1.5">
          {entry.error && (
            <span className="inline-flex flex-wrap items-center gap-2 text-[0.85rem]">
              <span className={errorCodeClass}>{entry.error.code}</span>
              <span className="text-secondary-foreground [overflow-wrap:anywhere]">{entry.error.message}</span>
            </span>
          )}
        </div>
      )}

      {hasTraceMeta && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8rem]">
          {trace.upstream && (
            <>
              <dt className={traceMetaDtClass}>upstream</dt>
              <dd className="m-0 flex min-w-0 flex-wrap items-center gap-1.5">
                <SegGroup className="min-w-0 bg-card">
                  <SegIcon className="bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent-strong)]">
                    <Server className="size-[13px] flex-none stroke-[2.4]" aria-hidden="true" />
                  </SegIcon>
                  <Seg className="bg-card text-foreground">{upstreamBaseUrl(trace.upstream.url)}</Seg>
                </SegGroup>
              </dd>
            </>
          )}
          {trace.profileResolution && (
            <>
              <dt className={traceMetaDtClass}>profile id</dt>
              <dd
                className={
                  sourceView
                    ? 'm-0 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2'
                    : 'm-0 flex min-w-0 flex-wrap items-center gap-1.5'
                }
              >
                <ProfileResolutionValue resolution={trace.profileResolution} profileId={entry.profileId} />
                {sourceView && <SourceInfo view={sourceView} sequence={trace.sequence} align="end" />}
              </dd>
            </>
          )}
          {sourceView && !trace.profileResolution && (
            <>
              <dt className="hidden" aria-hidden="true" />
              <dd className="m-0 col-span-full flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                <SourceInfo view={sourceView} sequence={trace.sequence} align="end" />
              </dd>
            </>
          )}
          {metaTiming && (
            <>
              <dt className={traceMetaDtClass}>{metaTiming.label}</dt>
              <dd className="m-0 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-secondary-foreground [overflow-wrap:anywhere]">{metaTiming.value}</span>
              </dd>
            </>
          )}
          {trace.captures && trace.captures.length > 0 && (
            <>
              <dt className={traceMetaDtClass}>captured</dt>
              <dd className="m-0 flex min-w-0 flex-wrap items-center gap-1.5">
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
              <dt className={traceMetaDtClass}>validation</dt>
              <dd className="m-0 flex min-w-0 flex-wrap items-center gap-1.5">
                {trace.validation.request && (
                  <code className="rounded-full border border-border bg-card px-2 py-0.5 text-[0.75rem] text-secondary-foreground [overflow-wrap:anywhere]">
                    request: {trace.validation.request}
                  </code>
                )}
                {trace.validation.response && (
                  <code className="rounded-full border border-border bg-card px-2 py-0.5 text-[0.75rem] text-secondary-foreground [overflow-wrap:anywhere]">
                    response: {trace.validation.response}
                  </code>
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

      <div className="flex items-center justify-between gap-2.5">
        <code className="font-mono text-[0.72rem] text-muted-foreground">{entry.logId}</code>
        {entry.kind === 'request' && (
          <button
            type="button"
            className={curlButtonClass}
            onClick={() => {
              void navigator.clipboard.writeText(buildCurl(entry)).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              })
            }}
          >
            {copied ? <Check className="size-[13px]" aria-hidden="true" /> : <Copy className="size-[13px]" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy as cURL'}
          </button>
        )}
      </div>
    </div>
  )
}

const traceMetaDtClass =
  'self-center text-[0.68rem] font-bold uppercase tracking-[0.06em] text-muted-foreground'

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
    <span
      className={`inline-flex min-w-0 flex-col gap-0.5 text-secondary-foreground ${
        align === 'end' ? 'ml-auto max-w-[min(440px,100%)] items-end text-right' : 'items-start'
      }`}
    >
      <span className="text-[0.8rem] font-bold text-secondary-foreground">{view.label}</span>
      <span className="text-[0.75rem] font-medium leading-[1.35] text-muted-foreground">
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
    <span className="inline-flex flex-wrap items-center gap-2 text-[0.85rem]">
      {selector && (
        <>
          <SelectorPill selector={selector} />
          <span className="font-[750] text-muted-foreground" aria-hidden="true">
            →
          </span>
        </>
      )}
      <SegGroup>
        <Seg className="bg-[var(--warning-bg)] text-[var(--warning-text)]">{namespace}</Seg>
        <Seg className="bg-card text-foreground">{value}</Seg>
      </SegGroup>
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
      <span className="inline-flex flex-wrap items-center gap-2 text-[0.85rem]">
        <SelectorPill selector={resolution.selector} />
        <span className="font-[750] text-muted-foreground" aria-hidden="true">
          →
        </span>
        <SegGroup className="min-w-0">
          <SegIcon className="bg-[rgba(96,165,250,0.14)] text-[#93c5fd]">
            <UserRound className="size-[13px] flex-none stroke-[2.4]" aria-hidden="true" />
          </SegIcon>
          <Seg className="bg-card text-foreground">{profileId ?? resolution.value}</Seg>
        </SegGroup>
      </span>
    )
  }

  const via = resolution.via
  const innerSelector = resolution.selector.slice(`profileKey:${via.namespace}:`.length)
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-[0.85rem]">
      <SelectorPill selector={innerSelector} />
      <span className="font-[750] text-muted-foreground" aria-hidden="true">
        →
      </span>
      <SegGroup>
        <Seg className="bg-[var(--accent-tint)] text-[var(--accent-strong)]">profileKey</Seg>
        <Seg className="bg-[var(--warning-bg)] text-[var(--warning-text)]">{via.namespace}</Seg>
        <Seg className="bg-card text-foreground">{resolution.value}</Seg>
      </SegGroup>
      <span className="font-[750] text-muted-foreground" aria-hidden="true">
        →
      </span>
      <span className="inline-flex min-h-[26px] items-center gap-1.5 rounded-full border border-[rgba(96,165,250,0.4)] bg-[rgba(96,165,250,0.14)] px-2.5 py-[3px] font-mono text-[0.78rem] font-bold text-[#93c5fd] [overflow-wrap:anywhere]">
        <UserRound className="size-3 flex-none stroke-[2.4]" aria-hidden="true" />
        {profileId ?? resolution.value}
      </span>
    </span>
  )
}

function SelectorPill({ selector }: { selector: string }) {
  const namedSelector = splitNamedSelector(selector)
  if (!namedSelector) {
    return (
      <code className="inline-flex min-h-[26px] items-center rounded-full border border-border bg-card px-2.5 py-[3px] font-mono text-[0.78rem] font-bold text-foreground">
        {selector}
      </code>
    )
  }

  return (
    <SegGroup className="bg-card">
      <Seg className="bg-[rgba(var(--accent-rgb),0.12)] text-[var(--accent-strong)]">{namedSelector.source}</Seg>
      {namedSelector.name && <Seg className="bg-card text-foreground">{namedSelector.name}</Seg>}
    </SegGroup>
  )
}

function SegGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center overflow-hidden rounded-full border border-border ${className}`}
    >
      {children}
    </span>
  )
}

function Seg({ children, className }: { children: ReactNode; className: string }) {
  return (
    <code
      className={`inline-flex min-w-0 min-h-[26px] items-center border-r border-border px-2.5 py-[3px] font-mono text-[0.78rem] font-bold last:border-r-0 [overflow-wrap:anywhere] ${className}`}
    >
      {children}
    </code>
  )
}

function SegIcon({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span
      className={`inline-flex min-h-[26px] min-w-0 items-center border-r border-border px-2 py-[3px] last:border-r-0 ${className}`}
    >
      {children}
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
    <div className="flex min-w-0 flex-col gap-1">
      <span className="inline-flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
        {meta && (
          <span className="font-mono text-[0.72rem] font-[650] normal-case tracking-normal text-secondary-foreground">
            {meta}
          </span>
        )}
        {payload.truncated && (
          <span className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-[7px] py-px text-[0.68rem] normal-case tracking-normal text-[var(--warning-text)]">
            truncated
          </span>
        )}
      </span>
      <pre className="m-0 overflow-x-auto rounded-sm border border-border bg-card px-3 py-2.5 font-mono text-[0.76rem] leading-[1.5]">
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
  const base = 'rounded-full border px-[9px] py-0.5 font-mono text-[0.72rem] font-[650]'
  if (scenario === 'real') return `${base} border-[#d92d20] bg-[rgba(217,45,32,0.12)] text-[#d92d20]`
  if (scenario === 'default')
    return `${base} border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)] text-[var(--success)]`
  return `${base} border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]`
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
  const base = 'rounded-full border px-2 py-px font-mono text-[0.75rem] font-bold'
  if (status >= 400) return `${base} border-[#d92d20] bg-[rgba(217,45,32,0.12)] text-[#d92d20]`
  if (status >= 300) return `${base} border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]`
  return `${base} border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)] text-[var(--success)]`
}
