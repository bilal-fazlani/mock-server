#!/usr/bin/env node
'use strict'

// `next build` with `output: "standalone"` emits alias symlinks under
// `.next/standalone/.next/node_modules/<pkg>-<hash>` pointing at real
// dependency directories elsewhere in the standalone tree (e.g.
// `../../node_modules/mongodb`). The compiled server's externalRequire
// shim requires these exact hashed names at runtime.
//
// `npm pack`/`npm publish` do not preserve symlinks reliably across all
// npm/tar versions, and even when they do, a symlink pointing outside the
// packed `files` allowlist becomes dangling once extracted elsewhere. This
// script walks `.next/standalone` before packing and replaces every
// symlink with a real, recursive copy of what it resolves to, so the
// tarball is fully self-contained.
//
// Idempotent: once a symlink has been materialized into a real directory,
// re-running the script finds no symlinks left to replace.

import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, cpSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const standaloneDir = path.join(repoRoot, '.next', 'standalone')

function materialize(dir) {
  if (!existsSync(dir)) return

  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name)
    const stat = lstatSync(fullPath)

    if (stat.isSymbolicLink()) {
      const realTarget = realpathSync(fullPath)
      const relForLog = path.relative(repoRoot, fullPath)
      const targetForLog = path.relative(repoRoot, realTarget)

      rmSync(fullPath, { force: true })
      cpSync(realTarget, fullPath, { recursive: true, dereference: true })

      console.log(`materialized symlink: ${relForLog} -> ${targetForLog}`)
      // The freshly copied directory is real; no need to recurse into it
      // looking for further symlinks — cpSync with dereference:true already
      // resolved any nested symlinks under the source tree.
      continue
    }

    if (stat.isDirectory()) {
      materialize(fullPath)
    }
  }
}

if (!existsSync(standaloneDir)) {
  console.error(`prepack-standalone: ${path.relative(repoRoot, standaloneDir)} not found; run "npm run build" first.`)
  process.exit(1)
}

materialize(standaloneDir)
console.log('prepack-standalone: done — no dangling symlinks should remain under .next/standalone.')
