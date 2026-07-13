import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { ProfileForm } from '../../src/app/ui/profiles/ProfileForm'

const profileFormCss = () =>
  readFileSync(new URL('../../src/app/ui/profiles/ProfileForm.module.css', import.meta.url), 'utf8')
const globalCss = () => readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')

const catalog: Catalog = {
  systems: [
    {
      name: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [
        {
          name: 'hello_world',
          displayName: 'Hello World',
          method: 'POST',
          path: '/hello/world',
          profileIdSelector: '$.customerId',
          scenarios: { default: 'Hello success', failure: 'Hello failure' },
        },
      ],
    },
  ],
}

function checkedValue(html: string): string | null {
  const match = html.match(/checked="" value="([^"]+)"/)
  return match ? match[1] : null
}

function profileIdInput(html: string): string {
  const match = html.match(/<input[^>]*name="profileId"[^>]*>/)
  if (!match) throw new Error('profileId input not found')
  return match[0]
}

describe('ProfileForm', () => {
  it('styles profile cards to use more page width and two identity columns', () => {
    const css = profileFormCss()
    expect(css).toMatch(/\.form\s*{[^}]*max-width:\s*1200px;/s)
    expect(css).toMatch(/\.form\s*{[^}]*min-width:\s*0;/s)
    expect(css).toMatch(
      /\.identityCard\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    )
    expect(css).toMatch(
      /\.identityCard \.field\s*{[^}]*grid-template-rows:\s*auto minmax\(1rem,\s*auto\) auto;/s,
    )
    expect(css).toMatch(/\.identityCard \.field > input\s*{[^}]*grid-row:\s*3;/s)
  })

  it('styles read-only profile IDs as disabled-looking copyable controls', () => {
    const css = profileFormCss()
    expect(css).toMatch(/\.profileIdControl\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s)
    expect(css).toMatch(/\.readOnlyInput\s*{[^}]*cursor:\s*default;/s)
    expect(css).toMatch(/\.copyButton\s*{[^}]*display:\s*inline-flex;/s)
    expect(css).toMatch(/\.copyButton\s*{[^}]*height:\s*39px;/s)
  })

  it('allows the save action to live outside the form through a stable form id', () => {
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={false} formId="profile-form" />,
    )
    expect(html).toContain('<form id="profile-form"')
    expect(html).not.toContain('Save profile')
  })

  it('allows the page shell to grow on wide viewports', () => {
    expect(globalCss()).toMatch(/\.appMain\s*{[^}]*max-width:\s*1280px;/s)
  })

  it('allows endpoint cards and paths to shrink on narrow screens', () => {
    const css = profileFormCss()
    expect(css).toMatch(/\.card\s*{[^}]*min-width:\s*0;/s)
    expect(css).toMatch(/\.system\s*{[^}]*min-width:\s*0;/s)
    expect(css).toMatch(/\.path\s*{[^}]*overflow-wrap:\s*anywhere;/s)
  })

  it('allows a new profile to be submitted without a profile ID', () => {
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={false} />,
    )
    expect(profileIdInput(html)).not.toContain('required')
  })

  it('shows a profile ID copy button only for an existing profile', () => {
    const profile = {
      profileId: 'c1',
      endpointScenarios: {},
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    const existingHtml = renderToStaticMarkup(
      <ProfileForm catalog={catalog} profile={profile} passthroughAsDefault={false} />,
    )
    const newHtml = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={false} />,
    )

    expect(existingHtml).toContain('aria-label="Copy profile ID"')
    expect(existingHtml).toContain('type="button"')
    expect(newHtml).not.toContain('aria-label="Copy profile ID"')
  })

  it('PASSTHROUGH_AS_DEFAULT=false: real is offered last and new profile preselects default', () => {
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={false} />,
    )
    const defaultIdx = html.indexOf('value="default"')
    const realIdx = html.indexOf('value="real"')
    expect(realIdx).toBeGreaterThan(defaultIdx)
    expect(checkedValue(html)).toBe('default')
  })

  it('PASSTHROUGH_AS_DEFAULT=true: real is offered first and preselected on a brand-new profile', () => {
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={true} />,
    )
    const defaultIdx = html.indexOf('value="default"')
    const realIdx = html.indexOf('value="real"')
    expect(realIdx).toBeLessThan(defaultIdx)
    expect(checkedValue(html)).toBe('real')
  })

  it('PASSTHROUGH_AS_DEFAULT=true: an existing profile gap shows real selected', () => {
    const profile = {
      profileId: 'c1',
      endpointScenarios: {},
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} profile={profile} passthroughAsDefault={true} />,
    )
    expect(checkedValue(html)).toBe('real')
  })

  it('lists "default" first among declared scenarios even when the catalog declares it last', () => {
    const reordered: Catalog = {
      systems: [
        {
          ...catalog.systems[0],
          endpoints: [
            {
              ...catalog.systems[0].endpoints[0],
              scenarios: { failure: 'Hello failure', default: 'Hello success' },
            },
          ],
        },
      ],
    }
    const html = renderToStaticMarkup(
      <ProfileForm catalog={reordered} passthroughAsDefault={false} />,
    )
    expect(html.indexOf('value="default"')).toBeLessThan(html.indexOf('value="failure"'))
  })

  it("an existing profile's explicit pin wins over any mode default", () => {
    const profile = {
      profileId: 'c1',
      endpointScenarios: { hello_world: 'failure' },
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} profile={profile} passthroughAsDefault={true} />,
    )
    expect(checkedValue(html)).toBe('failure')
  })

  it('links each endpoint card to its catalog page', () => {
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={false} />,
    )
    expect(html).toContain('href="/ui/catalog/hello-system/hello_world"')
    expect(html).toContain('View in catalog')
  })

  it('does not render the profile delete action inside the form', () => {
    const profile = {
      profileId: 'c1',
      endpointScenarios: {},
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} profile={profile} passthroughAsDefault={false} />,
    )
    expect(html).not.toContain('Delete profile')
  })
})
