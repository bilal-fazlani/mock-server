import { afterEach, describe, expect, it, vi } from 'vitest'
import { systemOrigin } from '../../src/app/ui/system-origin'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('systemOrigin', () => {
  it("keeps the page's host and swaps in the system's port", () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://mock.test:3000', protocol: 'http:', hostname: 'mock.test' },
    })
    expect(systemOrigin(4001)).toBe('http://mock.test:4001')
  })

  it('keeps the brackets of an IPv6 host', () => {
    vi.stubGlobal('window', { location: { origin: 'http://[::1]:3000', protocol: 'http:', hostname: '[::1]' } })
    expect(systemOrigin(4001)).toBe('http://[::1]:4001')
  })

  it("falls back to the page's origin for an entry with no known system", () => {
    vi.stubGlobal('window', { location: { origin: 'http://mock.test:3000', protocol: 'http:', hostname: 'mock.test' } })
    expect(systemOrigin(undefined)).toBe('http://mock.test:3000')
  })
})
