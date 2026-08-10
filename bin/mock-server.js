#!/usr/bin/env node
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { parseArgs, HELP, VALIDATE_HELP } = require('./args')

const pkgRoot = path.join(__dirname, '..')
const pkg = require(path.join(pkgRoot, 'package.json'))
const standaloneDir = path.join(pkgRoot, '.next', 'standalone')

// The launcher's cwd differs from the child's (both the server and the
// validator run inside the standalone dir), so always hand the child an
// ABSOLUTE catalog path, resolved against the user's real cwd. Shared by both
// subcommands so their path resolution cannot drift apart.
// Precedence: positional arg > CATALOG_PATH > ./catalog.
function resolveCatalogPath(opts) {
  const raw = opts.catalogPath ?? process.env.CATALOG_PATH ?? 'catalog'
  return path.resolve(process.cwd(), raw)
}

function requireBuildOutput(file) {
  if (fs.existsSync(file)) return
  process.stderr.write(
    `mock-server: build output not found at ${path.relative(pkgRoot, file)}. ` +
      'This usually means the package was not built before publishing.\n',
  )
  process.exit(1)
}

function run(entry, args, env) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: standaloneDir,
    stdio: 'inherit',
    env,
  })

  const forward = (signal) => {
    if (!child.killed) child.kill(signal)
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))

  child.on('exit', (code, signal) => {
    if (signal) process.exit(128 + (os.constants.signals[signal] ?? 0))
    else process.exit(code ?? 0)
  })
}

function validate(opts) {
  if (opts.help) {
    process.stdout.write(VALIDATE_HELP)
    return
  }
  const validateJs = path.join(standaloneDir, 'validate.cjs')
  requireBuildOutput(validateJs)
  run(validateJs, [resolveCatalogPath(opts)], { ...process.env })
}

function serve(opts) {
  if (opts.help) {
    process.stdout.write(HELP)
    return
  }
  if (opts.version) {
    process.stdout.write(`${pkg.version}\n`)
    return
  }

  const env = { ...process.env }
  env.CATALOG_PATH = resolveCatalogPath(opts)
  if (opts.port !== undefined) env.PORT = String(opts.port)

  // serve.cjs, not Next's server.js: it installs the unsupported-upgrade guard
  // (#72) before loading server.js. See src/server/serve-main.ts. Both are
  // checked so a package missing either half still says so plainly, rather than
  // failing as a MODULE_NOT_FOUND out of the entry point.
  const serveCjs = path.join(standaloneDir, 'serve.cjs')
  requireBuildOutput(path.join(standaloneDir, 'server.js'))
  requireBuildOutput(serveCjs)
  run(serveCjs, [], env)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.command === 'validate') validate(opts)
  else serve(opts)
}

main()
