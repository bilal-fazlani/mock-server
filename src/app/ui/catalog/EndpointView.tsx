import Link from 'next/link'
import type { ReactNode } from 'react'
import { Save, Server, UserRound } from 'lucide-react'
import { buildEndpointRequestExample } from '../../../lib/catalog/request-example'
import {
  parseProfileIdSelector,
  parseSelector,
  type DirectSelector,
  type ProfileIdSelector,
  type Selector,
} from '../../../lib/catalog/selector'
import type { Catalog, EndpointDef, SystemDef } from '../../../lib/catalog/types'
import { Button } from '../../components/ui/button'
import { MethodBadge } from '../../components/MethodBadge'
import { SchemaBadge } from '../../components/SchemaBadge'
import { CopyCurlButton } from './CopyCurlButton'
import { EndpointScenarios } from './EndpointScenarios'
import type { ScenarioView } from './scenario-view'

const configRowClass = (top: boolean) =>
  `grid grid-cols-[22px_82px_minmax(0,1fr)] gap-2.5 ${top ? 'items-start' : 'items-center'}`

const configIconTooltipClass = (top: boolean) =>
  `inline-flex size-[22px] items-center justify-center cursor-help ${top ? 'min-h-[28px]' : ''}`

const rowLabelClass =
  'inline-flex items-center min-h-[28px] text-[0.68rem] font-bold tracking-[0.08em] uppercase text-muted-foreground'

export function EndpointView({
  system,
  endpoint,
  scenarios,
  baseUrl,
  showBaseUrl,
  catalog,
}: {
  system: SystemDef
  endpoint: EndpointDef
  scenarios: ScenarioView[]
  baseUrl: string | null
  showBaseUrl: boolean
  catalog: Catalog
}) {
  const mockType = endpoint.mockType ?? 'profiled'
  const captureProfileKeys = endpoint.captureProfileKeys ?? []
  const visibleScenarios = scenarios.filter((scenario) => scenario.key !== 'real')
  const current = { systemSlug: system.slug, endpointName: endpoint.name }
  const profileSelector = endpoint.profileIdSelector
    ? parseProfileIdSelectorSafely(endpoint.profileIdSelector)
    : null
  const profileViaKey = profileSelector?.source === 'profileKey'
  return (
    <main className="flex flex-col gap-5">
      <div className="sticky top-0 z-20 -mt-2 mb-0.5 flex flex-wrap items-center gap-3.5 border-b border-border bg-background py-2.5 shadow-[0_16px_30px_-12px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.07)] after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-3.5 after:h-3.5 after:bg-gradient-to-b after:from-[rgba(0,0,0,0.36)] after:to-transparent after:content-['']">
        <Button asChild variant="secondary">
          <Link href="/ui/catalog">← Catalog</Link>
        </Button>
        <div className="flex min-w-0 flex-[1_1_420px] flex-wrap items-center gap-3">
          <MethodBadge method={endpoint.method} />
          <code className="font-mono text-base [overflow-wrap:anywhere]">{endpoint.path}</code>
          <span className="text-secondary-foreground">{endpoint.displayName}</span>
          {mockType === 'global' && (
            <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[0.72rem] font-semibold uppercase text-[var(--accent)]">
              Global
            </span>
          )}
          {endpoint.schema && <SchemaBadge />}
          <span className="inline-flex ml-auto">
            <CopyCurlButton example={buildEndpointRequestExample(endpoint)} />
          </span>
        </div>
      </div>

      <section className="py-0.5" aria-label="Endpoint configuration">
        <div className="flex flex-col gap-3">
          <div className={configRowClass(false)}>
            <span className={configIconTooltipClass(false)} title="System" aria-label="System">
              <Server className="flex-none size-4 stroke-[2.1] text-secondary-foreground" aria-hidden="true" />
            </span>
            <span className={rowLabelClass}>system</span>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center min-h-[28px] leading-[1.15]">{system.name}</span>
              {showBaseUrl &&
                (baseUrl ? (
                  <code className="inline-flex items-center min-h-[28px] text-secondary-foreground leading-[1.15]">
                    {baseUrl}
                  </code>
                ) : (
                  <span className="text-muted-foreground">(base URL not set)</span>
                ))}
            </div>
          </div>
          {mockType === 'profiled' && (
            <>
              <div className={configRowClass(profileViaKey)}>
                <span
                  className={configIconTooltipClass(profileViaKey)}
                  title={
                    profileViaKey
                      ? 'Profile resolved via a previously captured key'
                      : 'Profile ID selector'
                  }
                  aria-label="Profile ID selector"
                >
                  <UserRound className="flex-none size-4 stroke-[2.1] text-[#60a5fa]" aria-hidden="true" />
                </span>
                <span className={rowLabelClass}>{profileViaKey ? 'profile via' : 'profile'}</span>
                <div className="flex min-w-0 items-center gap-2 min-h-[28px]">
                  <ProfileSelectorDisplay
                    raw={endpoint.profileIdSelector}
                    catalog={catalog}
                    current={current}
                  />
                </div>
              </div>
              {captureProfileKeys.length > 0 && (
                <div className={configRowClass(captureProfileKeys.length > 1)}>
                  <span
                    className={configIconTooltipClass(captureProfileKeys.length > 1)}
                    title="Stores each key → this profile, so later calls can correlate by key alone"
                    aria-label="Captures profile keys"
                  >
                    <Save className="flex-none size-4 stroke-[2.1] text-[#93c5fd]" aria-hidden="true" />
                  </span>
                  <span className={rowLabelClass}>captures</span>
                  <div className="flex items-center min-h-[28px]">
                    <div className="flex flex-col items-start gap-1.5">
                      {captureProfileKeys.map((capture) => (
                        <span
                          key={`${capture.namespace}:${capture.keySelector}`}
                          className="inline-flex flex-wrap items-center gap-2 text-secondary-foreground text-[0.85rem] leading-[1.45]"
                        >
                          <SelectorDisplay raw={capture.keySelector} />
                          <span className="text-muted-foreground font-[750]" aria-hidden="true">→</span>
                          <NamespaceChip
                            namespace={capture.namespace}
                            catalog={catalog}
                            current={current}
                          />
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <EndpointScenarios scenarios={visibleScenarios} />
    </main>
  )
}

function ProfileSelectorDisplay({
  raw,
  catalog,
  current,
}: {
  raw: string | undefined
  catalog: Catalog
  current: EndpointRef
}) {
  if (!raw) return null

  const selector = parseProfileIdSelectorSafely(raw)
  if (selector?.source === 'profileKey') {
    const nestedRaw = raw.slice(`profileKey:${selector.namespace}:`.length)
    return (
      <span className="flex min-w-0 flex-col gap-[5px]">
        <span className="inline-flex flex-wrap items-center gap-2">
          <SelectorDisplay raw={nestedRaw} />
          <span className="text-muted-foreground font-[750]" aria-hidden="true">→</span>
          <NamespaceChip namespace={selector.namespace} catalog={catalog} current={current} />
          <span className="text-muted-foreground font-[750]" aria-hidden="true">→</span>
          <span className="inline-flex items-center gap-1.5 min-h-[28px] rounded-full border border-[rgba(96,165,250,0.4)] bg-[rgba(96,165,250,0.14)] px-2.5 py-1 font-mono text-[0.85rem] font-bold leading-[1.15] text-[#93c5fd]">
            <UserRound className="flex-none size-[13px] stroke-[2.4]" aria-hidden="true" />
            profile
          </span>
        </span>
        <span className="text-muted-foreground text-[0.78rem]">
          Needs a mapping captured by an earlier call — responds 404 until then.
        </span>
      </span>
    )
  }

  if (selector?.source === 'bearer') {
    return (
      <SelectorSegmentGroup>
        <SelectorSegment className="bg-[rgba(96,165,250,0.14)] text-[#93c5fd]">bearer</SelectorSegment>
        {selector.claim && (
          <SelectorSegment className="bg-card text-foreground font-bold">{selector.claim}</SelectorSegment>
        )}
      </SelectorSegmentGroup>
    )
  }

  return <SelectorDisplay raw={raw} />
}

function parseProfileIdSelectorSafely(raw: string): ProfileIdSelector | null {
  try {
    return parseProfileIdSelector(raw)
  } catch {
    return null
  }
}

interface EndpointRef {
  systemSlug: string
  endpointName: string
}

function NamespaceChip({
  namespace,
  catalog,
  current,
}: {
  namespace: string
  catalog: Catalog
  current: EndpointRef
}) {
  const usage = collectNamespaceUsage(catalog, namespace)
  return (
    <span className="group relative inline-flex outline-none" tabIndex={0}>
      <SelectorSegmentGroup>
        <SelectorSegment className="bg-[var(--accent-tint)] text-[var(--accent-strong)]">profileKey</SelectorSegment>
        <SelectorSegment className="bg-[var(--warning-bg)] text-[var(--warning-text)] cursor-help underline decoration-dotted decoration-1 underline-offset-[3px]">
          {namespace}
        </SelectorSegment>
      </SelectorSegmentGroup>
      <span
        className="absolute left-0 top-full z-40 hidden w-max max-w-[360px] pt-2 group-hover:block group-focus-within:block"
        role="tooltip"
      >
        <span className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 px-3.5 shadow-sm text-[0.82rem] leading-[1.4]">
          <span className="text-foreground font-[650]">
            Correlation key <code className="text-[var(--warning-text)]">{namespace}</code>
          </span>
          <UsageSection
            label="Captured by"
            entries={usage.capturedBy}
            current={current}
            empty="No endpoint captures this key."
          />
          <UsageSection
            label="Resolves profile for"
            entries={usage.resolvedBy}
            current={current}
            empty="No endpoint resolves profiles from this key."
          />
        </span>
      </span>
    </span>
  )
}

function UsageSection({
  label,
  entries,
  current,
  empty,
}: {
  label: string
  entries: NamespaceUsageEntry[]
  current: EndpointRef
  empty: string
}) {
  return (
    <span className="flex flex-col gap-[5px]">
      <span className="text-muted-foreground text-[0.66rem] font-bold tracking-[0.08em] uppercase">{label}</span>
      {entries.length === 0 ? (
        <span className="text-[var(--warning-text)]">{empty}</span>
      ) : (
        entries.map(({ system, endpoint }) => {
          const key = `${system.slug}/${endpoint.name}`
          const isCurrent =
            system.slug === current.systemSlug && endpoint.name === current.endpointName
          if (isCurrent) {
            return (
              <span
                key={key}
                className="flex items-baseline gap-2 min-w-0 text-secondary-foreground no-underline"
              >
                <code className="flex-none text-muted-foreground text-[0.7rem] font-bold">
                  {endpoint.method.toUpperCase()}
                </code>
                <span className="min-w-0 text-foreground font-[650] [overflow-wrap:anywhere]">
                  {endpoint.displayName}
                </span>
                <span className="flex-none text-muted-foreground text-[0.7rem] italic">this endpoint</span>
              </span>
            )
          }
          return (
            <Link
              key={key}
              href={`/ui/catalog/${system.slug}/${endpoint.name}`}
              className="group/entry flex items-baseline gap-2 min-w-0 text-secondary-foreground no-underline"
            >
              <code className="flex-none text-muted-foreground text-[0.7rem] font-bold">
                {endpoint.method.toUpperCase()}
              </code>
              <span className="min-w-0 [overflow-wrap:anywhere] group-hover/entry:text-foreground group-hover/entry:underline">
                {endpoint.displayName}
              </span>
            </Link>
          )
        })
      )}
    </span>
  )
}

interface NamespaceUsageEntry {
  system: SystemDef
  endpoint: EndpointDef
}

function collectNamespaceUsage(
  catalog: Catalog,
  namespace: string,
): { capturedBy: NamespaceUsageEntry[]; resolvedBy: NamespaceUsageEntry[] } {
  const capturedBy: NamespaceUsageEntry[] = []
  const resolvedBy: NamespaceUsageEntry[] = []
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      if ((endpoint.captureProfileKeys ?? []).some((c) => c.namespace === namespace)) {
        capturedBy.push({ system, endpoint })
      }
      const selector = endpoint.profileIdSelector
        ? parseSelectorSafely(endpoint.profileIdSelector)
        : null
      if (selector?.source === 'profileKey' && selector.namespace === namespace) {
        resolvedBy.push({ system, endpoint })
      }
    }
  }
  return { capturedBy, resolvedBy }
}

function SelectorDisplay({ raw }: { raw: string | undefined }) {
  if (!raw) return null

  const selector = parseSelectorSafely(raw)
  if (!selector) return <code>{raw}</code>

  if (selector.source === 'profileKey') {
    const nestedRaw = raw.slice(`profileKey:${selector.namespace}:`.length)
    return (
      <SelectorSegmentGroup>
        <SelectorSegment className="bg-[var(--accent-tint)] text-[var(--accent-strong)]">profileKey</SelectorSegment>
        <SelectorSegment className="bg-[var(--warning-bg)] text-[var(--warning-text)]">{selector.namespace}</SelectorSegment>
        <SelectorSegment className="bg-card text-foreground font-bold">{nestedRaw}</SelectorSegment>
      </SelectorSegmentGroup>
    )
  }

  return <DirectSelectorDisplay selector={selector} raw={raw} />
}

function parseSelectorSafely(raw: string): Selector | null {
  try {
    return parseSelector(raw)
  } catch {
    return null
  }
}

function DirectSelectorDisplay({ selector, raw }: { selector: DirectSelector; raw: string }) {
  if (selector.source === 'body') {
    return (
      <code className="inline-flex items-center min-h-[28px] rounded-full border border-border bg-card px-2.5 py-1 text-foreground font-bold leading-[1.15]">
        {raw}
      </code>
    )
  }

  return (
    <SelectorSegmentGroup>
      <SelectorSegment className="bg-[rgba(96,165,250,0.14)] text-[#93c5fd]">{selector.source}</SelectorSegment>
      <SelectorSegment className="bg-card text-foreground font-bold">{selector.name}</SelectorSegment>
    </SelectorSegmentGroup>
  )
}

function SelectorSegmentGroup({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 flex-nowrap items-center overflow-hidden rounded-full border border-border text-secondary-foreground text-[0.9rem] leading-[1.45]">
      {children}
    </span>
  )
}

function SelectorSegment({ children, className }: { children: ReactNode; className: string }) {
  return (
    <code
      className={`inline-flex items-center min-h-[28px] px-2.5 py-1 border-r border-border font-[750] leading-[1.15] last:border-r-0 ${className}`}
    >
      {children}
    </code>
  )
}
