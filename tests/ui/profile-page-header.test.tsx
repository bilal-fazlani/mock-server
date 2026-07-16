import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProfilePageHeader } from '../../src/app/ui/profiles/ProfilePageHeader'

describe('ProfilePageHeader', () => {
  it('renders profile metadata and a header delete icon button for existing profiles', () => {
    const html = renderToStaticMarkup(
      <ProfilePageHeader title="default" profileId="c1" meta="Created today" formId="profile-form" />,
    )

    expect(html).toContain('<h1 class="min-w-0 [overflow-wrap:anywhere]">default</h1>')
    expect(html).toContain('Created today')
    expect(html).toContain('form="profile-form"')
    expect(html).toContain('Save profile')
    expect(html).toContain('aria-label="Delete profile"')
    expect(html).toContain('title="Delete profile"')
    expect(html).toContain('type="hidden"')
    expect(html).toContain('name="profileId"')
    expect(html).toContain('value="c1"')
  })

  it('omits the delete icon for new profiles', () => {
    const html = renderToStaticMarkup(
      <ProfilePageHeader title="New mock profile" formId="profile-form" />,
    )

    expect(html).toContain('<h1 class="min-w-0 [overflow-wrap:anywhere]">New mock profile</h1>')
    expect(html).toContain('Save profile')
    expect(html).not.toContain('aria-label="Delete profile"')
  })

  it('keeps profile actions in a sticky header', () => {
    const html = renderToStaticMarkup(
      <ProfilePageHeader title="default" profileId="c1" meta="Created today" formId="profile-form" />,
    )

    // header sticks to the top of its scroll container, spanning the same
    // max width as the form below it
    expect(html).toContain('class="sticky top-0 z-30')
    expect(html).toContain('max-w-[1200px]')
    // actions (save/delete) are pushed to the end of the header
    expect(html).toContain('ml-auto flex items-center gap-2.5')
    // a gradient fade separates the sticky header from scrolled content beneath it
    expect(html).toMatch(/after:bg-gradient-to-b after:from-\[rgba\(0,0,0,0\.36\)\] after:to-transparent/)
  })
})
