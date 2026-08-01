import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioConfig, ScenarioOptionRow } from '../../src/app/ui/profiles/ScenarioConfig'
import type { ScenarioOption } from '../../src/lib/scenarios'

const scenarios: Record<string, ScenarioOption> = {
  default: { label: 'Success', kind: 'fixture' },
  failure: { label: 'Failure', kind: 'fixture' },
  timeout: { label: 'Timeout', kind: 'fixture' },
  real: { label: 'Passthrough', kind: 'passthrough' },
}

// Summaries live on the option, so the dropdown rows and the step hover cards
// have a second line to show.
const seqScenarios: Record<string, ScenarioOption> = {
  default: { label: 'Active', summary: 'Customer is in good standing.', status: 200, kind: 'fixture' },
  frozen: { label: 'Frozen', summary: 'Account actions blocked.', status: 200, kind: 'fixture' },
  real: { label: 'Passthrough', summary: 'Forwards the request to the live upstream service.', kind: 'passthrough' },
}

// Each sequence-step trigger is a <button …>, followed by the slot indicator and
// then the label span whose text is the human-readable name. Find the trigger's
// own opening tag by locating the label text and walking back to the nearest
// enclosing button. Available steps are hover-card triggers, so Radix injects
// its own attributes (`data-slot`, `data-state`, …) ahead of `type`/`class` —
// return the whole tag rather than assuming any attribute order.
function triggerTagForLabel(html: string, label: string): string {
  const labelIndex = html.indexOf(`>${label}<`)
  if (labelIndex === -1) throw new Error(`label ${label} not found`)
  const start = html.lastIndexOf('<button', labelIndex)
  if (start === -1) throw new Error(`trigger button for ${label} not found`)
  return html.slice(start, html.indexOf('>', start) + 1)
}

function triggerClassForLabel(html: string, label: string): string {
  const match = triggerTagForLabel(html, label).match(/class="([^"]*)"/)
  if (!match) throw new Error(`trigger class for ${label} not found`)
  return match[1]
}

describe('ScenarioConfig', () => {
  it('renders the single-scenario radio picker for a string selection', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={{ ...scenarios, mystery_case: { label: 'mystery_case', kind: 'fixture' } }}
        selection={['mystery_case']}
        fallback="default"
      />,
    )
    expect(html).toContain('mystery_case')
  })

  it('renders a drag handle per step instead of move buttons', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
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
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selection="ghost"
        fallback="default"
      />,
    )
    expect(html).toContain('ghost — unavailable')
    expect(html).toMatch(/<input type="radio" disabled=""[^>]*checked="" value="ghost"/)
  })

  it('shows a dangling sequence step with its unavailable label', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selection={['default', 'gone']}
        fallback="default"
      />,
    )
    expect(html).toContain('gone — unavailable')
  })

  it('renders each sequence step trigger as a hover-card trigger', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        system="hello-system"
        endpointName="customer_status"
        endpointDisplayName="Customer Status"
        scenarios={seqScenarios}
        selection={['frozen', 'default']}
        fallback="default"
      />,
    )
    // two steps → at least two closed hover-card triggers
    expect(html.match(/data-state="closed"/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the closed popup out of static markup (options render only when open)', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        system="hello-system"
        endpointName="customer_status"
        endpointDisplayName="Customer Status"
        scenarios={seqScenarios}
        selection={['frozen']}
        fallback="default"
      />,
    )
    expect(html).not.toContain('role="listbox"')
    // summaries therefore appear only via hover cards/popup, not in the base markup
    expect(html).not.toContain('Customer is in good standing.')
  })

  it('leaves a dangling step trigger bare while still wrapping available steps', () => {
    const html = renderToStaticMarkup(
      <ScenarioConfig
        system="hello-system"
        endpointName="hello_world"
        endpointDisplayName="Hello World"
        scenarios={scenarios}
        selection={['default', 'gone']}
        fallback="default"
      />,
    )
    // The declared step is a hover-card trigger…
    expect(triggerTagForLabel(html, 'Success')).toContain('data-state="closed"')
    // …but a dangling pin has no catalog entry — its view route 404s, so the
    // trigger must stay bare rather than offer a permanently-failing modal.
    expect(triggerTagForLabel(html, 'gone — unavailable')).not.toContain('data-state')
    expect(triggerTagForLabel(html, 'gone — unavailable')).not.toContain('hover-card-trigger')
  })
})

describe('ScenarioOptionRow', () => {
  it('renders an option row with label, summary second line, and selection check', () => {
    const html = renderToStaticMarkup(
      <ScenarioOptionRow slug="default" option={seqScenarios.default} selected onSelect={() => {}} />,
    )
    expect(html).toContain('Active')
    expect(html).toContain('Customer is in good standing.')
    expect(html).toContain('role="option"')
    expect(html).toContain('aria-selected="true"')
  })

  it('renders the globe icon slot for the passthrough option row', () => {
    const html = renderToStaticMarkup(
      <ScenarioOptionRow slug="real" option={seqScenarios.real} selected={false} onSelect={() => {}} />,
    )
    expect(html).toContain('aria-label="Forwards to the live upstream"')
  })
})
