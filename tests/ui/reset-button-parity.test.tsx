import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import type { GlobalMockScenario } from '../../src/lib/profiles/store'
import { GlobalMocksForm } from '../../src/app/ui/global-mocks/GlobalMocksForm'
import { ProfileForm } from '../../src/app/ui/profiles/ProfileForm'

// The two surfaces used to carry their own copy of the reset button's class
// string, which is how they drifted apart in the first place (#2). Both now go
// through the shared `ResetButton`, and this test is what keeps them there.

const endpoint = {
  displayName: 'Hello World',
  method: 'POST' as const,
  path: '/hello/world',
  scenarios: { default: { label: 'Hello success' }, 'by-amount': { label: 'By amount' } },
  resolverScenarios: ['by-amount'],
}

const profiledCatalog: Catalog = {
  systems: [
    {
      name: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [{ ...endpoint, name: 'hello_world', profileIdSelector: '$.customerId' }],
    },
  ],
}

const globalCatalog: Catalog = {
  systems: [
    {
      name: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [{ ...endpoint, name: 'hello_world', mockType: 'global' as const }],
    },
  ],
}

const globalSelection: GlobalMockScenario = {
  system: 'hello-system',
  endpoint: 'hello_world',
  scenario: 'by-amount',
  createdAt: new Date(),
  modifiedAt: new Date(),
}

/** The button element wrapping `label`, from its opening tag to the label. */
function buttonFor(html: string, label: string): string {
  const end = html.indexOf(label)
  if (end === -1) throw new Error(`"${label}" not found`)
  const start = html.lastIndexOf('<button', end)
  if (start === -1) throw new Error(`"${label}" is not inside a button`)
  return html.slice(start, end + label.length)
}

/** That button's class attribute, which is the part that used to be duplicated. */
function classOf(button: string): string {
  const match = button.match(/class="([^"]*)"/)
  if (!match) throw new Error('button has no class attribute')
  return match[1]
}

// A profile pinned to a resolver-backed sequence with progress: renders both
// "Reset progress" and "Reset resolver history".
const profileHtml = renderToStaticMarkup(
  <ProfileForm
    catalog={profiledCatalog}
    profile={{
      profileId: 'c1',
      endpointScenarios: { hello_world: ['by-amount', 'default'] },
      createdAt: new Date(),
      modifiedAt: new Date(),
    }}
    scenarioProgress={{ hello_world: 1 }}
    passthroughAsDefault={false}
  />,
)

const globalHtml = renderToStaticMarkup(
  <GlobalMocksForm
    catalog={globalCatalog}
    selections={[globalSelection]}
    passthroughAsDefault={false}
    env={{ HELLO_SYSTEM_URL: 'http://localhost' }}
  />,
)

describe('reset button parity', () => {
  it('renders "Reset resolver history" identically on both surfaces', () => {
    expect(buttonFor(globalHtml, 'Reset resolver history')).toBe(
      buttonFor(profileHtml, 'Reset resolver history'),
    )
  })

  it('styles every reset control the same way', () => {
    const shared = classOf(buttonFor(profileHtml, 'Reset resolver history'))
    expect(shared).not.toBe('')
    expect(classOf(buttonFor(profileHtml, 'Reset progress'))).toBe(shared)
    expect(classOf(buttonFor(globalHtml, 'Reset resolver history'))).toBe(shared)
  })
})
