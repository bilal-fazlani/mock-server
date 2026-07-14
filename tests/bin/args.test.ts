import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { parseArgs, HELP } = require('../../bin/args.js') as {
  parseArgs: (argv: string[]) => {
    catalogPath?: string
    port?: string
    help: boolean
    version: boolean
  }
  HELP: string
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
