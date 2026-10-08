import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Runs the real entry point as a child process, bundled the way
// scripts/build-standalone-entries.mjs bundles it, beside a stub `server.js`
// that reports the HOSTNAME it was started with. That is the only way to see the
// two things this file is for: the handoff to Next's server, and the process
// exiting before it when the address is bad.

let dir: string
let serveCjs: string

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-serve-main-'))
  serveCjs = path.join(dir, 'serve.cjs')
  await build({
    entryPoints: [path.join(__dirname, '../../src/server/serve-main.ts')],
    outfile: serveCjs,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['./server.js'],
    logLevel: 'silent',
  })
  fs.writeFileSync(path.join(dir, 'server.js'), "console.log('HOSTNAME=' + process.env.HOSTNAME)\n")
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, [serveCjs], {
    cwd: dir,
    // Not process.env: an ambient BIND_ADDRESS or HOSTNAME would leak into the case.
    env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
}

describe('serve.cjs entry point', () => {
  it('hands Next the default address and ignores a platform-set HOSTNAME', () => {
    const result = run({ HOSTNAME: 'some-pod-name' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('HOSTNAME=0.0.0.0')
  })

  it('hands Next the BIND_ADDRESS it was given', () => {
    const result = run({ HOSTNAME: 'some-pod-name', BIND_ADDRESS: '::1' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('HOSTNAME=::1')
  })

  it('exits 1 with a message, before loading the server, for a non-IP BIND_ADDRESS', () => {
    const result = run({ BIND_ADDRESS: 'bogus' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('BIND_ADDRESS must be an IPv4 or IPv6 address')
    expect(result.stderr).toContain('"bogus"')
    expect(result.stdout).toBe('')
  })
})
