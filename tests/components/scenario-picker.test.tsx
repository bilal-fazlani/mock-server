import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioPicker } from '../../src/app/components/ScenarioPicker'

const scenarios = { real: 'Passthrough', success: 'Hello success', failure: 'Hello failure' }
const scenarioPickerCss = () =>
  readFileSync(new URL('../../src/app/components/ScenarioPicker.module.css', import.meta.url), 'utf8')

function labelClassForValue(html: string, value: string): string {
  const valueIndex = html.indexOf(`value="${value}"`)
  if (valueIndex === -1) throw new Error(`value ${value} not found`)
  const labelStart = html.lastIndexOf('<label class="', valueIndex)
  if (labelStart === -1) throw new Error(`label for ${value} not found`)
  const classStart = labelStart + '<label class="'.length
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
    const css = scenarioPickerCss()
    expect(css).toMatch(/\.card\s*{[^}]*max-width:\s*100%;/s)
    expect(css).toMatch(/\.label\s*{[^}]*min-width:\s*0;/s)
    expect(css).toMatch(/\.label\s*{[^}]*overflow-wrap:\s*anywhere;/s)
  })

  it('marks only non-default and non-real scenarios for alternate selected styling', () => {
    const html = renderToStaticMarkup(
      <ScenarioPicker
        endpointName="hello_world"
        scenarios={{ default: 'Default success', failure: 'Failure', real: 'Passthrough' }}
        selected="failure"
      />,
    )

    expect(labelClassForValue(html, 'failure')).toContain('nonDefault')
    expect(labelClassForValue(html, 'default')).not.toContain('nonDefault')
    expect(labelClassForValue(html, 'real')).not.toContain('nonDefault')
  })

  it('uses green for default, red for real, and yellow for other selected scenarios', () => {
    const css = scenarioPickerCss()
    expect(css).toMatch(/\.card:has\(\.input:checked\)\s*{[^}]*border-color:\s*var\(--success\);/s)
    expect(css).toMatch(/\.card:has\(\.input:checked\)\s*{[^}]*background:\s*var\(--success-tint\);/s)
    expect(css).toMatch(/\.real:has\(\.input:checked\)\s*{[^}]*border-color:\s*#d92d20;/s)
    expect(css).toMatch(/\.real:has\(\.input:checked\)\s*{[^}]*background:\s*rgba\(217,\s*45,\s*32,\s*0\.12\);/s)
    expect(css).toMatch(/\.nonDefault:has\(\.input:checked\)\s*{[^}]*border-color:\s*var\(--warning-border\);/s)
    expect(css).toMatch(/\.nonDefault:has\(\.input:checked\)\s*{[^}]*background:\s*var\(--warning-bg\);/s)
    expect(css).toMatch(/\.nonDefault:has\(\.input:checked\) \.dot\s*{[^}]*border-color:\s*var\(--warning-text\);/s)
  })
})
