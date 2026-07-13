import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import UiLayout from '../../src/app/ui/layout'

describe('UiLayout', () => {
  it('links to the environment page from the app nav', () => {
    const html = renderToStaticMarkup(
      <UiLayout>
        <main />
      </UiLayout>,
    )

    expect(html).toContain('href="/ui/environment"')
    expect(html).toContain('Environment')
  })
})
