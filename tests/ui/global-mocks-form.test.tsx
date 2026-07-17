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

  it('marks resolver-backed scenarios with a code badge, scoped to that slug', () => {
    const html = render([selection('dynamic')])
    // Exactly one badge — only the resolver-backed slug ("dynamic") carries it,
    // not every option (guards against a flipped/`length > 0` condition).
    const badges = html.match(/aria-label="Resolved by code at request time"/g)
    expect(badges).toHaveLength(1)
    // The badge sits on the resolver-backed option ("dynamic")…
    expect(html).toMatch(/>dynamic<\/span><svg[^>]*aria-label="Resolved by code at request time"/)
    // …and NOT on the fixture-backed options ("Token", "Expired").
    expect(html).not.toMatch(/>Token<\/span><svg[^>]*aria-label="Resolved by code at request time"/)
    expect(html).not.toMatch(/>Expired<\/span><svg[^>]*aria-label="Resolved by code at request time"/)
  })
})
