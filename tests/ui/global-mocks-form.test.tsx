import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import type { GlobalMockScenario } from '../../src/lib/profiles/store'
import { GlobalMocksForm } from '../../src/app/ui/global-mocks/GlobalMocksForm'

const catalog: Catalog = {
  systems: [
    {
      name: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [
        {
          name: 'oauth_token',
          displayName: 'OAuth Token',
          method: 'POST',
          path: '/oauth/token',
          mockType: 'global',
          scenarios: { default: { label: 'Token' }, expired: { label: 'Expired' }, dynamic: { label: 'dynamic' } },
          resolverScenarios: ['dynamic'],
        },
      ],
    },
  ],
}

function selection(scenario: string): GlobalMockScenario {
  return {
    system: 'hello-system',
    endpoint: 'oauth_token',
    scenario,
    createdAt: new Date(),
    modifiedAt: new Date(),
  }
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

function render(selections: GlobalMockScenario[]): string {
  return renderToStaticMarkup(
    <GlobalMocksForm
      catalog={catalog}
      selections={selections}
      passthroughAsDefault={false}
      env={{ HELLO_SYSTEM_URL: 'http://localhost' }}
    />,
  )
}

describe('GlobalMocksForm reset dynamic history button', () => {
  it('shows the reset button when the saved selection is resolver-backed', () => {
    expect(render([selection('dynamic')])).toContain('Reset resolver history')
  })

  it('hides the reset button when the saved selection is not resolver-backed', () => {
    expect(render([selection('expired')])).not.toContain('Reset resolver history')
  })

  it('hides the reset button when there is no saved selection', () => {
    expect(render([])).not.toContain('Reset resolver history')
  })

  it('shows the reset button for an unpinned resolver-backed default (implicit selection)', () => {
    // A GLOBAL endpoint whose `default` is resolver-backed (default.ts, Model A)
    // and left unpinned: saving the implicit `default` stores no row, yet the
    // resolver runs and accumulates history under slug `default`. The reset
    // button must gate on the EFFECTIVE selection (stored ?? implicit), not on
    // whether a row was persisted — matching the profile surface.
    const defaultResolverCatalog: Catalog = {
      systems: [
        {
          ...catalog.systems[0],
          endpoints: [
            {
              ...catalog.systems[0].endpoints[0],
              scenarios: { default: { label: 'Token' }, expired: { label: 'Expired' } },
              resolverScenarios: ['default'],
            },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      <GlobalMocksForm
        catalog={defaultResolverCatalog}
        selections={[]}
        passthroughAsDefault={false}
        env={{ HELLO_SYSTEM_URL: 'http://localhost' }}
      />,
    )
    expect(html).toContain('Reset resolver history')
  })

  it('marks resolver-backed scenarios with a code icon, scoped to that slug', () => {
    const html = render([selection('dynamic')])
    // Exactly one icon — only the resolver-backed slug ("dynamic") carries it,
    // not every option (guards against a flipped/`length > 0` condition).
    const badges = html.match(/aria-label="Resolved by code at request time"/g)
    expect(badges).toHaveLength(1)
    // The icon fills the slot on the resolver-backed option ("dynamic")…
    const resolverChip = chipForValue(html, 'dynamic')
    expect(resolverChip).toContain('aria-label="Resolved by code at request time"')
    expect(resolverChip).toContain('>dynamic<')
    // …and NOT on the fixture-backed options ("Token", "Expired"), which keep
    // their radio dot.
    expect(chipForValue(html, 'default')).not.toContain('aria-label="Resolved by code at request time"')
    expect(chipForValue(html, 'default')).toContain('rounded-full')
    expect(chipForValue(html, 'expired')).not.toContain('aria-label="Resolved by code at request time"')
    expect(chipForValue(html, 'expired')).toContain('rounded-full')
  })
})

describe('GlobalMocksForm catalog link', () => {
  it('links each endpoint card to its catalog page', () => {
    const html = render([])
    expect(html).toContain('href="/ui/catalog/hello-system/oauth_token"')
    expect(html).toContain('View in catalog')
  })

  it('keeps the link when the reset button also renders', () => {
    const html = render([selection('dynamic')])
    expect(html).toContain('Reset resolver history')
    expect(html).toContain('View in catalog')
  })
})
