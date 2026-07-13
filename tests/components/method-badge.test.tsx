import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MethodBadge } from '../../src/app/components/MethodBadge'

function className(html: string): string {
  const match = html.match(/class="([^"]+)"/)
  if (!match) throw new Error('class attribute not found')
  return match[1]
}

describe('MethodBadge', () => {
  it('renders the method text', () => {
    const html = renderToStaticMarkup(<MethodBadge method="POST" />)
    expect(html).toContain('POST')
    expect(html).toContain('<span')
  })

  it('uppercases lowercase methods', () => {
    const html = renderToStaticMarkup(<MethodBadge method="get" />)
    expect(html).toContain('GET')
    expect(html).not.toContain('get<')
  })

  it('uses the same neutral styling for every HTTP method', () => {
    const post = renderToStaticMarkup(<MethodBadge method="POST" />)
    const get = renderToStaticMarkup(<MethodBadge method="GET" />)
    const patch = renderToStaticMarkup(<MethodBadge method="PATCH" />)
    expect(className(post)).toBe(className(get))
    expect(className(patch)).toBe(className(get))
  })
})
