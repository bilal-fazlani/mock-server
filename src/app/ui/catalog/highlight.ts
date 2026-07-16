import { codeToHtml } from 'shiki'

// Server-side dual-theme highlighting. defaultColor:false emits both palettes
// as --shiki-light/--shiki-dark CSS variables; globals.css swaps them on the
// `.dark` root class set by next-themes (attribute="class" in layout.tsx).
export async function highlight(code: string, lang: 'json' | 'typescript'): Promise<string> {
  return codeToHtml(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  })
}
