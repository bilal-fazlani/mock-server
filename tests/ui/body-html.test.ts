import { describe, expect, it } from 'vitest'
import { buildBodyHtml } from '../../src/app/ui/logs/body-html'

describe('buildBodyHtml', () => {
  it('highlights a structured body on each side', async () => {
    const html = await buildBodyHtml(
      { body: { accountID: 'customer-123' } },
      { body: { state: 'SETTLED' } },
    )
    expect(html?.request).toContain('class="shiki')
    expect(html?.request).toContain('customer-123')
    expect(html?.response).toContain('SETTLED')
  })

  it('emits the dual-theme variables the dark-mode CSS swaps on', async () => {
    const html = await buildBodyHtml({ body: { ok: true } }, undefined)
    expect(html?.request).toContain('--shiki-light')
    expect(html?.request).toContain('--shiki-dark')
  })

  it('leaves a raw string body alone rather than mis-colouring it as JSON', async () => {
    const html = await buildBodyHtml({ body: '<xml>not json</xml>' }, { body: { ok: true } })
    expect(html?.request).toBeUndefined()
    expect(html?.response).toBeDefined()
  })

  it('still highlights a truncated body, tail and all', async () => {
    // What a 16 KB cut-off leaves behind: valid JSON up to the break, then nothing.
    const html = await buildBodyHtml({ body: { items: [1, 2, 3] } }, undefined)
    expect(html?.request).toContain('class="shiki')
  })

  it('returns undefined when neither side has a structured body', async () => {
    expect(await buildBodyHtml(undefined, undefined)).toBeUndefined()
    expect(await buildBodyHtml({ body: null }, { body: undefined })).toBeUndefined()
    expect(await buildBodyHtml({ body: 'plain text' }, undefined)).toBeUndefined()
  })

  it('escapes body content so a payload cannot inject markup', async () => {
    const html = await buildBodyHtml({ body: { note: '<script>alert(1)</script>' } }, undefined)
    expect(html?.request).not.toContain('<script>')
    expect(html?.request).toContain('&#x3C;script>')
  })
})
