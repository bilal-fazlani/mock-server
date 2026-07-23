import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Every /ui page renders server state read at request time (runtime env via
// getRuntime(), the runtime catalog, or MongoDB), so none may be statically
// prerendered at build time. A page without `force-dynamic` builds clean and
// works in dev (dev never prerenders), but a production build bakes in the
// build machine's env and catalog — /ui/profiles/new shipped that way and
// silently ignored runtime PASSTHROUGH_AS_DEFAULT (#32). CI runs only the
// tests, so this file is the guard; scripts/check-ui-prerender.mjs re-checks
// the same invariant against the actual build output.
const UI_APP_DIR = path.join(__dirname, '..', '..', 'src', 'app', 'ui')

function pageFilesUnder(dir: string): string[] {
  const pages: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) pages.push(...pageFilesUnder(full))
    else if (entry.name === 'page.tsx') pages.push(full)
  }
  return pages
}

describe('ui pages are always server-rendered per request', () => {
  const pages = pageFilesUnder(UI_APP_DIR)

  it('finds the ui pages', () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  it.each(pages.map((p) => [path.relative(UI_APP_DIR, p), p]))(
    '%s declares force-dynamic',
    (_rel, file) => {
      const source = fs.readFileSync(file, 'utf8')
      expect(source).toMatch(/export const dynamic = 'force-dynamic'/)
    },
  )
})
