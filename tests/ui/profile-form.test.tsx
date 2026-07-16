import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { ProfileForm } from '../../src/app/ui/profiles/ProfileForm'
import UiLayout from '../../src/app/ui/layout'

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
          resolverScenarios: [],
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
    const profile = {
      profileId: 'c1',
      endpointScenarios: {},
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} profile={profile} passthroughAsDefault={false} />,
    )
    // form: max-width 1200px, min-width 0 (so it can shrink inside the page shell)
    expect(html).toContain('<form id="profile-form" class="grid w-full min-w-0 max-w-[1200px] gap-5"')
    // identity card: two columns, collapsing to one below 700px
    expect(html).toContain(
      'class="grid grid-cols-2 items-start gap-3.5 rounded-lg border border-border bg-card px-5 py-[18px] shadow-sm max-[700px]:grid-cols-1"',
    )
    // each identity field reserves a label row, a hint row, and a control row
    expect(html).toContain('class="grid min-w-0 grid-rows-[auto_minmax(1rem,auto)_auto] gap-1 max-[700px]:grid-rows-none"')
    // the control for each field sits in row 3 of that grid
    expect(html).toContain('<span class="row-start-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">')
    expect(html).toContain('row-start-3 max-[700px]:row-start-auto" name="displayName"')
  })

  it('styles read-only profile IDs as disabled-looking copyable controls', () => {
    const profile = {
      profileId: 'c1',
      endpointScenarios: {},
      createdAt: new Date(),
      modifiedAt: new Date(),
    }
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} profile={profile} passthroughAsDefault={false} />,
    )
    // the input + copy button sit side by side: input takes remaining space, button is auto-sized
    expect(html).toContain('class="row-start-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2"')
    // the read-only profile ID input looks receded/disabled
    expect(html).toContain('cursor-default border-[color-mix(in_srgb,var(--border)_75%,var(--background))] bg-background text-muted-foreground')
    expect(html).toContain('dark:bg-background" id="profileId" readOnly=""')
    // the copy control is an icon-sized button next to it
    expect(html).toContain('size-9 text-secondary-foreground hover:text-foreground" type="button" aria-label="Copy profile ID"')
  })

  it('allows the save action to live outside the form through a stable form id', () => {
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={false} formId="profile-form" />,
    )
    expect(html).toContain('<form id="profile-form"')
    expect(html).not.toContain('Save profile')
  })

  it('allows the page shell to grow on wide viewports', () => {
    const html = renderToStaticMarkup(<UiLayout>{null}</UiLayout>)
    expect(html).toContain('<div class="mx-auto w-full max-w-[1280px] px-6 pt-7 pb-16">')
  })

  it('allows endpoint cards and paths to shrink on narrow screens', () => {
    const html = renderToStaticMarkup(
      <ProfileForm catalog={catalog} passthroughAsDefault={false} />,
    )
    expect(html).toContain('<section class="grid min-w-0 gap-3">')
    expect(html).toContain('class="grid min-w-0 gap-3.5 rounded-lg border border-border bg-card px-5 py-[18px] shadow-sm"')
    expect(html).toContain('<code class="min-w-0 text-secondary-foreground [overflow-wrap:anywhere]">/hello/world</code>')
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
