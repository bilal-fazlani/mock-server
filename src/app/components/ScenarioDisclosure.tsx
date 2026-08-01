'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SquareArrowOutUpRight, TriangleAlert } from 'lucide-react'
import type { ScenarioOption } from '../../lib/scenarios'
import type { ScenarioView } from '../ui/catalog/scenario-view'
import { ScenarioContent } from './ScenarioContent'
import { StatusPill } from './StatusPill'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'

// Views are immutable for the life of the page (catalog reloads restart the
// server), so cache per scenario and dedupe concurrent opens. Failed fetches
// are evicted so Retry actually retries.
const viewCache = new Map<string, Promise<ScenarioView>>()

function fetchView(system: string, endpointName: string, slug: string): Promise<ScenarioView> {
  const key = `${system}/${endpointName}/${slug}`
  let pending = viewCache.get(key)
  if (!pending) {
    pending = fetch(
      `/ui/api/catalog/${encodeURIComponent(system)}/${encodeURIComponent(endpointName)}/scenarios/${encodeURIComponent(slug)}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`http_${res.status}`))))
      .then((data: { view: ScenarioView }) => data.view)
    viewCache.set(key, pending)
    pending.catch(() => viewCache.delete(key))
  }
  return pending
}

export function ScenarioHoverCardBody({
  option,
  onViewResponse,
}: {
  option: ScenarioOption
  onViewResponse?: () => void
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[0.9rem] font-semibold text-foreground">{option.label}</span>
        <StatusPill value={option.status ?? null} />
      </div>
      {option.summary && (
        <p data-slot="scenario-summary" className="m-0 text-[0.8rem] leading-[1.4] text-muted-foreground [overflow-wrap:anywhere]">
          {option.summary}
        </p>
      )}
      {option.kind === 'passthrough' &&
        (option.url ? (
          <p className="m-0 font-mono text-[0.8rem] leading-[1.4] text-secondary-foreground [overflow-wrap:anywhere]">
            <span className="text-muted-foreground">&rarr;</span> {option.url}
          </p>
        ) : (
          <div className="flex items-start gap-1.5 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2 py-1.5 text-[0.76rem] leading-[1.4] text-[var(--warning-text)]">
            <TriangleAlert className="mt-0.5 size-3.5 flex-none" aria-hidden="true" />
            <span>
              <code className="font-mono text-[0.72rem]">{option.baseUrlEnv}</code> is not set — requests
              will fail.
            </span>
          </div>
        ))}
      {option.kind !== 'passthrough' && onViewResponse && (
        <button
          type="button"
          className="justify-self-start border-0 bg-transparent p-0 text-[0.78rem] text-[var(--accent-strong)] underline-offset-2 hover:underline"
          onClick={onViewResponse}
        >
          {option.kind === 'resolver' ? 'View resolver code →' : 'View full response →'}
        </button>
      )}
    </div>
  )
}

type ModalState =
  | { kind: 'loading' }
  | { kind: 'error'; retry: () => void }
  | { kind: 'ready'; view: ScenarioView }

export function ScenarioResponseModalBody({
  state,
  option,
  catalogHref,
  endpointDisplayName,
}: {
  state: ModalState
  option: ScenarioOption
  catalogHref: string
  endpointDisplayName: string
}) {
  return (
    <div className="grid gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 pr-8">
        <DialogTitle>{option.label}</DialogTitle>
        <StatusPill value={option.status ?? null} />
      </div>
      {option.summary && (
        <p className="m-0 text-[0.82rem] leading-[1.4] text-muted-foreground [overflow-wrap:anywhere]">{option.summary}</p>
      )}
      {state.kind === 'loading' && (
        <div className="h-24 animate-pulse rounded-md border border-border bg-background" aria-label="Loading response" />
      )}
      {state.kind === 'error' && (
        <p className="m-0 text-[0.85rem] text-[var(--warning-text)]">
          Could not load the response.{' '}
          <button type="button" className="border-0 bg-transparent p-0 text-[0.85rem] underline" onClick={state.retry}>
            Retry
          </button>
        </p>
      )}
      {state.kind === 'ready' && <ScenarioContent scenario={state.view} />}
      <Link
        href={catalogHref}
        className="inline-flex items-center gap-1.5 justify-self-start text-[0.78rem] text-muted-foreground hover:text-foreground hover:no-underline"
      >
        <SquareArrowOutUpRight className="size-3" aria-hidden="true" />
        Open {endpointDisplayName} in the catalog
      </Link>
    </div>
  )
}

export function ScenarioDisclosure({
  system,
  endpointName,
  endpointDisplayName,
  slug,
  option,
  suppressed = false,
  initialView,
  children,
}: {
  system: string
  endpointName: string
  endpointDisplayName: string
  slug: string
  option: ScenarioOption
  suppressed?: boolean
  initialView?: ScenarioView
  children: React.ReactElement
}) {
  const [hoverOpen, setHoverOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [view, setView] = useState<ScenarioView | null>(initialView ?? null)
  const [failed, setFailed] = useState(false)

  // Radix only calls `onOpenChange` when the controlled value actually changes.
  // While suppressed the rendered `open` is already false, so the pointer-leave
  // that would normally clear `hoverOpen` never reaches us — and the card would
  // pop back open the moment suppression lifts (hover a step, open the dropdown,
  // pick an option: the card reappears with the pointer nowhere near it). Drop
  // the stale intent as suppression turns on, using React's documented
  // adjust-state-on-prop-change pattern rather than an effect.
  const [wasSuppressed, setWasSuppressed] = useState(suppressed)
  if (suppressed !== wasSuppressed) {
    setWasSuppressed(suppressed)
    if (suppressed) setHoverOpen(false)
  }

  // Fetch the prepared view the first time the dialog opens (LogRow pattern).
  useEffect(() => {
    if (!dialogOpen || view || failed) return
    let cancelled = false
    fetchView(system, endpointName, slug)
      .then((v) => {
        if (!cancelled) setView(v)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [dialogOpen, view, failed, system, endpointName, slug])

  const state: ModalState = view
    ? { kind: 'ready', view }
    : failed
      ? { kind: 'error', retry: () => setFailed(false) }
      : { kind: 'loading' }

  return (
    <>
      <HoverCard open={hoverOpen && !suppressed} onOpenChange={setHoverOpen}>
        <HoverCardTrigger asChild>{children}</HoverCardTrigger>
        <HoverCardContent>
          <ScenarioHoverCardBody
            option={option}
            onViewResponse={
              option.kind === 'passthrough'
                ? undefined
                : () => {
                    setHoverOpen(false)
                    setDialogOpen(true)
                  }
            }
          />
        </HoverCardContent>
      </HoverCard>
      {option.kind !== 'passthrough' && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent aria-describedby={undefined}>
            <ScenarioResponseModalBody
              state={state}
              option={option}
              catalogHref={`/ui/catalog/${system}/${endpointName}`}
              endpointDisplayName={endpointDisplayName}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
