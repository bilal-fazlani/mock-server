'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, GripVertical, Plus, Repeat, RotateCcw, X } from 'lucide-react'
import type { ScenarioSelection } from '../../../lib/profiles/store'
import { scenarioOptionsWithDangling } from '../../../lib/scenarios'
import { ScenarioPicker } from '../../components/ScenarioPicker'
import styles from './ScenarioConfig.module.css'

type Mode = 'single' | 'sequence'

export function ScenarioConfig({
  endpointName,
  scenarios,
  selection,
  fallback,
  servedCount,
  resetAction,
}: {
  endpointName: string
  scenarios: Record<string, string>
  selection: ScenarioSelection | undefined
  fallback: string
  /** Calls served against the saved sequence, when the endpoint has one. */
  servedCount?: number
  /** Server action for the reset-progress button; omitted for new profiles. */
  resetAction?: (formData: FormData) => Promise<void>
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

  return (
    <div className={styles.config}>
      <div className={styles.modeToggle} role="group" aria-label="Scenario mode">
        <button
          type="button"
          className={mode === 'single' ? styles.modeActive : styles.modeButton}
          onClick={() => setMode('single')}
        >
          Single
        </button>
        <button
          type="button"
          className={mode === 'sequence' ? styles.modeActive : styles.modeButton}
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
          />
        </div>
      ) : (
        <div
          className={styles.sequence}
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
                className={`${styles.stepRow} ${dragIndex === index ? styles.stepRowDragging : ''}`}
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
                  className={styles.dragHandle}
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
                  <GripVertical className={styles.dragHandleIcon} aria-hidden="true" />
                </span>
                <span
                  className={`${styles.stepMarker} ${isServed ? styles.stepMarkerServed : ''} ${isNext ? styles.stepMarkerNext : ''}`}
                  title={isServed ? 'Already served' : isNext ? 'Served on the next call' : undefined}
                >
                  {isServed ? <Check className={styles.stepMarkerIcon} aria-hidden="true" /> : index + 1}
                </span>
                <ScenarioSelect
                  value={step}
                  scenarios={options}
                  onChange={(value) => setStep(index, value)}
                  ariaLabel={`Scenario for step ${index + 1}`}
                />
                <span className={styles.stepActions}>
                  <button
                    type="button"
                    className={styles.stepButton}
                    onClick={() => removeStep(index)}
                    disabled={steps.length === 1}
                    aria-label={`Remove step ${index + 1}`}
                  >
                    <X className={styles.stepButtonIcon} aria-hidden="true" />
                  </button>
                </span>
                <span className={styles.stepNote}>
                  {isLast && (
                    <Repeat
                      className={styles.stepNoteIcon}
                      aria-label="Repeats for every further call"
                    >
                      <title>Repeats for every further call</title>
                    </Repeat>
                  )}
                  {isNext && <span className={styles.nextTag}>next</span>}
                </span>
              </div>
            )
          })}
          <div className={styles.sequenceFooter}>
            <button type="button" className={styles.addStep} onClick={addStep}>
              <Plus className={styles.stepButtonIcon} aria-hidden="true" />
              Add step
            </button>
            {served > 0 && (
              <span className={styles.progressMeta}>
                {served} {served === 1 ? 'call' : 'calls'} served
                {resetAction && (
                  <button formAction={resetAction} className={styles.resetButton}>
                    <RotateCcw className={styles.stepButtonIcon} aria-hidden="true" />
                    Reset progress
                  </button>
                )}
              </span>
            )}
            {dirty && savedSteps !== null && (servedCount ?? 0) > 0 && (
              <span className={styles.progressMeta}>progress restarts after save</span>
            )}
          </div>
          <input type="hidden" name={`scenarioSequence:${endpointName}`} value={JSON.stringify(steps)} />
        </div>
      )}
    </div>
  )
}

function scenarioKindClass(key: string): string {
  if (key === 'real') return styles.kindReal
  if (key === 'default') return styles.kindDefault
  return styles.kindNonDefault
}

// Native <select> can't render two-line, color-coded options, so steps use a
// custom listbox styled like the single-mode scenario cards.
function ScenarioSelect({
  value,
  scenarios,
  onChange,
  ariaLabel,
}: {
  value: string
  scenarios: Record<string, string>
  onChange: (value: string) => void
  ariaLabel: string
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
    <div ref={wrapRef} className={styles.scenarioSelect}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.selectTrigger} ${scenarioKindClass(value)}`}
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
        <span className={`${styles.selectDot} ${scenarioKindClass(value)}`} aria-hidden="true" />
        <span className={styles.selectLabel}>{label}</span>
        <ChevronsUpDown className={styles.selectChevron} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={styles.selectMenu}
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
                className={`${styles.selectOption} ${selected ? `${styles.selectOptionSelected} ${scenarioKindClass(key)}` : ''}`}
                onClick={() => {
                  onChange(key)
                  close(true)
                }}
              >
                <span
                  className={`${styles.selectDot} ${selected ? scenarioKindClass(key) : styles.selectDotIdle}`}
                  aria-hidden="true"
                />
                <span className={styles.selectLabel}>{optionLabel}</span>
                {selected && <Check className={styles.selectCheck} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

