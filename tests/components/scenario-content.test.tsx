import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScenarioContent } from '../../src/app/components/ScenarioContent'
import type { ScenarioView } from '../../src/app/ui/catalog/scenario-view'

describe('ScenarioContent', () => {
  it('renders fixture header pills and the highlighted body html', () => {
    const view: ScenarioView = {
      key: 'frozen', label: 'Frozen', isDefault: false, kind: 'fixture',
      json: JSON.stringify({ status: 403, headers: { 'x-frozen': 'yes' }, body: {} }),
      html: '<pre class="shiki"><code>{}</code></pre>',
    }
    const html = renderToStaticMarkup(<ScenarioContent scenario={view} />)
    expect(html).toContain('x-frozen')
    expect(html).toContain('shiki')
  })

  it('renders resolver views with the source file note', () => {
    const view: ScenarioView = {
      key: 'dynamic', label: 'dynamic', isDefault: false, kind: 'resolver',
      code: 'export default () => "default"', html: '<pre class="shiki"><code>x</code></pre>',
    }
    const html = renderToStaticMarkup(<ScenarioContent scenario={view} />)
    expect(html).toContain('dynamic.mjs')
  })

  it('renders passthrough views with the upstream url or the unset-env note', () => {
    const view: ScenarioView = {
      key: 'real', label: 'Passthrough', isDefault: false, kind: 'passthrough',
      baseUrlEnv: 'X_URL', url: null,
    }
    expect(renderToStaticMarkup(<ScenarioContent scenario={view} />)).toContain('X_URL')
  })
})
