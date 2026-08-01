import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { parseArgs, HELP, VALIDATE_HELP } = require('../../bin/args.js') as {
  parseArgs: (argv: string[]) => {
    command: 'serve' | 'validate'
    catalogPath?: string
    port?: string
    help: boolean
    version: boolean
  }
  HELP: string
  VALIDATE_HELP: string
}

describe('parseArgs', () => {
  it('reads a positional catalog path', () => {
    expect(parseArgs(['./catalog']).catalogPath).toBe('./catalog')
  })

  it('reads --port and -p', () => {
    expect(parseArgs(['--port', '8080']).port).toBe('8080')
    expect(parseArgs(['-p', '8080']).port).toBe('8080')
    expect(parseArgs(['--port=8080']).port).toBe('8080')
  })

  it('reads catalog path alongside a port', () => {
    const opts = parseArgs(['./catalog', '--port', '4000'])
    expect(opts.catalogPath).toBe('./catalog')
    expect(opts.port).toBe('4000')
  })

  it('does not treat a flag as the catalog path', () => {
    expect(parseArgs(['--help']).catalogPath).toBeUndefined()
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['--version']).version).toBe(true)
  })

  it('exposes help text mentioning usage', () => {
    expect(HELP).toContain('mock-server')
    expect(HELP).toContain('CATALOG_PATH')
  })
})

describe('parseArgs — subcommands', () => {
  it('defaults to serve', () => {
    expect(parseArgs([]).command).toBe('serve')
    expect(parseArgs(['./catalog']).command).toBe('serve')
    expect(parseArgs(['--port', '4000']).command).toBe('serve')
  })

  it('reads the validate subcommand, with and without a catalog path', () => {
    expect(parseArgs(['validate']).command).toBe('validate')
    expect(parseArgs(['validate']).catalogPath).toBeUndefined()
    const opts = parseArgs(['validate', './my-catalog'])
    expect(opts.command).toBe('validate')
    expect(opts.catalogPath).toBe('./my-catalog')
  })

  it('gives validate its own --help', () => {
    expect(parseArgs(['validate', '--help']).help).toBe(true)
    expect(parseArgs(['validate', '-h']).help).toBe(true)
    expect(parseArgs(['validate', '--help']).catalogPath).toBeUndefined()
    expect(VALIDATE_HELP).toContain('mock-server validate')
    expect(VALIDATE_HELP).toContain('CATALOG_PATH')
  })

  it('only reads a subcommand from the first token', () => {
    // `mock-server ./catalog validate` serves; the second token is not a verb.
    const opts = parseArgs(['./catalog', 'validate'])
    expect(opts.command).toBe('serve')
    expect(opts.catalogPath).toBe('./catalog')
  })

  it('serves a directory named validate when it is given as a path', () => {
    // The accepted cost of the grammar: `mock-server validate` is the
    // subcommand, so a catalog directory of that name needs a path prefix.
    const opts = parseArgs(['./validate'])
    expect(opts.command).toBe('serve')
    expect(opts.catalogPath).toBe('./validate')
  })

  it('advertises the subcommand in the top-level help', () => {
    expect(HELP).toContain('mock-server validate')
  })
})
