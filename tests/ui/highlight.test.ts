import { describe, expect, it } from 'vitest'
import { highlight } from '../../src/app/ui/catalog/highlight'

// Pulls the --shiki-dark colour shiki assigned to the span holding `token`.
// Shiki keeps a token's leading indentation inside its span, so allow it.
async function darkColorOf(code: string, lang: 'json' | 'javascript', token: string): Promise<string> {
  const html = await highlight(code, lang)
  const span = html.match(new RegExp(`<span style="([^"]*)"[^>]*>\\s*${token}\\s*</span>`))
  if (!span) throw new Error(`no span for ${token} in ${lang}: ${html}`)
  const color = span[1].match(/--shiki-dark:(#[0-9A-Fa-f]{6})/)
  if (!color) throw new Error(`no --shiki-dark in ${span[1]}`)
  return color[1].toUpperCase()
}

const json = '{\n  "on": true,\n  "off": false,\n  "none": null,\n  "count": 3,\n  "name": "ada"\n}'

describe('highlight', () => {
  it('paints json true/false/null with the same colour js keywords get', async () => {
    const keyword = await darkColorOf('const a = 1', 'javascript', 'const')
    for (const literal of ['true', 'false', 'null']) {
      expect(await darkColorOf(json, 'json', literal)).toBe(keyword)
    }
  })

  it('leaves the rest of the json palette alone', async () => {
    const key = await darkColorOf(json, 'json', '"count"')
    const number = await darkColorOf(json, 'json', '3')
    const string = await darkColorOf(json, 'json', '"ada"')

    // Numbers stay on the property-name blue; strings keep their own lighter blue.
    expect(number).toBe(key)
    expect(string).not.toBe(key)
    expect(await darkColorOf(json, 'json', 'true')).not.toBe(key)
  })

  it('leaves javascript booleans untouched', async () => {
    const code = 'const a = true'
    expect(await darkColorOf(code, 'javascript', 'true')).not.toBe(await darkColorOf(code, 'javascript', 'const'))
  })
})
