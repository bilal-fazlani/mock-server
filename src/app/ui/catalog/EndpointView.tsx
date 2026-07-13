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
import { MethodBadge } from '../../components/MethodBadge'
import { SchemaBadge } from '../../components/SchemaBadge'
import { CopyCurlButton } from './CopyCurlButton'
import { EndpointScenarios } from './EndpointScenarios'
import type { ScenarioView } from './scenario-view'
import styles from './endpoint.module.css'

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
    <main className={styles.page}>
      <div className={styles.stickyHeader}>
        <Link href="/ui/catalog" className="btnSecondary">
          ← Catalog
        </Link>
        <div className={styles.header}>
          <MethodBadge method={endpoint.method} />
          <code className={styles.path}>{endpoint.path}</code>
          <span className={styles.displayName}>{endpoint.displayName}</span>
          {mockType === 'global' && <span className={styles.globalTag}>Global</span>}
          {endpoint.schema && <SchemaBadge />}
          <span className={styles.headerActions}>
            <CopyCurlButton example={buildEndpointRequestExample(endpoint)} />
          </span>
        </div>
      </div>

      <section className={styles.configurationPanel} aria-label="Endpoint configuration">
        <div className={styles.config}>
          <div className={styles.configRow}>
            <span className={styles.configIconTooltip} title="System" aria-label="System">
              <Server className={`${styles.configIcon} ${styles.systemIcon}`} aria-hidden="true" />
            </span>
            <span className={styles.rowLabel}>system</span>
            <div className={styles.systemValue}>
              <span className={styles.systemName}>{system.name}</span>
              {showBaseUrl &&
                (baseUrl ? (
                  <code className={styles.baseUrl}>{baseUrl}</code>
                ) : (
                  <span className={styles.notSet}>(base URL not set)</span>
                ))}
            </div>
          </div>
          {mockType === 'profiled' && (
            <>
              <div className={`${styles.configRow} ${profileViaKey ? styles.configRowTop : ''}`}>
                <span
                  className={styles.configIconTooltip}
                  title={
                    profileViaKey
                      ? 'Profile resolved via a previously captured key'
                      : 'Profile ID selector'
                  }
                  aria-label="Profile ID selector"
                >
                  <UserRound
                    className={`${styles.configIcon} ${styles.profileIcon}`}
                    aria-hidden="true"
                  />
                </span>
                <span className={styles.rowLabel}>{profileViaKey ? 'profile via' : 'profile'}</span>
                <div className={styles.configValueWithIcon}>
                  <ProfileSelectorDisplay
                    raw={endpoint.profileIdSelector}
                    catalog={catalog}
                    current={current}
                  />
                </div>
              </div>
              {captureProfileKeys.length > 0 && (
                <div
                  className={`${styles.configRow} ${captureProfileKeys.length > 1 ? styles.configRowTop : ''}`}
                >
                  <span
                    className={styles.configIconTooltip}
                    title="Stores each key → this profile, so later calls can correlate by key alone"
                    aria-label="Captures profile keys"
                  >
                    <Save className={`${styles.configIcon} ${styles.mappingIcon}`} aria-hidden="true" />
                  </span>
                  <span className={styles.rowLabel}>captures</span>
                  <div className={styles.mappingValue}>
                    <div className={styles.mappingList}>
                      {captureProfileKeys.map((capture) => (
                        <span key={`${capture.namespace}:${capture.keySelector}`} className={`${styles.mappingInline} ${styles.selectorCapture}`}>
                          <SelectorDisplay raw={capture.keySelector} />
                          <span className={styles.selectorArrow} aria-hidden="true">→</span>
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
      <span className={styles.lookupValue}>
        <span className={styles.selectorFlow}>
          <SelectorDisplay raw={nestedRaw} />
          <span className={styles.selectorArrow} aria-hidden="true">→</span>
          <NamespaceChip namespace={selector.namespace} catalog={catalog} current={current} />
          <span className={styles.selectorArrow} aria-hidden="true">→</span>
          <span className={styles.profileResultChip}>
            <UserRound className={styles.profileResultIcon} aria-hidden="true" />
            profile
          </span>
        </span>
        <span className={styles.lookupHint}>
          Needs a mapping captured by an earlier call — responds 404 until then.
        </span>
      </span>
    )
  }

  if (selector?.source === 'bearer') {
    return (
      <SelectorSegmentGroup>
        <SelectorSegment className={styles.selectorBearer}>bearer</SelectorSegment>
        {selector.claim && (
          <SelectorSegment className={styles.selectorValue}>{selector.claim}</SelectorSegment>
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
    <span className={styles.namespaceRef} tabIndex={0}>
      <SelectorSegmentGroup>
        <SelectorSegment className={styles.selectorProfileKey}>profileKey</SelectorSegment>
        <SelectorSegment className={`${styles.selectorNamespace} ${styles.namespaceInteractive}`}>
          {namespace}
        </SelectorSegment>
      </SelectorSegmentGroup>
      <span className={styles.namespacePopover} role="tooltip">
        <span className={styles.namespacePopoverCard}>
          <span className={styles.popoverTitle}>
            Correlation key <code>{namespace}</code>
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
    <span className={styles.popoverSection}>
      <span className={styles.popoverLabel}>{label}</span>
      {entries.length === 0 ? (
        <span className={styles.popoverEmpty}>{empty}</span>
      ) : (
        entries.map(({ system, endpoint }) => {
          const key = `${system.slug}/${endpoint.name}`
          const isCurrent =
            system.slug === current.systemSlug && endpoint.name === current.endpointName
          const content = (
            <>
              <code className={styles.popoverMethod}>{endpoint.method.toUpperCase()}</code>
              <span className={styles.popoverName}>{endpoint.displayName}</span>
            </>
          )
          if (isCurrent) {
            return (
              <span key={key} className={`${styles.popoverEntry} ${styles.popoverCurrent}`}>
                {content}
                <span className={styles.popoverThis}>this endpoint</span>
              </span>
            )
          }
          return (
            <Link
              key={key}
              href={`/ui/catalog/${system.slug}/${endpoint.name}`}
              className={styles.popoverEntry}
            >
              {content}
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
        <SelectorSegment className={styles.selectorProfileKey}>profileKey</SelectorSegment>
        <SelectorSegment className={styles.selectorNamespace}>{selector.namespace}</SelectorSegment>
        <SelectorSegment className={styles.selectorValue}>{nestedRaw}</SelectorSegment>
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
    return <code className={styles.selectorBody}>{raw}</code>
  }

  return (
    <SelectorSegmentGroup>
      <SelectorSegment className={selector.source === 'path' ? styles.selectorPath : styles.selectorQuery}>
        {selector.source}
      </SelectorSegment>
      <SelectorSegment className={styles.selectorValue}>{selector.name}</SelectorSegment>
    </SelectorSegmentGroup>
  )
}

function SelectorSegmentGroup({ children }: { children: ReactNode }) {
  return <span className={styles.selectorSegments}>{children}</span>
}

function SelectorSegment({ children, className }: { children: ReactNode; className: string }) {
  return <code className={`${styles.selectorSegment} ${className}`}>{children}</code>
}
