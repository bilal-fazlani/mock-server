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
          scenarios: { default: 'Token', expired: 'Expired', dynamic: 'dynamic' },
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
  it('shows the reset button when the saved selection is dynamic', () => {
    expect(render([selection('dynamic')])).toContain('Reset dynamic history')
  })

  it('hides the reset button when the saved selection is not dynamic', () => {
    expect(render([selection('expired')])).not.toContain('Reset dynamic history')
  })

  it('hides the reset button when there is no saved selection', () => {
    expect(render([])).not.toContain('Reset dynamic history')
  })
})
