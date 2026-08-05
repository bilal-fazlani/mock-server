import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Every /ui page and API route serves server state read at request time (runtime
// env via getRuntime(), the runtime catalog, or MongoDB), so none may be
// statically prerendered at build time. A page without `force-dynamic` builds
// clean and works in dev (dev never prerenders), but a production build bakes in
// the build machine's env and catalog — /ui/profiles/new shipped that way and
// silently ignored runtime PASSTHROUGH_AS_DEFAULT (#32).
//
// The two file kinds are at different risk, and this file guards both anyway
// (#46). A `page.tsx` prerenders by omission — that is the #32 failure. A
// `route.ts` cannot: on Next 16 route handlers are dynamic by default, so one
// goes static only by explicitly opting in (`dynamic = 'force-static'`, or a
// `revalidate` export). Covering routes here is therefore defense in depth: it
// holds the convention that every /ui route declares its intent, fails in
// seconds instead of after a full build, and does not quietly stop guarding if
// a future Next version changes that default.
//
// scripts/check-ui-prerender.mjs re-checks the same invariant against the actual
// build output (.next/prerender-manifest.json) and is the ground truth for both
// kinds — it reads routes, not files. This source-level twin is the fast one.
const UI_APP_DIR = path.join(__dirname, '..', '..', 'src', 'app', 'ui')

// 'page.tsx' renders a /ui screen; 'route.ts' serves a /ui/api endpoint.
const GUARDED_FILENAMES = ['page.tsx', 'route.ts']

function guardedFilesUnder(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...guardedFilesUnder(full))
    else if (GUARDED_FILENAMES.includes(entry.name)) files.push(full)
  }
  return files
}

describe('ui pages and api routes are always server-rendered per request', () => {
  const files = guardedFilesUnder(UI_APP_DIR)
  const named = (name: string) => files.filter((f) => path.basename(f) === name)

  // Assert both kinds separately: one `expect(files.length)` would still pass if
  // the walk silently stopped finding route.ts, which is the bug being fixed.
  it('finds the ui pages', () => {
    expect(named('page.tsx').length).toBeGreaterThan(0)
  })

  it('finds the ui api routes', () => {
    expect(named('route.ts').length).toBeGreaterThan(0)
  })

  it.each(files.map((f) => [path.relative(UI_APP_DIR, f), f]))(
    '%s declares force-dynamic',
    (_rel, file) => {
      const source = fs.readFileSync(file, 'utf8')
      expect(source).toMatch(/export const dynamic = 'force-dynamic'/)
    },
  )
})
