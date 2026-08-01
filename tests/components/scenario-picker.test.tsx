import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioPicker } from '../../src/app/components/ScenarioPicker'
import type { ScenarioOption } from '../../src/lib/scenarios'

const scenarios: Record<string, ScenarioOption> = {
  real: { label: 'Passthrough', kind: 'passthrough' },
  success: { label: 'Hello success', kind: 'fixture' },
  failure: { label: 'Hello failure', kind: 'fixture' },
}

// The chip's own <label …> opening tag — the element Radix clones for the hover
// trigger, so it also shows which attributes the trigger injected.
function labelTagForValue(html: string, value: string): string {
  const valueIndex = html.indexOf(`value="${value}"`)
  if (valueIndex === -1) throw new Error(`value ${value} not found`)
  const start = html.slice(0, valueIndex).lastIndexOf('<label')
  if (start === -1) throw new Error(`label for ${value} not found`)
  return html.slice(start, html.indexOf('>', start) + 1)
}

// Enabled chips are hover-card triggers, so Radix injects its own attributes
// (`data-slot`, `data-state`, …) ahead of `class` on the label — read the class
// attribute out of the opening tag rather than assuming it comes first.
function labelClassForValue(html: string, value: string): string {
  const match = labelTagForValue(html, value).match(/class="([^"]*)"/)
  if (!match) throw new Error(`label class for ${value} not found`)
  return match[1]
}

// The "dot" indicator span (aria-hidden) is the first span rendered after the
// radio input inside each label. Only fixture chips have one — resolver and
// passthrough chips carry an icon in that slot instead.
function dotClassForValue(html: string, value: string): string {
  const valueIndex = html.indexOf(`value="${value}"`)
  if (valueIndex === -1) throw new Error(`value ${value} not found`)
  const marker = '<span aria-hidden="true" class="'
  const spanStart = html.indexOf(marker, valueIndex)
  if (spanStart === -1) throw new Error(`dot span for ${value} not found`)
  const classStart = spanStart + marker.length
  const classEnd = html.indexOf('"', classStart)
  return html.slice(classStart, classEnd)
}

// Resolver and passthrough chips carry an icon wrapper span in the dot's slot —
// same position, no `aria-hidden` — so it is the first plain span after the input.
function iconSlotClassForValue(html: string, value: string): string {
  const valueIndex = html.indexOf(`value="${value}"`)
  if (valueIndex === -1) throw new Error(`value ${value} not found`)
  const marker = '<span class="'
  const spanStart = html.indexOf(marker, valueIndex)
  if (spanStart === -1) throw new Error(`icon slot for ${value} not found`)
  const classStart = spanStart + marker.length
  const classEnd = html.indexOf('"', classStart)
  return html.slice(classStart, classEnd)
}

// One scenario chip's markup: from its radio input to the end of the enclosing
// <label>, so per-slug assertions can never leak into a neighbouring chip.
function chipForValue(html: string, value: string): string {
  const start = html.indexOf(`value="${value}"`)
  if (start === -1) throw new Error(`scenario chip ${value} not found`)
  const end = html.indexOf('</label>', start)
  if (end === -1) throw new Error(`chip ${value} is not closed`)
  return html.slice(start, end)
}

// The label-text span is the next `<span class="...">` after the dot span.
function textSpanClassForValue(html: string, value: string): string {
  const dotClass = dotClassForValue(html, value)
  const dotMarkerIndex = html.indexOf(`<span aria-hidden="true" class="${dotClass}">`, html.indexOf(`value="${value}"`))
  const dotEnd = html.indexOf('</span>', dotMarkerIndex)
  const marker = '<span class="'
  const spanStart = html.indexOf(marker, dotEnd)
  if (spanStart === -1) throw new Error(`text span for ${value} not found`)
  const classStart = spanStart + marker.length
  const classEnd = html.indexOf('"', classStart)
  return html.slice(classStart, classEnd)
}

describe('ScenarioPicker', () => {
  it('renders one named radio input per scenario', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selected="success"
      />,
    )
    expect(html.match(/type="radio"/g)).toHaveLength(3)
    expect(html.match(/name="scenario:hello_world"/g)).toHaveLength(3)
    expect(html).toContain('value="real"')
    expect(html).toContain('value="success"')
    expect(html).toContain('value="failure"')
  })

  it('checks exactly the selected scenario', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selected="success"
      />,
    )
    expect(html.match(/checked=""/g)).toHaveLength(1)
    // React serializes the boolean attribute before value, so the checked
    // input is provably the `success` one.
    expect(html).toContain('checked="" value="success"')
  })

  it('shows only the scenario label, one line, without the key', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selected="real"
      />,
    )
    expect(html).toContain('Hello success')
    expect(html).toContain('Passthrough')
    // keys appear only as radio values, never as visible text
    expect(html).not.toMatch(/>failure</)
    expect(html).not.toMatch(/<span class="[^"]*key[^"]*">/)
  })

  it('allows long scenario option text to wrap instead of forcing page overflow', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selected="success"
      />,
    )
    // The card itself never exceeds its container...
    expect(labelClassForValue(html, 'success')).toContain('max-w-full')
    // ...and the label text is allowed to shrink and wrap anywhere instead of
    // forcing the card wider than the page.
    expect(textSpanClassForValue(html, 'success')).toContain('min-w-0')
    expect(textSpanClassForValue(html, 'success')).toContain('[overflow-wrap:anywhere]')
  })

  it('marks only non-default and non-real scenarios for alternate selected styling', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{
          default: { label: 'Default success', kind: 'fixture' },
          failure: { label: 'Failure', kind: 'fixture' },
          real: { label: 'Passthrough', kind: 'passthrough' },
        }}
        selected="failure"
      />,
    )

    // "Alternate" (warning/amber) styling is the nonDefault tone's `has-[:checked]`
    // classes; only the non-default, non-real scenario should carry them.
    expect(labelClassForValue(html, 'failure')).toContain('has-[:checked]:border-[var(--warning-border)]')
    expect(labelClassForValue(html, 'failure')).toContain('has-[:checked]:bg-[var(--warning-bg)]')
    expect(labelClassForValue(html, 'default')).not.toContain('warning-border')
    expect(labelClassForValue(html, 'real')).not.toContain('warning-border')
  })

  it('uses green for default, red for real, and yellow for other selected scenarios', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{
          default: { label: 'Default success', kind: 'fixture' },
          failure: { label: 'Failure', kind: 'fixture' },
          real: { label: 'Passthrough', kind: 'passthrough' },
        }}
        selected="failure"
      />,
    )

    // Card border/background per tone, applied when the radio is checked.
    expect(labelClassForValue(html, 'default')).toContain('has-[:checked]:border-[var(--success)]')
    expect(labelClassForValue(html, 'default')).toContain('has-[:checked]:bg-[var(--success-tint)]')
    expect(labelClassForValue(html, 'real')).toContain('has-[:checked]:border-[#d92d20]')
    expect(labelClassForValue(html, 'real')).toContain('has-[:checked]:bg-[rgba(217,45,32,0.12)]')
    expect(labelClassForValue(html, 'failure')).toContain('has-[:checked]:border-[var(--warning-border)]')
    expect(labelClassForValue(html, 'failure')).toContain('has-[:checked]:bg-[var(--warning-bg)]')

    // The slot indicator follows the same per-tone coloring — the dot for
    // fixtures, the icon for passthrough.
    expect(dotClassForValue(html, 'default')).toContain('peer-checked:border-[var(--success)]')
    expect(dotClassForValue(html, 'failure')).toContain('peer-checked:border-[var(--warning-text)]')
    expect(iconSlotClassForValue(html, 'real')).toContain('peer-checked:text-[#d92d20]')
  })

  it('replaces the radio circle with a file-code icon on resolver chips and a globe on real', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{
          default: { label: 'Default', kind: 'fixture' },
          dynamic: { label: 'dynamic', kind: 'resolver' },
          real: { label: 'Passthrough', kind: 'passthrough' },
        }}
        selected="default"
      />,
    )
    expect(html).toContain('aria-label="Resolved by code at request time"')
    expect(html).toContain('aria-label="Forwards to the live upstream"')
    // fixtures keep the radio dot; icon chips have no dot span
    expect(dotClassForValue(html, 'default')).toContain('rounded-full')
    expect(() => dotClassForValue(html, 'dynamic')).toThrow()
  })

  it('renders enabled chips as hover-card triggers but leaves unavailable chips bare', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{
          success: { label: 'Hello success', kind: 'fixture' },
          ghost: { label: 'ghost — unavailable', kind: 'fixture' },
        }}
        selected="success"
        unavailable={['ghost']}
      />,
    )
    // one trigger (success); the dangling chip gets no data-state attribute
    expect(html.match(/data-state="closed"/g)?.length).toBeGreaterThanOrEqual(1)
    expect(labelTagForValue(html, 'success')).toContain('data-state="closed"')
    // Bare means bare: a dangling pin's view route 404s, so it must not become a
    // trigger — no hover card, no modal, however it is styled.
    expect(labelTagForValue(html, 'ghost')).not.toContain('data-state')
    expect(labelTagForValue(html, 'ghost')).not.toContain('hover-card-trigger')
    const ghostLabel = labelClassForValue(html, 'ghost')
    expect(ghostLabel).toContain('opacity-55')
  })

  it('renders an unavailable scenario as a disabled radio that still shows as selected', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{ ...scenarios, dynamic: { label: 'dynamic — unavailable', kind: 'fixture' } }}
        selected="dynamic"
        unavailable={['dynamic']}
      />,
    )
    // Visually marked as unavailable: dimmed card, not-allowed cursor, and
    // struck-through label text.
    expect(labelClassForValue(html, 'dynamic')).toContain('opacity-55')
    expect(labelClassForValue(html, 'dynamic')).toContain('cursor-not-allowed')
    expect(textSpanClassForValue(html, 'dynamic')).toContain('line-through')
    expect(html).toMatch(/<input type="radio" disabled=""[^>]*checked="" value="dynamic"/)
  })

  it('shows an inline warning icon on the passthrough chip when its base URL is not set', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{
          success: { label: 'Hello success', kind: 'fixture' },
          real: { label: 'Passthrough', kind: 'passthrough', baseUrlEnv: 'HELLO_SYSTEM_URL', url: null },
        }}
        selected="success"
      />,
    )
    expect(chipForValue(html, 'real')).toContain('aria-label="HELLO_SYSTEM_URL is not set"')
  })

  it('omits the warning icon on the passthrough chip once its base URL resolves', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{
          success: { label: 'Hello success', kind: 'fixture' },
          real: {
            label: 'Passthrough',
            kind: 'passthrough',
            baseUrlEnv: 'HELLO_SYSTEM_URL',
            url: 'http://localhost:9999',
          },
        }}
        selected="success"
      />,
    )
    expect(chipForValue(html, 'real')).not.toContain('is not set')
  })

  it('does not disable scenarios outside the unavailable list', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selected="success"
        unavailable={['failure']}
      />,
    )
    expect(labelClassForValue(html, 'success')).not.toContain('opacity-55')
    expect(labelClassForValue(html, 'success')).not.toContain('cursor-not-allowed')
    expect(textSpanClassForValue(html, 'success')).not.toContain('line-through')
    expect(html).not.toContain('disabled="" value="success"')
  })
})
