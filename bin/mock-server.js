#!/usr/bin/env node
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { parseArgs, HELP } = require('./args')

const pkgRoot = path.join(__dirname, '..')
const pkg = require(path.join(pkgRoot, 'package.json'))

function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.help) {
    process.stdout.write(HELP)
    return
  }
  if (opts.version) {
    process.stdout.write(`${pkg.version}\n`)
    return
  }

  // The launcher's cwd differs from the server's (we spawn inside the
  // standalone dir), so always hand the server an ABSOLUTE catalog path,
  // resolved against the user's real cwd. Precedence: positional arg > env.
  const userCwd = process.cwd()
  const rawCatalog = opts.catalogPath ?? process.env.CATALOG_PATH ?? 'catalog'

  const env = { ...process.env }
  env.CATALOG_PATH = path.resolve(userCwd, rawCatalog)
  if (opts.port !== undefined) env.PORT = String(opts.port)

  const standaloneDir = path.join(pkgRoot, '.next', 'standalone')
  const serverJs = path.join(standaloneDir, 'server.js')
  if (!fs.existsSync(serverJs)) {
    process.stderr.write(
      'mock-server: build output not found at .next/standalone/server.js. ' +
        'This usually means the package was not built before publishing.\n',
    )
    process.exit(1)
  }

  const child = spawn(process.execPath, [serverJs], {
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

main()
