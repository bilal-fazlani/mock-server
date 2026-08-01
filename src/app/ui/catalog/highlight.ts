import { bundledThemes, codeToHtml, type BundledTheme, type ThemeRegistration } from 'shiki'

// Server-side dual-theme highlighting. defaultColor:false emits both palettes
// as --shiki-light/--shiki-dark CSS variables; globals.css swaps them on the
// `.dark` root class set by next-themes (attribute="class" in layout.tsx).
export async function highlight(code: string, lang: 'json' | 'javascript'): Promise<string> {
  const [light, dark] = await Promise.all([catalogTheme('github-light'), catalogTheme('github-dark')])
  return codeToHtml(code, { lang, themes: { light, dark }, defaultColor: false })
}

const themes = new Map<BundledTheme, Promise<ThemeRegistration>>()

function catalogTheme(name: BundledTheme): Promise<ThemeRegistration> {
  let pending = themes.get(name)
  if (!pending) {
    pending = loadCatalogTheme(name)
    themes.set(name, pending)
  }
  return pending
}

// The JSON grammar tags true/false/null as `constant.language.json`, which the
// github themes paint the same blue as property names and numbers - so a
// fixture body renders in two near-identical blues while the JS resolver next
// to it gets the full palette. Repaint those literals with the theme's own
// keyword colour so both blocks read from the same set of roles. The `.json`
// suffix leaves JS alone: its booleans are `constant.language.boolean.*.js`,
// and the added rule is more specific than the theme's own `constant` rule, so
// it wins scope resolution.
async function loadCatalogTheme(name: BundledTheme): Promise<ThemeRegistration> {
  const base = (await bundledThemes[name]()).default
  const tokenColors = base.tokenColors ?? []
  const keyword = tokenColors.find((rule) => rule.scope === 'keyword')?.settings?.foreground
  if (!keyword) return base

  return {
    ...base,
    name: `${base.name}-catalog`,
    tokenColors: [...tokenColors, { scope: 'constant.language.json', settings: { foreground: keyword } }],
  }
}
