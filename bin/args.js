'use strict'

const HELP = `mock-server — run a mock API server from a catalog directory

Usage:
  mock-server [catalogPath] [options]

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

function parseArgs(argv) {
  const opts = { catalogPath: undefined, port: undefined, help: false, version: false }
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

module.exports = { parseArgs, HELP }
