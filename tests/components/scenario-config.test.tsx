import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioConfig } from '../../src/app/ui/profiles/ScenarioConfig'

const scenarios = { default: 'Success', failure: 'Failure', timeout: 'Timeout', real: 'Passthrough' }

// Each sequence-step trigger is a <button ...class="...">, followed by a dot
// span and then the label span whose text is the human-readable name. Find
// the trigger's own class string by locating the label text and walking back
// to the nearest enclosing trigger button.
function triggerClassForLabel(html: string, label: string): string {
  const labelIndex = html.indexOf(`>${label}<`)
  if (labelIndex === -1) throw new Error(`label ${label} not found`)
  const marker = '<button type="button" class="'
  const btnStart = html.lastIndexOf(marker, labelIndex)
  if (btnStart === -1) throw new Error(`trigger button for ${label} not found`)
  const classStart = btnStart + marker.length
  const classEnd = html.indexOf('"', classStart)
  return html.slice(classStart, classEnd)
}

describe('ScenarioConfig', () => {
  it('renders the single-scenario radio picker for a string selection', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection="failure"
        fallback="default"
      />,
    )
    expect(html.match(/name="scenario:hello_world"/g)).toHaveLength(4)
    expect(html).not.toContain('scenarioSequence:hello_world')
  })

  it('renders the single-scenario picker on the fallback when nothing is selected', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={undefined}
        fallback="default"
      />,
    )
    expect(html).toContain('name="scenario:hello_world"')
  })

  it('renders sequence mode with one scenario picker per step and a hidden JSON field', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={['timeout', 'failure', 'default']}
        fallback="default"
      />,
    )
    expect(html).toContain('name="scenarioSequence:hello_world"')
    expect(html).toContain('[&quot;timeout&quot;,&quot;failure&quot;,&quot;default&quot;]')
    expect(html.match(/aria-haspopup="listbox"/g)).toHaveLength(3)
    expect(html).not.toContain('<select')
    expect(html).not.toContain('name="scenario:hello_world"')
  })

  it('renders step triggers with a one-line label and scenario-kind colors', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={['timeout', 'real', 'default']}
        fallback="default"
      />,
    )
    expect(html).toContain('Timeout')
    // One-line label: only the human-readable name is shown, never the raw key.
    expect(html).not.toMatch(/>timeout</)
    // Scenario-kind color coding on each step's trigger button.
    expect(triggerClassForLabel(html, 'Timeout')).toContain('var(--warning-border)') // nonDefault
    expect(triggerClassForLabel(html, 'Passthrough')).toContain('#d92d20') // real
    expect(triggerClassForLabel(html, 'Success')).toContain('var(--success)') // default
  })

  it('falls back to the scenario key as the label when no name exists', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={{ ...scenarios, mystery_case: 'mystery_case' }}
        selection={['mystery_case']}
        fallback="default"
      />,
    )
    expect(html).toContain('mystery_case')
  })

  it('renders a drag handle per step instead of move buttons', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={['timeout', 'failure', 'default']}
        fallback="default"
      />,
    )
    expect(html.match(/draggable="true"/g)).toHaveLength(3)
    // A single draggable grip icon per step, labeled for reordering by drag
    // (or arrow keys), rather than a pair of up/down move buttons.
    expect(html.match(/aria-label="Reorder step \d+ — drag, or press the arrow keys"/g)).toHaveLength(3)
    expect(html).toContain('lucide-grip-vertical')
    expect(html).not.toContain('Move step')
  })

  it('marks only the last step with a repeat icon, without ordinal text', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={['timeout', 'default']}
        fallback="default"
      />,
    )
    expect(html.match(/lucide-repeat/g)).toHaveLength(1)
    expect(html).not.toContain('1st call')
    expect(html).not.toContain('call onwards')
  })

  it('shows served progress and the next step against the saved sequence', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={['timeout', 'failure', 'default']}
        fallback="default"
        servedCount={2}
      />,
    )
    expect(html).toContain('2 calls served')
    expect(html).toContain('next')
  })

  it('omits progress when no calls were served', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={['timeout', 'default']}
        fallback="default"
      />,
    )
    expect(html).not.toContain('calls served')
  })

  it('shows a dangling single selection as a disabled, checked, labeled option', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection="dynamic"
        fallback="default"
      />,
    )
    expect(html).toContain('Dynamic — unavailable (no _dynamic.ts)')
    expect(html).toMatch(/<input type="radio" disabled=""[^>]*checked="" value="dynamic"/)
  })

  it('shows a dangling sequence step with its unavailable label', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        endpointName="hello_world"
        scenarios={scenarios}
        selection={['default', 'gone']}
        fallback="default"
      />,
    )
    expect(html).toContain('gone — unavailable')
  })
})
