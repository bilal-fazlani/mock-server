// Post-build guard: no /ui route may be statically prerendered.
//
// Every /ui page renders runtime state (env via getRuntime(), the runtime
// catalog, MongoDB), so a prerendered one silently serves build-time values in
// production — /ui/profiles/new shipped that way and ignored runtime
// PASSTHROUGH_AS_DEFAULT (#32). tests/ui/force-dynamic.test.ts guards the
// source; this script asserts the same invariant on the actual build output
// (.next/prerender-manifest.json), which is the ground truth. Run after
// `npm run build`.
import fs from 'node:fs'
import path from 'node:path'

const manifestPath = path.join(process.cwd(), '.next', 'prerender-manifest.json')
if (!fs.existsSync(manifestPath)) {
  console.error(`check-ui-prerender: ${manifestPath} not found — run \`npm run build\` first`)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const prerendered = Object.keys(manifest.routes ?? {})
const offending = prerendered.filter((route) => route === '/ui' || route.startsWith('/ui/'))

if (offending.length > 0) {
  console.error(
    'check-ui-prerender: these /ui routes were statically prerendered at build time,\n' +
      'so they would serve build-time env/catalog instead of runtime state:\n' +
      offending.map((r) => `  - ${r}`).join('\n') +
      "\nAdd `export const dynamic = 'force-dynamic'` to the offending page.",
  )
  process.exit(1)
}

console.log(`check-ui-prerender: ok — no /ui routes prerendered (${prerendered.length} static routes total)`)
