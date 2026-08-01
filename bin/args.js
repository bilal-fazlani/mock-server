'use strict'

const HELP = `mock-server — run a mock API server from a catalog directory

Usage:
  mock-server [catalogPath] [options]
  mock-server validate [catalogPath]

Commands:
  validate               Check a catalog and exit, without starting the server.
                         Run "mock-server validate --help" for details.

Arguments:
  catalogPath            Path to the catalog directory (default: ./catalog).
                         Overrides the CATALOG_PATH environment variable.

Options:
  -p, --port <number>    Port to listen on (default: 3000, or $PORT).
  -h, --help             Show this help and exit.
  -v, --version          Print the version and exit.

Environment:
  CATALOG_PATH                 Catalog directory (relative or absolute).
  MONGODB_CONNECTION_STRING    External MongoDB. If unset, an in-memory
                               MongoDB is started automatically (ephemeral).
`

const VALIDATE_HELP = `mock-server validate — check a catalog without starting the server

Usage:
  mock-server validate [catalogPath]

Arguments:
  catalogPath            Path to the catalog directory (default: ./catalog).
                         Overrides the CATALOG_PATH environment variable.

Options:
  -h, --help             Show this help and exit.

Runs the checks that depend only on the files on disk — the structural walk,
semantic validation, and resolver/_functions compilation — then exits 0 on
success or 1 on any error. Neither MongoDB nor the server is started, so this
is safe to run in CI and in a container image build.

Environment config is deliberately NOT checked: upstream base URLs and
PASSTHROUGH_AS_DEFAULT belong to a deployment rather than to a catalog, and are
legitimately unset here. Those are still verified at server startup.

Environment:
  CATALOG_PATH                 Catalog directory (relative or absolute).
`

// Only the FIRST token may name a subcommand, so a catalog path or a flag in
// that position still means "serve" and `mock-server ./catalog` is unchanged.
// The cost of the grammar: a catalog directory literally named `validate` must
// now be served as `mock-server ./validate`.
const SUBCOMMANDS = new Set(['validate'])

function parseArgs(argv) {
  if (SUBCOMMANDS.has(argv[0])) return parseValidateArgs(argv.slice(1))
  return parseServeArgs(argv)
}

function parseServeArgs(argv) {
  const opts = {
    command: 'serve',
    catalogPath: undefined,
    port: undefined,
    help: false,
    version: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (arg === '--version' || arg === '-v') {
      opts.version = true
    } else if (arg === '--port' || arg === '-p') {
      opts.port = argv[++i]
    } else if (arg.startsWith('--port=')) {
      opts.port = arg.slice('--port='.length)
    } else if (!arg.startsWith('-') && opts.catalogPath === undefined) {
      opts.catalogPath = arg
    }
  }
  return opts
}

function parseValidateArgs(argv) {
  const opts = { command: 'validate', catalogPath: undefined, help: false, version: false }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (!arg.startsWith('-') && opts.catalogPath === undefined) {
      opts.catalogPath = arg
    }
  }
  return opts
}

module.exports = { parseArgs, HELP, VALIDATE_HELP }
