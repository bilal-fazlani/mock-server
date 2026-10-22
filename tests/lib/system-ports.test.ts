import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import {
  adminPortConflicts,
  adminPortNotFoundBody,
  isSystemToken,
  resolveSystemRequest,
  SYSTEM_PATH_SEGMENT,
  systemPathPrefix,
} from '../../src/lib/system-ports'

const CATALOG: Catalog = {
  systems: [
    { displayName: 'Alpha', slug: 'alpha', baseUrlEnv: 'A_URL', port: 4001, endpoints: [] },
    { displayName: 'Beta', slug: 'beta', baseUrlEnv: 'B_URL', port: 4002, endpoints: [] },
  ],
}
const TOKEN = 'a'.repeat(64)

describe('resolveSystemRequest', () => {
  it('names the system and strips the reserved prefix for a request carrying the token', () => {
    const resolved = resolveSystemRequest(CATALOG, [SYSTEM_PATH_SEGMENT, 'beta', 'ui', 'x'], TOKEN, TOKEN)
    expect(resolved?.system.slug).toBe('beta')
    expect(resolved?.segments).toEqual(['ui', 'x'])
  })

  it('maps the bare prefix to the root path', () => {
    expect(resolveSystemRequest(CATALOG, [SYSTEM_PATH_SEGMENT, 'alpha'], TOKEN, TOKEN)?.segments).toEqual([])
  })

  it.each([
    ['no token', undefined],
    ['a wrong token', 'b'.repeat(64)],
    ['a token of another length', 'a'],
  ])('refuses the prefix with %s, as a request sent straight to the admin port', (_, token) => {
    expect(resolveSystemRequest(CATALOG, [SYSTEM_PATH_SEGMENT, 'alpha', 'hello'], token, TOKEN)).toBeNull()
  })

  it('refuses everything when no token was set at boot', () => {
    expect(resolveSystemRequest(CATALOG, [SYSTEM_PATH_SEGMENT, 'alpha'], undefined, undefined)).toBeNull()
    expect(isSystemToken('', '')).toBe(false)
  })

  it('refuses a plain path and an unknown system', () => {
    expect(resolveSystemRequest(CATALOG, ['hello'], TOKEN, TOKEN)).toBeNull()
    expect(resolveSystemRequest(CATALOG, [SYSTEM_PATH_SEGMENT, 'gamma'], TOKEN, TOKEN)).toBeNull()
  })
})

describe('admin port', () => {
  it("lists each system's slug and port in its 404 body", () => {
    expect(adminPortNotFoundBody(CATALOG)).toMatchObject({
      error: 'not a mocked API port',
      systems: [
        { slug: 'alpha', port: 4001 },
        { slug: 'beta', port: 4002 },
      ],
    })
  })

  it('flags a system whose port is the admin port', () => {
    expect(adminPortConflicts(CATALOG, 4002)).toEqual([
      'system "beta": port 4002 is the admin port (PORT); give the system a different port',
    ])
    expect(adminPortConflicts(CATALOG, 3000)).toEqual([])
  })
})

it('encodes the slug into the reserved prefix', () => {
  expect(systemPathPrefix('hello-system')).toBe('/__mock-system__/hello-system')
})
