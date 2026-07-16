import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioPicker } from '../../src/app/components/ScenarioPicker'

const scenarios = { real: 'Passthrough', success: 'Hello success', failure: 'Hello failure' }

function labelClassForValue(html: string, value: string): string {
  const valueIndex = html.indexOf(`value="${value}"`)
  if (valueIndex === -1) throw new Error(`value ${value} not found`)
  const labelStart = html.lastIndexOf('<label class="', valueIndex)
  if (labelStart === -1) throw new Error(`label for ${value} not found`)
  const classStart = labelStart + '<label class="'.length
  const classEnd = html.indexOf('"', classStart)
  return html.slice(classStart, classEnd)
}

// The "dot" indicator span (aria-hidden) is the first span rendered after the
// radio input inside each label.
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
      <ScenarioPicker endpointName="hello_world" scenarios={scenarios} selected="success" />,
    )
    expect(html.match(/type="radio"/g)).toHaveLength(3)
    expect(html.match(/name="scenario:hello_world"/g)).toHaveLength(3)
    expect(html).toContain('value="real"')
    expect(html).toContain('value="success"')
    expect(html).toContain('value="failure"')
  })

  it('checks exactly the selected scenario', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker endpointName="hello_world" scenarios={scenarios} selected="success" />,
    )
    expect(html.match(/checked=""/g)).toHaveLength(1)
    // React serializes the boolean attribute before value, so the checked
    // input is provably the `success` one.
    expect(html).toContain('checked="" value="success"')
  })

  it('shows only the scenario label, one line, without the key', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker endpointName="hello_world" scenarios={scenarios} selected="real" />,
    )
    expect(html).toContain('Hello success')
    expect(html).toContain('Passthrough')
    // keys appear only as radio values, never as visible text
    expect(html).not.toMatch(/>failure</)
    expect(html).not.toMatch(/<span class="[^"]*key[^"]*">/)
  })

  it('allows long scenario option text to wrap instead of forcing page overflow', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker endpointName="hello_world" scenarios={scenarios} selected="success" />,
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
        endpointName="hello_world"
        scenarios={{ default: 'Default success', failure: 'Failure', real: 'Passthrough' }}
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
        endpointName="hello_world"
        scenarios={{ default: 'Default success', failure: 'Failure', real: 'Passthrough' }}
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

    // The dot indicator follows the same per-tone coloring.
    expect(dotClassForValue(html, 'default')).toContain('peer-checked:border-[var(--success)]')
    expect(dotClassForValue(html, 'real')).toContain('peer-checked:border-[#d92d20]')
    expect(dotClassForValue(html, 'failure')).toContain('peer-checked:border-[var(--warning-text)]')
  })

  it('renders an unavailable scenario as a disabled radio that still shows as selected', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        endpointName="hello_world"
        scenarios={{ ...scenarios, dynamic: 'Dynamic — unavailable (no _dynamic.ts)' }}
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

  it('does not disable scenarios outside the unavailable list', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        endpointName="hello_world"
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
