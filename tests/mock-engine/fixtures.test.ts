import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FixtureError, fixtureFilePath, loadFixture } from '../../src/lib/mock-engine/fixtures'

const catalogDir = path.join(__dirname, '../../catalog')

describe('fixtureFilePath', () => {
  it('builds <catalogDir>/<system-slug>/<endpoint>/<scenario>.json', () => {
    expect(fixtureFilePath('/x', 'hello-system', 'hello_world', 'default')).toBe(
      path.join('/x', 'hello-system', 'hello_world', 'default.json'),
    )
  })
})

describe('loadFixture', () => {
  it('loads the hello world default fixture with its description', () => {
    const f = loadFixture(catalogDir, 'hello-system', 'hello_world', 'default')
    expect(f.status).toBe(200)
    expect(f.description).toBe('Greeting')
    expect(f.body).toMatchObject({ status: 'success' })
  })

  it('loads a failure fixture with a non-2xx status', () => {
    const f = loadFixture(catalogDir, 'hello-system', 'hello_world', 'failure')
    expect(f.status).toBe(503)
  })

  it('throws FixtureError for a missing fixture', () => {
    expect(() => loadFixture(catalogDir, 'hello-system', 'hello_world', 'nope')).toThrow(
      FixtureError,
    )
  })
})
