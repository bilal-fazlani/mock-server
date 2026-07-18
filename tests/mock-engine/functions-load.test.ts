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
    expect(loaded.problems.join('\n')).toMatch(/reserved.*upper/i)
    expect(loaded.resolveTable('sys', 'ep').has('upper')).toBe(false)
  })

  it('is empty when no _functions files exist', () => {
    const loaded = loadFunctions(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.resolveTable('sys', 'ep').size).toBe(0)
  })
})
