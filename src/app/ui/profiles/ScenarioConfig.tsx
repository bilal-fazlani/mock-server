'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, CodeXml, GripVertical, Plus, Repeat, RotateCcw, X } from 'lucide-react'
import type { ScenarioSelection } from '../../../lib/profiles/store'
import { scenarioOptionsWithDangling } from '../../../lib/scenarios'
import { ScenarioPicker } from '../../components/ScenarioPicker'

type Mode = 'single' | 'sequence'

const resetButtonClass =
  'inline-flex items-center gap-1.5 bg-background px-2.5 py-1 text-[0.76rem] text-secondary-foreground hover:border-muted-foreground hover:text-foreground'

export function ScenarioConfig({
  endpointName,
  scenarios,
  selection,
  fallback,
  servedCount,
  resetAction,
  resetDynamicAction,
  resolverSlugs = [],
}: {
  endpointName: string
  scenarios: Record<string, string>
  selection: ScenarioSelection | undefined
  fallback: string
  /** Calls served against the saved sequence, when the endpoint has one. */
  servedCount?: number
  /** Server action for the reset-progress button; omitted for new profiles. */
  resetAction?: (formData: FormData) => Promise<void>
  /** Server action for the reset-dynamic-history button; omitted for new profiles. */
  resetDynamicAction?: (formData: FormData) => Promise<void>
  /** Scenario slugs backed by a resolver (x.ts) rather than a fixture. */
  resolverSlugs?: string[]
}) {
  const { options, unavailable } = scenarioOptionsWithDangling(scenarios, selection)
  const savedSteps = Array.isArray(selection) ? selection : null
  const [mode, setMode] = useState<Mode>(savedSteps ? 'sequence' : 'single')
  const [steps, setSteps] = useState<string[]>(savedSteps ?? [])
  const [singleValue, setSingleValue] = useState(
    typeof selection === 'string' ? selection : fallback,
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const gripRefs = useRef<Array<HTMLSpanElement | null>>([])

  const switchToSequence = () => {
    if (steps.length === 0) setSteps([singleValue])
    setMode('sequence')
  }

  const setStep = (index: number, value: string) =>
    setSteps(steps.map((s, i) => (i === index ? value : s)))
  const moveStep = (from: number, to: number) => {
    const next = [...steps]
    const [step] = next.splice(from, 1)
    next.splice(to, 0, step)
    setSteps(next)
  }
  const moveStepWithKeyboard = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= steps.length) return
    moveStep(index, target)
    requestAnimationFrame(() => gripRefs.current[target]?.focus())
  }
  const removeStep = (index: number) => setSteps(steps.filter((_, i) => i !== index))
  const addStep = () => setSteps([...steps, steps[steps.length - 1] ?? fallback])

  const dirty = savedSteps === null || JSON.stringify(steps) !== JSON.stringify(savedSteps)
  const served = !dirty && servedCount ? servedCount : 0
  const nextIndex = Math.min(served, steps.length - 1)

  const involvesResolver = (mode === 'single' ? [singleValue] : steps).some((s) =>
    resolverSlugs.includes(s),
  )

  return (
    <div className="grid min-w-0 gap-2.5">
      <div
        className="inline-flex justify-self-start overflow-hidden rounded-md border border-border"
        role="group"
        aria-label="Scenario mode"
      >
        <button
          type="button"
          className={
            mode === 'single'
              ? 'rounded-none border-0 bg-[var(--accent-tint)] px-3 py-1 text-[0.78rem] font-semibold text-[var(--accent-strong)]'
              : 'rounded-none border-0 bg-transparent px-3 py-1 text-[0.78rem] text-muted-foreground'
          }
          onClick={() => setMode('single')}
        >
          Single
        </button>
        <button
          type="button"
          className={
            (mode === 'sequence'
              ? 'rounded-none border-0 bg-[var(--accent-tint)] px-3 py-1 text-[0.78rem] font-semibold text-[var(--accent-strong)]'
              : 'rounded-none border-0 bg-transparent px-3 py-1 text-[0.78rem] text-muted-foreground') +
            ' border-l border-border'
          }
          onClick={switchToSequence}
        >
          Sequence
        </button>
      </div>

      {mode === 'single' ? (
        <div
          onChange={(e) => {
            const target = e.target as HTMLInputElement
            if (target?.name === `scenario:${endpointName}`) setSingleValue(target.value)
          }}
        >
          <ScenarioPicker
            endpointName={endpointName}
            scenarios={options}
            selected={singleValue}
            unavailable={unavailable}
            resolverSlugs={resolverSlugs}
          />
        </div>
      ) : (
        <div
          className="grid justify-items-start gap-2"
          // Accept the drop anywhere in the sequence area (including the gaps
          // between rows) so the browser never plays its "snap back to
          // origin" animation when the pointer is released.
          onDragOver={(e) => {
            if (dragIndex === null) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDrop={(e) => {
            if (dragIndex === null) return
            e.preventDefault()
            setDragIndex(null)
          }}
        >
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1
            const isServed = served > 0 && index < served && !(isLast && served >= steps.length)
            const isNext = served > 0 && index === nextIndex
            return (
              <div
                key={index}
                ref={(el) => {
                  rowRefs.current[index] = el
                }}
                className={`grid w-full grid-cols-[18px_24px_minmax(0,280px)_auto_auto] items-center justify-start gap-2.5 rounded-md transition-opacity duration-150 max-[700px]:grid-cols-[18px_24px_minmax(0,1fr)_auto] max-[700px]:grid-rows-[auto_auto] ${dragIndex === index ? 'opacity-[0.45]' : ''}`}
                onDragOver={(e) => {
                  if (dragIndex === null || dragIndex === index) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  moveStep(dragIndex, index)
                  setDragIndex(index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragIndex(null)
                }}
              >
                <span
                  ref={(el) => {
                    gripRefs.current[index] = el
                  }}
                  className="inline-flex h-[26px] w-[18px] cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                  role="button"
                  tabIndex={0}
                  draggable
                  aria-label={`Reorder step ${index + 1} — drag, or press the arrow keys`}
                  onDragStart={(e) => {
                    setDragIndex(index)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(index))
                    const row = rowRefs.current[index]
                    if (row) e.dataTransfer.setDragImage(row, 24, 18)
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      moveStepWithKeyboard(index, -1)
                    } else if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      moveStepWithKeyboard(index, 1)
                    }
                  }}
                >
                  <GripVertical className="size-[15px]" aria-hidden="true" />
                </span>
                <span
                  className={`inline-flex size-6 items-center justify-center rounded-full border border-border bg-background text-[0.75rem] font-[650] text-secondary-foreground ${
                    isServed
                      ? 'border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)] text-[var(--success)]'
                      : isNext
                        ? 'border-[rgba(var(--accent-rgb),0.58)] bg-[var(--accent-tint)] text-[var(--accent-strong)]'
                        : ''
                  }`}
                  title={isServed ? 'Already served' : isNext ? 'Served on the next call' : undefined}
                >
                  {isServed ? <Check className="size-[13px] stroke-[2.6]" aria-hidden="true" /> : index + 1}
                </span>
                <ScenarioSelect
                  value={step}
                  scenarios={options}
                  onChange={(value) => setStep(index, value)}
                  ariaLabel={`Scenario for step ${index + 1}`}
                  resolverSlugs={resolverSlugs}
                />
                <span className="inline-flex gap-1">
                  <button
                    type="button"
                    className="inline-flex size-[26px] items-center justify-center bg-background p-0 text-secondary-foreground hover:border-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                    onClick={() => removeStep(index)}
                    disabled={steps.length === 1}
                    aria-label={`Remove step ${index + 1}`}
                  >
                    <X className="size-[13px]" aria-hidden="true" />
                  </button>
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.78rem] text-muted-foreground max-[700px]:col-start-3 max-[700px]:col-end-[-1] max-[700px]:row-start-2">
                  {isLast && (
                    <Repeat className="size-[13px]" aria-label="Repeats for every further call">
                      <title>Repeats for every further call</title>
                    </Repeat>
                  )}
                  {isNext && (
                    <span className="rounded-full border border-[rgba(var(--accent-rgb),0.58)] bg-[var(--accent-tint)] px-[7px] py-px text-[0.7rem] font-[650] text-[var(--accent-strong)]">
                      next
                    </span>
                  )}
                </span>
              </div>
            )
          })}
          <div className="flex w-full flex-wrap items-center gap-2.5">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 bg-background px-3 py-[5px] text-[0.82rem] text-secondary-foreground hover:border-muted-foreground hover:text-foreground"
              onClick={addStep}
            >
              <Plus className="size-[13px]" aria-hidden="true" />
              Add step
            </button>
            {served > 0 && (
              <span className="ml-auto inline-flex items-center gap-2.5 text-[0.78rem] text-muted-foreground">
                {served} {served === 1 ? 'call' : 'calls'} served
                {resetAction && (
                  <button formAction={resetAction} className={resetButtonClass}>
                    <RotateCcw className="size-[13px]" aria-hidden="true" />
                    Reset progress
                  </button>
                )}
              </span>
            )}
            {dirty && savedSteps !== null && (servedCount ?? 0) > 0 && (
              <span className="ml-auto inline-flex items-center gap-2.5 text-[0.78rem] text-muted-foreground">
                progress restarts after save
              </span>
            )}
          </div>
          <input type="hidden" name={`scenarioSequence:${endpointName}`} value={JSON.stringify(steps)} />
        </div>
      )}
      {involvesResolver && resetDynamicAction && (
        <div className="flex w-full flex-wrap items-center gap-2.5">
          <button formAction={resetDynamicAction} className={resetButtonClass}>
            <RotateCcw className="size-[13px]" aria-hidden="true" />
            Reset resolver history
          </button>
        </div>
      )}
    </div>
  )
}

type Kind = 'default' | 'nonDefault' | 'real'

function scenarioKind(key: string): Kind {
  if (key === 'real') return 'real'
  if (key === 'default') return 'default'
  return 'nonDefault'
}

const triggerKindClass: Record<Kind, string> = {
  default: 'border-[var(--success)] bg-[var(--success-tint)]',
  nonDefault: 'border-[var(--warning-border)] bg-[var(--warning-bg)]',
  real: 'border-[#d92d20] bg-[rgba(217,45,32,0.12)]',
}

const dotKindClass: Record<Kind, string> = {
  default: 'border-[var(--success)]',
  nonDefault: 'border-[var(--warning-text)]',
  real: 'border-[#d92d20]',
}

const optionSelectedKindClass: Record<Kind, string> = {
  default: 'border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)]',
  nonDefault: 'border-[var(--warning-border)] bg-[var(--warning-bg)]',
  real: 'border-[#d92d20] bg-[rgba(217,45,32,0.12)]',
}

// Native <select> can't render two-line, color-coded options, so steps use a
// custom listbox styled like the single-mode scenario cards.
function ScenarioSelect({
  value,
  scenarios,
  onChange,
  ariaLabel,
  resolverSlugs = [],
}: {
  value: string
  scenarios: Record<string, string>
  onChange: (value: string) => void
  ariaLabel: string
  resolverSlugs?: string[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) selectedRef.current?.focus()
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  const moveFocus = (delta: number) => {
    const options = wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')
    if (!options || options.length === 0) return
    const current = [...options].indexOf(document.activeElement as HTMLButtonElement)
    const next = current === -1 ? 0 : Math.min(Math.max(current + delta, 0), options.length - 1)
    options[next].focus()
  }

  const label = scenarios[value] ?? value
  return (
    <div ref={wrapRef} className="relative min-w-0 w-full">
      <button
        ref={triggerRef}
        type="button"
        className={`flex w-full min-w-0 items-center gap-[9px] rounded-lg border px-2.5 py-1.5 text-left transition-colors duration-150 ${triggerKindClass[scenarioKind(value)]}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span
          aria-hidden="true"
          className={`size-3.5 flex-none rounded-full border-4 bg-card ${dotKindClass[scenarioKind(value)]}`}
        />
        <span className="min-w-0 text-[0.9rem] font-medium leading-[1.3] text-foreground [overflow-wrap:anywhere]">
          {label}
        </span>
        {resolverSlugs.includes(value) && (
          <CodeXml
            className="size-3.5 flex-none text-muted-foreground"
            aria-label="Resolved by code at request time"
            role="img"
          />
        )}
        <ChevronsUpDown className="ml-auto size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-[calc(100%+6px)] left-0 z-30 flex max-h-80 w-max min-w-full max-w-[340px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-card),0_12px_28px_-10px_rgba(0,0,0,0.7)]"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close(true)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              moveFocus(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              moveFocus(-1)
            } else if (e.key === 'Tab') {
              close(false)
            }
          }}
        >
          {Object.entries(scenarios).map(([key, optionLabel]) => {
            const selected = key === value
            return (
              <button
                key={key}
                ref={selected ? selectedRef : undefined}
                type="button"
                role="option"
                aria-selected={selected}
                className={`flex w-full items-center gap-[9px] rounded-md border border-transparent px-[9px] py-1.5 text-left ${
                  selected
                    ? optionSelectedKindClass[scenarioKind(key)]
                    : 'hover:border-border hover:bg-background'
                }`}
                onClick={() => {
                  onChange(key)
                  close(true)
                }}
              >
                <span
                  aria-hidden="true"
                  className={`size-3.5 flex-none rounded-full bg-card ${
                    selected ? `border-4 ${dotKindClass[scenarioKind(key)]}` : 'border-2 border-border'
                  }`}
                />
                <span className="min-w-0 text-[0.9rem] font-medium leading-[1.3] text-foreground [overflow-wrap:anywhere]">
                  {optionLabel}
                </span>
                {resolverSlugs.includes(key) && (
                  <CodeXml
                    className="size-3.5 flex-none text-muted-foreground"
                    aria-label="Resolved by code at request time"
                    role="img"
                  />
                )}
                {selected && (
                  <Check className="ml-auto size-3.5 flex-none stroke-[2.6] text-secondary-foreground" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
