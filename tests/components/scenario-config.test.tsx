import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioConfig } from '../../src/app/ui/profiles/ScenarioConfig'

const scenarios = { default: 'Success', failure: 'Failure', timeout: 'Timeout', real: 'Passthrough' }

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
    expect(html).toContain('selectLabel')
    expect(html).not.toContain('selectKey')
    expect(html).not.toMatch(/>timeout</)
    expect(html).toContain('kindNonDefault')
    expect(html).toContain('kindReal')
    expect(html).toContain('kindDefault')
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
    expect(html).toContain('dragHandle')
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
