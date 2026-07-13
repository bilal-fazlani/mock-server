import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ProfilePageHeader } from '../../src/app/ui/profiles/ProfilePageHeader'

const profilePageCss = () =>
  readFileSync(new URL('../../src/app/ui/profiles/profilePage.module.css', import.meta.url), 'utf8')

describe('ProfilePageHeader', () => {
  it('renders profile metadata and a header delete icon button for existing profiles', () => {
    const html = renderToStaticMarkup(
      <ProfilePageHeader title="default" profileId="c1" meta="Created today" formId="profile-form" />,
    )

    expect(html).toContain('<h1>default</h1>')
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

    expect(html).toContain('<h1>New mock profile</h1>')
    expect(html).toContain('Save profile')
    expect(html).not.toContain('aria-label="Delete profile"')
  })

  it('keeps profile actions in a sticky header', () => {
    const css = profilePageCss()
    expect(css).toMatch(/\.stickyHeader\s*{[^}]*position:\s*sticky;/s)
    expect(css).toMatch(/\.stickyHeader\s*{[^}]*top:\s*0;/s)
    expect(css).toMatch(/\.stickyHeader\s*{[^}]*max-width:\s*1200px;/s)
    expect(css).toMatch(/\.headerActions\s*{[^}]*margin-left:\s*auto;/s)
    expect(css).toMatch(/\.stickyHeader::after\s*{[^}]*linear-gradient/s)
  })
})
