import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadFunctions } from '../../src/lib/mock-engine/functions-load'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fns-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const CTX = { request: { method: 'GET', path: '/', pathParams: {}, query: {}, headers: {}, body: {} }, now: new Date(0), seed: 's' }

describe('loadFunctions', () => {
  it('resolves catalog-level functions everywhere', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function hi() { return 'hi' }`)
    mkdirSync(join(dir, 'sys', 'ep'), { recursive: true })
    const loaded = loadFunctions(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.resolveTable('sys', 'ep').get('hi')!.invoke(CTX, [], 100)).toBe('hi')
  })

  it('endpoint shadows catalog (nearest wins)', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function label() { return 'catalog' }`)
    mkdirSync(join(dir, 'sys', 'ep'), { recursive: true })
    writeFileSync(join(dir, 'sys', 'ep', '_functions.ts'), `export function label() { return 'endpoint' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.resolveTable('sys', 'ep').get('label')!.invoke(CTX, [], 100)).toBe('endpoint')
  })

  it('reports a reserved-name clash and skips the function', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function upper() { return 'x' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.problems.join('\n')).toMatch(/"upper" is a reserved name/i)
    expect(loaded.resolveTable('sys', 'ep').has('upper')).toBe(false)
  })

  it('reports a compile error once, without double-labeling the path', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function broken( { return`)
    const loaded = loadFunctions(dir)
    expect(loaded.problems).toHaveLength(1)
    expect(loaded.problems[0]).toMatch(/failed to transpile/)
    expect(loaded.problems[0].match(/<catalog>/g)).toHaveLength(1)
    expect(loaded.resolveTable('sys', 'ep').size).toBe(0)
  })

  it('rejects a default export', () => {
    writeFileSync(join(dir, '_functions.ts'), `export default function () { return 'x' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.problems.join('\n')).toMatch(/default export is not usable/)
    expect(loaded.resolveTable('sys', 'ep').has('default')).toBe(false)
  })

  it('prefers .ts and reports the clash when .ts and .mjs coexist', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function which() { return 'ts' }`)
    writeFileSync(join(dir, '_functions.mjs'), `export function which() { return 'mjs' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.problems.join('\n')).toMatch(/both _functions.ts and _functions.mjs/)
    expect(loaded.resolveTable('sys', 'ep').get('which')!.invoke(CTX, [], 100)).toBe('ts')
  })

  it('compiles a .mjs file when no .ts is present', () => {
    writeFileSync(join(dir, '_functions.mjs'), `export function which() { return 'mjs' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.resolveTable('sys', 'ep').get('which')!.invoke(CTX, [], 100)).toBe('mjs')
  })

  it('returns the same merged table on repeated resolves', () => {
    writeFileSync(join(dir, '_functions.ts'), `export function hi() { return 'hi' }`)
    const loaded = loadFunctions(dir)
    expect(loaded.resolveTable('sys', 'ep')).toBe(loaded.resolveTable('sys', 'ep'))
  })

  it('is empty when no _functions files exist', () => {
    const loaded = loadFunctions(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.resolveTable('sys', 'ep').size).toBe(0)
  })
})
