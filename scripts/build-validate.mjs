#!/usr/bin/env node
// Bundles the `mock-server validate` entry point (#40) into
// .next/standalone/validate.cjs.
//
// It lands inside .next/standalone because that directory is already both the
// npm package's payload (`files` in package.json) and what the Dockerfile
// copies into the runtime image — so the validator ships everywhere the server
// does, with no second distribution path to keep in sync.
//
// Self-contained on purpose: the validator must run with no Next.js runtime and
// no MongoDB, so everything it touches is bundled rather than resolved out of
// whatever node_modules the standalone build happened to trace. The single
// exception is esbuild, whose JS wrapper locates a per-platform native binary at
// runtime and cannot survive bundling; Next keeps it unbundled too (see
// `serverExternalPackages` in next.config.ts), so it is present in the
// standalone tree next to this file.

import { build } from 'esbuild'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outfile = path.join(repoRoot, '.next', 'standalone', 'validate.cjs')

mkdirSync(path.dirname(outfile), { recursive: true })

await build({
  entryPoints: [path.join(repoRoot, 'src', 'cli', 'validate-main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node22',
  // CJS with an explicit .cjs extension, so the file's module system does not
  // depend on the `type` field of whatever package.json Next emits beside it.
  format: 'cjs',
  external: ['esbuild'],
  logLevel: 'warning',
})

if (!existsSync(outfile)) {
  console.error('build-validate: esbuild reported success but produced no output.')
  process.exit(1)
}
console.log(`build-validate: wrote ${path.relative(repoRoot, outfile)}`)
