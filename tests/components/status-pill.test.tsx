import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatusPill } from '../../src/app/components/StatusPill'

describe('StatusPill', () => {
  it('renders known statuses with reason phrase and success tone', () => {
    const html = renderToStaticMarkup(<StatusPill value={200} />)
    expect(html).toContain('HTTP 200 OK')
    expect(html).toContain('text-[var(--success)]')
  })
  it('uses the error tone for 5xx', () => {
    const html = renderToStaticMarkup(<StatusPill value={503} />)
    expect(html).toContain('HTTP 503 Service Unavailable')
    expect(html).toContain('text-[#d92d20]')
  })
  it('renders unknown numeric statuses without a reason phrase', () => {
    expect(renderToStaticMarkup(<StatusPill value={299} />)).toContain('>HTTP 299<')
  })
  it('renders nothing for null or undefined', () => {
    expect(renderToStaticMarkup(<StatusPill value={undefined} />)).toBe('')
    expect(renderToStaticMarkup(<StatusPill value={null} />)).toBe('')
  })
})
