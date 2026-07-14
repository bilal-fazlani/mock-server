import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCatalogDir } from '../../src/lib/config'

describe('resolveCatalogDir', () => {
  it('defaults to <cwd>/catalog when unset', () => {
    expect(resolveCatalogDir(undefined)).toBe(path.resolve('catalog'))
  })

  it('resolves a relative path against cwd', () => {
    expect(resolveCatalogDir('./fixtures/catalog')).toBe(path.resolve('fixtures/catalog'))
  })

  it('passes an absolute path through unchanged', () => {
    expect(resolveCatalogDir('/srv/catalog')).toBe('/srv/catalog')
  })
})
