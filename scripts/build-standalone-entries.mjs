#!/usr/bin/env node
// Bundles this project's own entry points into .next/standalone:
//
//   serve.cjs     the process the server actually starts (#72) — installs the
//                 unsupported-upgrade guard, then hands off to Next's generated
//                 server.js
//   validate.cjs  the `mock-server validate` subcommand (#40)
//
// They land inside .next/standalone because that directory is already both the
// npm package's payload (`files` in package.json) and what the Dockerfile
// copies into the runtime image — so they ship everywhere the server does, with
// no second distribution path to keep in sync.
//
// Self-contained on purpose: the validator must run with no Next.js runtime and
// no MongoDB, so everything it touches is bundled rather than resolved out of
// whatever node_modules the standalone build happened to trace. Two exceptions
// stay external. esbuild's JS wrapper locates a per-platform native binary at
// runtime and cannot survive bundling; Next keeps it unbundled too (see
// `serverExternalPackages` in next.config.ts), so it is present in the
// standalone tree next to these files. And `./server.js` is Next's own output,
// which does not exist yet when this script runs — serve.cjs requires it at
// runtime, resolved next to itself.

import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.next', 'standalone')

const entries = [
  { source: path.join('src', 'server', 'serve-main.ts'), outfile: 'serve.cjs', external: ['./server.js'] },
  { source: path.join('src', 'cli', 'validate-main.ts'), outfile: 'validate.cjs', external: [] },
]

mkdirSync(outDir, { recursive: true })

for (const entry of entries) {
  const outfile = path.join(outDir, entry.outfile)
  await build({
    entryPoints: [path.join(repoRoot, entry.source)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    // CJS with an explicit .cjs extension, so the file's module system does not
    // depend on the `type` field of whatever package.json Next emits beside it.
    format: 'cjs',
    external: ['esbuild', ...entry.external],
    logLevel: 'warning',
  })

  if (!existsSync(outfile)) {
    console.error(`build-standalone-entries: esbuild reported success but produced no ${entry.outfile}.`)
    process.exit(1)
  }
  console.log(`build-standalone-entries: wrote ${path.relative(repoRoot, outfile)}`)
}
