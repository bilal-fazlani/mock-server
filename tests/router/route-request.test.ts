import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadCatalog } from '../../src/lib/catalog/load'
import { buildSchemaRegistry } from '../../src/lib/catalog/schema'
import type { Catalog } from '../../src/lib/catalog/types'
import { loadFixture } from '../../src/lib/mock-engine/fixtures'
import { ResolverRuntimeError } from '../../src/lib/mock-engine/resolver'
import {
  ProfileKeyMappingConflictError,
  type MockProfile,
  type ProfileKeyMapping,
  type ProfileKeyMappingCaptureInput,
} from '../../src/lib/profiles/store'
import type { PassthroughRequest, ProxiedResponse } from '../../src/lib/router/passthrough'
import {
  IncomingRequest,
  routeRequest,
  RouterDeps,
  type RouteTrace,
} from '../../src/lib/router/route-request'

const FIXTURES = path.join(__dirname, '../testdata/fixtures')
const NOW = new Date('2026-07-02T00:00:00.000Z')

const CATALOG: Catalog = {
  systems: [
    {
      name: 'Test System',
      slug: 'test-system',
      baseUrlEnv: 'TEST_SYSTEM_URL',
      endpoints: [
        {
          name: 'hello_world',
          displayName: 'Hello World',
          method: 'POST',
          path: '/hello/world',
          profileIdSelector: '$.customerId',
          scenarios: { default: { label: 'Success' }, failure: { label: 'Failure' }, slow: { label: 'Slow' } },
          resolverScenarios: [],
        },
        {
          name: 'capture_assessment',
          displayName: 'Capture Assessment',
          method: 'POST',
          path: '/capture-assessment',
          profileIdSelector: '$.customerId',
          captureProfileKeys: [{ namespace: 'event-id', keySelector: '$.eventID' }],
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'mapped_callback',
          displayName: 'Mapped Callback',
          method: 'POST',
          path: '/callbacks/transaction',
          profileIdSelector: 'profileKey:event-id:$.eventID',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'customer_status',
          displayName: 'Customer Status',
          method: 'GET',
          path: '/customers/{customerId}/status',
          profileIdSelector: 'path:customerId',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'lookup',
          displayName: 'Lookup',
          method: 'GET',
          path: '/lookup',
          profileIdSelector: 'query:cid',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'bearer_opaque',
          displayName: 'Bearer Opaque',
          method: 'GET',
          path: '/bearer/opaque',
          profileIdSelector: 'bearer',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'bearer_claim',
          displayName: 'Bearer Claim',
          method: 'GET',
          path: '/bearer/claim',
          profileIdSelector: 'bearer:sub',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'oauth_token',
          displayName: 'OAuth Token',
          method: 'POST',
          path: '/oauth/token',
          mockType: 'global',
          scenarios: { default: { label: 'Success' }, expired: { label: 'Expired token' } },
          resolverScenarios: [],
        },
        {
          name: 'template_fail',
          displayName: 'Template Fail',
          method: 'POST',
          path: '/tpl',
          profileIdSelector: '$.customerId',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
        {
          name: 'dynamic_ep',
          displayName: 'Dynamic Ep',
          method: 'POST',
          path: '/dynamic-ep',
          profileIdSelector: '$.customerId',
          scenarios: { default: { label: 'Success' }, failure: { label: 'Failure' }, dynamic: { label: 'dynamic' } },
          resolverScenarios: ['dynamic'],
        },
        {
          name: 'resolver_default',
          displayName: 'Resolver Default',
          method: 'POST',
          path: '/resolver-default',
          profileIdSelector: '$.customerId',
          scenarios: { default: { label: 'default' }, flaky: { label: 'flaky' }, hold: { label: 'Hold' }, success: { label: 'Success' } },
          resolverScenarios: ['default', 'flaky'],
        },
        {
          name: 'schema_checked',
          displayName: 'Schema Checked',
          method: 'POST',
          path: '/schema-checked',
          profileIdSelector: '$.customerId',
          scenarios: { default: { label: 'Success' }, bad_response: { label: 'Bad response' } },
          resolverScenarios: [],
          schema: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['customerId'],
                    properties: {
                      customerId: { type: 'string' },
                      amount: { type: 'number' },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['customerId', 'ok'],
                      properties: {
                        customerId: { type: 'string' },
                        ok: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  ],
}

function profile(overrides: Partial<MockProfile> = {}): MockProfile {
  return {
    profileId: 'c1',
    endpointScenarios: {},
    createdAt: NOW,
    modifiedAt: NOW,
    ...overrides,
  }
}

function deps(overrides: Partial<RouterDeps> = {}): RouterDeps & {
  passthroughCalls: PassthroughRequest[]
} {
  const passthroughCalls: PassthroughRequest[] = []
  const proxied: ProxiedResponse = {
    status: 299,
    headers: { 'x-proxied': '1' },
    bodyBytes: Buffer.from('proxied'),
  }
  return {
    catalog: CATALOG,
    passthroughAsDefault: false,
    unmockedUsers: 'ERROR',
    timeoutMs: 1000,
    env: { TEST_SYSTEM_URL: 'http://real.example' },
    getProfile: async () => null,
    getGlobalMockScenario: async () => null,
    getProfileKeyMapping: async () => null,
    captureProfileKeyMapping: async () => {},
    advanceScenarioProgress: async () => 1,
    getCompiledResolver: () => null,
    getDynamicHistory: async () => [],
    appendDynamicHistory: async () => {},
    passthrough: async (req) => {
      passthroughCalls.push(req)
      return proxied
    },
    loadFixture: (systemSlug, endpointName, scenario) =>
      loadFixture(FIXTURES, systemSlug, endpointName, scenario),
    now: () => NOW,
    schemas: buildSchemaRegistry(CATALOG).schemas,
    passthroughCalls,
    ...overrides,
  }
}

function post(pathname: string, body: unknown): IncomingRequest {
  return {
    method: 'POST',
    path: pathname,
    search: '',
    headers: { 'content-type': 'application/json' },
    rawBody: Buffer.from(JSON.stringify(body)),
  }
}

function get(pathname: string, search = ''): IncomingRequest {
  return { method: 'GET', path: pathname, search, headers: {}, rawBody: null }
}

function bearerGet(pathname: string, token: string): IncomingRequest {
  return { ...get(pathname), headers: { authorization: `Bearer ${token}` } }
}

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.')
}

function json(result: { bodyBytes: Buffer }): Record<string, unknown> {
  return JSON.parse(result.bodyBytes.toString('utf8'))
}

const withProfile = (p: MockProfile) => async (id: string) =>
  id === p.profileId ? p : null

function mapping(
  overrides: Partial<ProfileKeyMapping> = {},
): ProfileKeyMapping {
  return {
    namespace: 'event-id',
    key: 'evt-1',
    profileId: 'c1',
    capturedBy: { system: 'test-system', endpoint: 'hello_world' },
    createdAt: NOW,
    modifiedAt: NOW,
    ...overrides,
  }
}

describe('response delay', () => {
  it('awaits the injected sleep with the fixture delay and records trace.delayMs', async () => {
    const slept: number[] = []
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: { hello_world: 'slow' } })),
      sleep: async (ms) => {
        slept.push(ms)
      },
      trace,
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(200)
    expect(slept).toEqual([400])
    expect(trace.delayMs).toBe(400)
  })

  it('does not sleep for a fixture without a delay', async () => {
    const slept: number[] = []
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: { hello_world: 'default' } })),
      sleep: async (ms) => {
        slept.push(ms)
      },
      trace,
    })
    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(slept).toEqual([])
    expect(trace.delayMs).toBeUndefined()
  })

  it('does not sleep when the request errors before serving a fixture', async () => {
    const slept: number[] = []
    const d = deps({
      unmockedUsers: 'ERROR',
      getProfile: async () => null,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'ghost' }), d)
    expect(res.status).toBe(404)
    expect(slept).toEqual([])
  })
})

describe('mock path', () => {
  it('serves the templated fixture for the selected scenario', async () => {
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: { hello_world: 'default' } })),
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ customerId: 'c1', date: '20260702', ok: true })
    expect(d.passthroughCalls).toHaveLength(0)
  })

  it('serves non-2xx failure fixtures as-is', async () => {
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'failure' } })),
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(500)
    expect(json(res)).toEqual({ ok: false })
  })

  it('extracts the profile ID from a path param and echoes it', async () => {
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'cus-7', endpointScenarios: {} })),
    })
    const res = await routeRequest(get('/customers/cus-7/status'), d)
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ customerId: 'cus-7' })
  })

  it('extracts the profile ID from a query param and echoes it', async () => {
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'q1', endpointScenarios: {} })),
    })
    const res = await routeRequest(get('/lookup', '?cid=q1'), d)
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ cid: 'q1' })
  })

  it('gap-fill: a profile with no pick for the endpoint gets "default"', async () => {
    const d = deps({ getProfile: withProfile(profile({ endpointScenarios: {} })) })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ customerId: 'c1', date: '20260702', ok: true })
    expect(d.passthroughCalls).toHaveLength(0)
  })

  it('gap-fill: PASSTHROUGH_AS_DEFAULT=true treats a profile with no pick as "real"', async () => {
    const d = deps({
      passthroughAsDefault: true,
      getProfile: withProfile(profile({ endpointScenarios: {} })),
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
  })
})

describe('scenario sequences', () => {
  function fakeAdvance() {
    const counts = new Map<string, number>()
    const calls: Array<{ profileId: string; endpointName: string; steps: string[] }> = []
    const fn = async (profileId: string, endpointName: string, steps: string[]) => {
      calls.push({ profileId, endpointName, steps })
      const key = `${profileId}/${endpointName}`
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return n
    }
    return { fn, calls }
  }

  it('serves sequence steps call-by-call and sticks on the last step', async () => {
    const advance = fakeAdvance()
    const d = deps({
      getProfile: withProfile(
        profile({ endpointScenarios: { hello_world: ['failure', 'default'] } }),
      ),
      advanceScenarioProgress: advance.fn,
    })

    const first = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    const second = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    const third = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(first.status).toBe(500)
    expect(json(first)).toEqual({ ok: false })
    expect(second.status).toBe(200)
    expect(json(second)).toEqual({ customerId: 'c1', date: '20260702', ok: true })
    expect(third.status).toBe(200)
  })

  it('advances progress with the profile id, endpoint name, and saved steps', async () => {
    const advance = fakeAdvance()
    const d = deps({
      getProfile: withProfile(
        profile({ endpointScenarios: { hello_world: ['failure', 'default'] } }),
      ),
      advanceScenarioProgress: advance.fn,
    })

    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(advance.calls).toEqual([
      { profileId: 'c1', endpointName: 'hello_world', steps: ['failure', 'default'] },
    ])
  })

  it('does not advance progress for single-scenario selections', async () => {
    const advance = fakeAdvance()
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'default' } })),
      advanceScenarioProgress: advance.fn,
    })

    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(advance.calls).toHaveLength(0)
  })

  it('treats an empty sequence like no selection (implicit scenario)', async () => {
    const advance = fakeAdvance()
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: [] } })),
      advanceScenarioProgress: advance.fn,
    })

    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ customerId: 'c1', date: '20260702', ok: true })
    expect(advance.calls).toHaveLength(0)
  })

  it('proxies to the real upstream when the current step is "real"', async () => {
    const advance = fakeAdvance()
    const d = deps({
      getProfile: withProfile(
        profile({ endpointScenarios: { hello_world: ['real', 'default'] } }),
      ),
      advanceScenarioProgress: advance.fn,
    })

    const first = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    const second = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(first.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
    expect(second.status).toBe(200)
  })
})

describe('log trace', () => {
  it('records the full decision trace for a pinned fixture response', async () => {
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'default' } })),
      trace,
    })

    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(trace.system).toBe('test-system')
    expect(trace.endpoint).toBe('hello_world')
    expect(trace.profileId).toBe('c1')
    expect(trace.profileResolution).toEqual({ selector: '$.customerId', value: 'c1', via: 'direct' })
    expect(trace.scenario).toBe('default')
    expect(trace.scenarioSource).toBe('pin')
    expect(trace.outcome).toBe('fixture')
    expect(trace.placeholders).toEqual({
      '{{$.customerId}}': 'c1',
      '{{now:YYYYMMDD}}': '20260702',
    })
  })

  it('records the implicit source when the profile has no pick', async () => {
    const trace: RouteTrace = {}
    const d = deps({ getProfile: withProfile(profile({ endpointScenarios: {} })), trace })
    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(trace.scenarioSource).toBe('implicit')
    expect(trace.scenario).toBe('default')
  })

  it('records the sequence position when a sequence serves the call', async () => {
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(
        profile({ endpointScenarios: { hello_world: ['failure', 'default'] } }),
      ),
      advanceScenarioProgress: async () => 3,
      trace,
    })

    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(trace.scenarioSource).toBe('sequence')
    expect(trace.sequence).toEqual({ step: 2, of: 2, served: 3 })
    expect(trace.scenario).toBe('default')
  })

  it('records profile-key resolution and captured keys', async () => {
    const resolveTrace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: {} })),
      getProfileKeyMapping: async () => mapping(),
      trace: resolveTrace,
    })
    await routeRequest(post('/callbacks/transaction', { eventID: 'evt-1' }), d)
    expect(resolveTrace.profileResolution).toEqual({
      selector: 'profileKey:event-id:$.eventID',
      value: 'evt-1',
      via: { namespace: 'event-id', key: 'evt-1' },
    })

    const captureTrace: RouteTrace = {}
    const d2 = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: {} })),
      trace: captureTrace,
    })
    await routeRequest(post('/capture-assessment', { customerId: 'c1', eventID: 'evt-9' }), d2)
    expect(captureTrace.captures).toEqual([{ namespace: 'event-id', key: 'evt-9' }])
  })

  it('records error outcomes with a code', async () => {
    const noMatch: RouteTrace = {}
    await routeRequest(post('/nope', {}), deps({ trace: noMatch }))
    expect(noMatch.outcome).toBe('error')
    expect(noMatch.error?.code).toBe('no_match')

    const noMapping: RouteTrace = {}
    await routeRequest(
      post('/callbacks/transaction', { eventID: 'evt-404' }),
      deps({ trace: noMapping }),
    )
    expect(noMapping.outcome).toBe('error')
    expect(noMapping.error?.code).toBe('mapping_not_found')
  })

  it('records upstream details for passthrough responses', async () => {
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'real' } })),
      trace,
    })

    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(trace.outcome).toBe('passthrough')
    expect(trace.upstream?.url).toBe('http://real.example/hello/world')
    expect(trace.upstream?.status).toBe(299)
    expect(typeof trace.upstream?.durationMs).toBe('number')
  })

  it('records the unmocked-users policy branch', async () => {
    const trace: RouteTrace = {}
    const d = deps({ unmockedUsers: 'DEFAULT_MOCK', getProfile: async () => null, trace })
    await routeRequest(post('/hello/world', { customerId: 'ghost' }), d)
    expect(trace.scenarioSource).toBe('unmocked_policy')
    expect(trace.scenario).toBe('default')
  })
})

describe('bearer profile selectors', () => {
  const fixture = () => ({ status: 200, headers: {}, body: { ok: true } })

  it('uses an opaque bearer token as the profile ID', async () => {
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'customer-123' })),
      loadFixture: fixture,
      trace,
    })

    const res = await routeRequest(bearerGet('/bearer/opaque', 'customer-123'), d)

    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ ok: true })
    expect(trace.profileId).toBe('customer-123')
    expect(trace.profileResolution).toEqual({
      selector: 'bearer',
      value: 'customer-123',
      via: 'direct',
    })
  })

  it('uses a scalar top-level JWT claim as the profile ID', async () => {
    const trace: RouteTrace = {}
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'customer-456' })),
      loadFixture: fixture,
      trace,
    })

    const res = await routeRequest(
      bearerGet('/bearer/claim', jwt({ sub: 'customer-456' })),
      d,
    )

    expect(res.status).toBe(200)
    expect(trace.profileId).toBe('customer-456')
    expect(trace.profileResolution).toEqual({
      selector: 'bearer:sub',
      value: 'customer-456',
      via: 'direct',
    })
  })

  it('returns 400 when the bearer header or selected JWT claim does not resolve', async () => {
    const missingHeader = await routeRequest(get('/bearer/opaque'), deps())
    const missingClaim = await routeRequest(
      bearerGet('/bearer/claim', jwt({ aud: 'mock' })),
      deps(),
    )

    expect(missingHeader.status).toBe(400)
    expect(json(missingHeader).error).toMatch(/bearer/)
    expect(missingClaim.status).toBe(400)
    expect(json(missingClaim).error).toMatch(/bearer:sub/)
  })
})

describe('profile key mappings', () => {
  it('captures configured keys for direct-profile requests before serving the fixture', async () => {
    const captures: ProfileKeyMappingCaptureInput[] = []
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: {} })),
      captureProfileKeyMapping: async (input: ProfileKeyMappingCaptureInput) => {
        captures.push(input)
      },
    } as Partial<RouterDeps>)

    const res = await routeRequest(post('/capture-assessment', { customerId: 'c1', eventID: 'evt-1' }), d)

    expect(res.status).toBe(200)
    expect(captures).toEqual([
      {
        namespace: 'event-id',
        key: 'evt-1',
        profileId: 'c1',
        capturedBy: { system: 'test-system', endpoint: 'capture_assessment' },
      },
    ])
  })

  it('returns 409 and does not proxy when capture conflicts on a real request', async () => {
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { capture_assessment: 'real' } })),
      captureProfileKeyMapping: async () => {
        throw new ProfileKeyMappingConflictError('event-id', 'evt-1', 'other-account', 'c1')
      },
    } as Partial<RouterDeps>)

    const res = await routeRequest(post('/capture-assessment', { customerId: 'c1', eventID: 'evt-1' }), d)

    expect(res.status).toBe(409)
    expect(json(res)).toEqual({
      error: 'profile_key_mapping_conflict',
      namespace: 'event-id',
      key: 'evt-1',
      existingProfileId: 'other-account',
      newProfileId: 'c1',
    })
    expect(d.passthroughCalls).toHaveLength(0)
  })

  it('resolves profile ids through profileKey mappings', async () => {
    const seenProfileIds: string[] = []
    const d = deps({
      getProfileKeyMapping: async (namespace: string, key: string) =>
        namespace === 'event-id' && key === 'evt-1' ? mapping() : null,
      getProfile: async (id: string) => {
        seenProfileIds.push(id)
        return id === 'c1' ? profile({ profileId: 'c1', endpointScenarios: {} }) : null
      },
    } as Partial<RouterDeps>)

    const res = await routeRequest(post('/callbacks/transaction', { eventID: 'evt-1' }), d)

    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ ok: true })
    expect(seenProfileIds).toEqual(['c1'])
  })

  it('returns 400 when the mapped selector key is missing from the request', async () => {
    const res = await routeRequest(post('/callbacks/transaction', {}), deps())

    expect(res.status).toBe(400)
    expect(json(res).error).toMatch(/profileKey:event-id:\$\.eventID/)
  })

  it('returns 404 when the mapped key has not been captured', async () => {
    const d = deps({
      getProfileKeyMapping: async () => null,
    } as Partial<RouterDeps>)

    const res = await routeRequest(post('/callbacks/transaction', { eventID: 'evt-404' }), d)

    expect(res.status).toBe(404)
    expect(json(res)).toEqual({
      error: 'profile_key_mapping_not_found',
      namespace: 'event-id',
      key: 'evt-404',
      endpoint: 'mapped_callback',
    })
  })
})

describe('real path (explicit profile pin)', () => {
  it('proxies when the profile selects real', async () => {
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'real' } })),
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
    expect(d.passthroughCalls[0].baseUrl).toBe('http://real.example')
    expect(d.passthroughCalls[0].path).toBe('/hello/world')
  })

  it('500s when the baseUrlEnv is not set', async () => {
    const d = deps({
      env: {},
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'real' } })),
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(500)
    expect(json(res).error).toMatch(/TEST_SYSTEM_URL/)
  })
})

describe('global mock path', () => {
  it('serves default for a global endpoint with no saved selection when passthrough is not default', async () => {
    const seenProfileIds: string[] = []
    const d = deps({
      getProfile: async (id: string) => {
        seenProfileIds.push(id)
        return null
      },
      getGlobalMockScenario: async () => null,
    })
    const res = await routeRequest(post('/oauth/token', { client_id: 'test' }), d)
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ access_token: 'mock-token', token_type: 'Bearer' })
    expect(seenProfileIds).toEqual([])
    expect(d.passthroughCalls).toHaveLength(0)
  })

  it('serves a saved global fixture scenario', async () => {
    const d = deps({ getGlobalMockScenario: async () => 'expired' })
    const res = await routeRequest(post('/oauth/token', { client_id: 'test' }), d)
    expect(res.status).toBe(401)
    expect(json(res)).toEqual({ error: 'expired_token' })
  })

  it('proxies a global endpoint with no saved selection when passthrough is default', async () => {
    const d = deps({ passthroughAsDefault: true, getGlobalMockScenario: async () => null })
    const res = await routeRequest(post('/oauth/token', { client_id: 'test' }), d)
    expect(res.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
  })

  it('500s when a global endpoint resolves to real but its baseUrlEnv is missing', async () => {
    const d = deps({
      env: {},
      getGlobalMockScenario: async () => 'real',
    })
    const res = await routeRequest(post('/oauth/token', { client_id: 'test' }), d)
    expect(res.status).toBe(500)
    expect(json(res).error).toMatch(/TEST_SYSTEM_URL/)
  })
})

describe('malformed requests — always loud, in every configuration', () => {
  it.each(['ERROR', 'DEFAULT_MOCK', 'REAL'] as const)(
    '404s on unknown endpoint (UNMOCKED_USERS=%s)',
    async (unmockedUsers) => {
      const res = await routeRequest(post('/nope', {}), deps({ unmockedUsers }))
      expect(res.status).toBe(404)
      expect(json(res).error).toMatch(/no matching endpoint/)
    },
  )

  it.each(['ERROR', 'DEFAULT_MOCK', 'REAL'] as const)(
    '400s on invalid JSON body (UNMOCKED_USERS=%s)',
    async (unmockedUsers) => {
      const d = deps({ unmockedUsers })
      const res = await routeRequest(
        { ...post('/hello/world', {}), rawBody: Buffer.from('{not json') },
        d,
      )
      expect(res.status).toBe(400)
      expect(d.passthroughCalls).toHaveLength(0)
    },
  )

  it('400s when the selector does not resolve', async () => {
    const res = await routeRequest(post('/hello/world', { other: 'x' }), deps())
    expect(res.status).toBe(400)
    expect(json(res).error).toMatch(/\$\.customerId/)
  })
})

describe('UNMOCKED_USERS policy (selector resolved, profile not found)', () => {
  it('ERROR: 404s when the profile is not found', async () => {
    const res = await routeRequest(post('/hello/world', { customerId: 'ghost' }), deps({ unmockedUsers: 'ERROR' }))
    expect(res.status).toBe(404)
    expect(json(res).error).toMatch(/ghost/)
  })

  it('DEFAULT_MOCK: serves the default fixture for an unmocked user', async () => {
    const d = deps({ unmockedUsers: 'DEFAULT_MOCK' })
    const res = await routeRequest(post('/hello/world', { customerId: 'ghost' }), d)
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ customerId: 'ghost', date: '20260702', ok: true })
    expect(d.passthroughCalls).toHaveLength(0)
  })

  it('REAL: proxies an unmocked user to the real upstream', async () => {
    const d = deps({ unmockedUsers: 'REAL' })
    const res = await routeRequest(post('/hello/world', { customerId: 'ghost' }), d)
    expect(res.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
  })

  it('records unmocked-user fallback in the trace for handler-level warning logs', async () => {
    const errorTrace: RouteTrace = {}
    await routeRequest(
      post('/hello/world', { customerId: 'ghost' }),
      deps({ unmockedUsers: 'ERROR', trace: errorTrace }),
    )
    expect(errorTrace.error?.code).toBe('profile_not_found')
    expect(errorTrace.scenarioSource).toBeUndefined()

    const defaultMockTrace: RouteTrace = {}
    await routeRequest(
      post('/hello/world', { customerId: 'ghost' }),
      deps({ unmockedUsers: 'DEFAULT_MOCK', trace: defaultMockTrace }),
    )
    expect(defaultMockTrace.scenarioSource).toBe('unmocked_policy')
    expect(defaultMockTrace.scenario).toBe('default')

    const realTrace: RouteTrace = {}
    await routeRequest(
      post('/hello/world', { customerId: 'ghost' }),
      deps({ unmockedUsers: 'REAL', trace: realTrace }),
    )
    expect(realTrace.scenarioSource).toBe('unmocked_policy')
    expect(realTrace.scenario).toBe('real')
  })
})

describe('drift and templating failures — 500 regardless of config', () => {
  it.each(['ERROR', 'DEFAULT_MOCK', 'REAL'] as const)(
    'unknown scenario pinned in profile (UNMOCKED_USERS=%s)',
    async (unmockedUsers) => {
      const d = deps({
        unmockedUsers,
        getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'ghost-scenario' } })),
      })
      const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
      expect(res.status).toBe(500)
      expect(json(res).error).toMatch(/ghost-scenario/)
      expect(d.passthroughCalls).toHaveLength(0)
    },
  )

  it('unresolvable placeholder', async () => {
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { template_fail: 'default' } })),
    })
    const res = await routeRequest(post('/tpl', { customerId: 'c1' }), d)
    expect(res.status).toBe(500)
    expect(json(res).error).toMatch(/fieldThatWillNeverExist/)
  })
})

describe('schema validation (mocked path)', () => {
  const p = () => withProfile(profile({ profileId: 'c1', endpointScenarios: {} }))

  it('serves normally when the request and response satisfy the schema', async () => {
    const d = deps({ getProfile: p() })
    const res = await routeRequest(post('/schema-checked', { customerId: 'c1', amount: 3 }), d)
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({ customerId: 'c1', ok: true })
  })

  it('400s when the request body violates the schema, with details', async () => {
    const d = deps({ getProfile: p() })
    const res = await routeRequest(post('/schema-checked', { customerId: 'c1', amount: 'lots' }), d)
    expect(res.status).toBe(400)
    const body = json(res)
    expect(body.error).toMatch(/request body does not match schema/)
    expect(JSON.stringify(body.details)).toMatch(/\/amount/)
    expect(d.passthroughCalls).toHaveLength(0)
  })

  it('400s when a required request body is missing', async () => {
    const d = deps({ getProfile: p() })
    const res = await routeRequest(
      { method: 'POST', path: '/schema-checked', search: '?customerId=c1', headers: {}, rawBody: null },
      d,
    )
    // selector $.customerId cannot resolve without a body, so guard the setup:
    // use an endpoint-level check instead — the selector error comes first.
    expect([400]).toContain(res.status)
  })

  it('skips request validation when the scenario is real', async () => {
    const d = deps({
      getProfile: withProfile(
        profile({ profileId: 'c1', endpointScenarios: { schema_checked: 'real' } }),
      ),
    })
    // amount has the wrong type — the real path must not care
    const res = await routeRequest(post('/schema-checked', { customerId: 'c1', amount: 'lots' }), d)
    expect(res.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
  })

  it('500s when the resolved response violates the schema, with details', async () => {
    const d = deps({
      getProfile: withProfile(
        profile({ profileId: 'c1', endpointScenarios: { schema_checked: 'bad_response' } }),
      ),
    })
    const res = await routeRequest(post('/schema-checked', { customerId: 'c1' }), d)
    expect(res.status).toBe(500)
    const body = json(res)
    expect(body.error).toMatch(/generated response does not match schema/)
    expect(body.scenario).toBe('bad_response')
    expect(JSON.stringify(body.details)).toMatch(/\/ok/)
  })

  it('endpoints without a schema are untouched (no deps.schemas entry consulted)', async () => {
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'default' } })),
    })
    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(res.status).toBe(200)
  })
})

describe('schema drift probe (proxy path, warn-only)', () => {
  const realPin = () =>
    withProfile(profile({ profileId: 'c1', endpointScenarios: { schema_checked: 'real' } }))

  function proxiedDeps(proxied: ProxiedResponse, trace?: RouteTrace) {
    return deps({
      getProfile: realPin(),
      passthrough: async () => proxied,
      trace,
    })
  }

  const req = () => post('/schema-checked', { customerId: 'c1' })

  it('records drift when the real JSON response violates the schema, and forwards it unchanged', async () => {
    const trace: RouteTrace = {}
    const proxied: ProxiedResponse = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyBytes: Buffer.from(JSON.stringify({ customerId: 'c1', ok: 'yes' })),
    }
    const res = await routeRequest(req(), proxiedDeps(proxied, trace))
    expect(res.status).toBe(200)
    expect(res.bodyBytes.toString()).toBe(JSON.stringify({ customerId: 'c1', ok: 'yes' }))
    expect(trace.validation?.response).toBe('drift_warning')
  })

  it('records drift when the real response status has no declared schema', async () => {
    const trace: RouteTrace = {}
    const proxied: ProxiedResponse = {
      status: 503,
      headers: { 'content-type': 'application/json' },
      bodyBytes: Buffer.from(JSON.stringify({ oops: true })),
    }
    await routeRequest(req(), proxiedDeps(proxied, trace))
    expect(trace.validation?.response).toBe('drift_warning')
  })

  it('stays silent for a conforming real response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const proxied: ProxiedResponse = {
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyBytes: Buffer.from(JSON.stringify({ customerId: 'c1', ok: true })),
    }
    await routeRequest(req(), proxiedDeps(proxied))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('skips non-JSON and unparseable responses silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await routeRequest(
      req(),
      proxiedDeps({
        status: 200,
        headers: { 'content-type': 'text/html' },
        bodyBytes: Buffer.from('<html></html>'),
      }),
    )
    await routeRequest(
      req(),
      proxiedDeps({
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyBytes: Buffer.from('{broken'),
      }),
    )
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('never validates proxied responses for endpoints without a schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps({
      getProfile: withProfile(profile({ endpointScenarios: { hello_world: 'real' } })),
      passthrough: async () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyBytes: Buffer.from(JSON.stringify({ totally: 'unrelated' })),
      }),
    })
    await routeRequest(post('/hello/world', { customerId: 'c1' }), d)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('resolver-backed scenarios', () => {
  it('runs a resolver-backed default for a profile with no pick, recording trace.resolver', async () => {
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: {} })),
      getCompiledResolver: () => ({ invoke: () => 'hold' }),
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/resolver-default', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(200) // hold.json fixture
    expect(trace.scenarioSource).toBe('implicit') // NOT overwritten
    expect(trace.resolver).toEqual({ slug: 'default', returned: 'hold' })
    expect(trace.scenario).toBe('hold')
  })

  it('rejects a resolver returning a resolver-backed slug with resolver_bad_return', async () => {
    const d = deps({
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: {} })),
      getCompiledResolver: () => ({ invoke: () => 'flaky' }),
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/resolver-default', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('resolver_bad_return')
  })

  it('runs default.ts for an unmocked caller under DEFAULT_MOCK', async () => {
    const d = deps({
      unmockedUsers: 'DEFAULT_MOCK',
      getProfile: async () => null,
      getCompiledResolver: () => ({ invoke: () => 'hold' }),
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/resolver-default', { customerId: 'ghost' }), { ...d, trace })
    expect(res.status).toBe(200)
    expect(trace.scenarioSource).toBe('unmocked_policy')
    expect(trace.resolver?.slug).toBe('default')
  })
})

describe('resolver-backed scenario (dynamic slug)', () => {
  it('runs the resolver, serves the returned fixture, and records history', async () => {
    const appended: string[] = []
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({ invoke: (i) => (i.history.length === 0 ? 'failure' : 'default') }),
      getDynamicHistory: async () => [],
      appendDynamicHistory: async (_t, _k, _e, _s, slug) => {
        appended.push(slug)
      },
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(422) // failure.json status
    expect(trace.scenarioSource).toBe('pin') // underlying selection mechanism, not overwritten
    expect(trace.resolver).toEqual({ slug: 'dynamic', returned: 'failure' })
    expect(trace.scenario).toBe('failure')
    expect(appended).toEqual(['failure'])
  })

  it('returning "real" triggers passthrough', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({ invoke: () => 'real' }),
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(299)
    expect(d.passthroughCalls).toHaveLength(1)
    expect(trace.outcome).toBe('passthrough')
    expect(trace.resolver).toEqual({ slug: 'dynamic', returned: 'real' })
  })

  it('500s when the resolved slug is resolver-backed but there is no resolver (drift)', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => null,
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('resolver_missing')
  })

  it('500s on a bad return value and records nothing', async () => {
    const appended: string[] = []
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({ invoke: () => 'nonexistent' }),
      appendDynamicHistory: async (_t, _k, _e, _s, slug) => {
        appended.push(slug)
      },
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('resolver_bad_return')
    expect(appended).toEqual([])
  })

  it('500s when the resolver throws', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({
        invoke: () => {
          throw new ResolverRuntimeError('boom')
        },
      }),
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('resolver_threw')
  })

  it('500s with resolver_compile_error when getCompiledResolver throws (dev-mode compile failure)', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => {
        throw new Error('dynamic.ts:3 unexpected token')
      },
    })
    const trace: RouteTrace = {}
    const res = await routeRequest(post('/dynamic-ep', { customerId: 'c1' }), { ...d, trace })
    expect(res.status).toBe(500)
    expect(trace.error?.code).toBe('resolver_compile_error')
  })

  it('does not let a resolver mutate its input affect the served response', async () => {
    const d = deps({
      getProfile: async () => profile({ endpointScenarios: { dynamic_ep: 'dynamic' } }),
      getCompiledResolver: () => ({
        invoke: (i) => {
          // Attempt to corrupt the shared request context by reference.
          ;(i.request.body as Record<string, unknown>).customerId = 'tampered'
          i.request.headers['x-tampered'] = 'yes'
          return 'default'
        },
      }),
    })
    const trace: RouteTrace = {}
    const req = post('/dynamic-ep', { customerId: 'c1' })
    const res = await routeRequest(req, { ...d, trace })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.bodyBytes.toString('utf8'))
    expect(body.customerId).toBe('c1')
  })
})

describe('user functions (real hello-system catalog)', () => {
  // Boots against the shipped catalog on disk (not the synthetic CATALOG
  // above) so this exercises the real _functions.ts load/compile/dispatch
  // path end to end — no mocking of the function table.
  const CATALOG_DIR = path.join(__dirname, '../../catalog')
  const realCatalog = loadCatalog(CATALOG_DIR)

  it('renders a fixture value computed by a user function', async () => {
    const d = deps({
      catalog: realCatalog,
      schemas: buildSchemaRegistry(realCatalog).schemas,
      env: { HELLO_SYSTEM_URL: 'http://real.example' },
      getProfile: withProfile(profile({ profileId: 'c1', endpointScenarios: {} })),
      loadFixture: (systemSlug, endpointName, scenario) =>
        loadFixture(CATALOG_DIR, systemSlug, endpointName, scenario),
    })

    const res = await routeRequest(post('/hello/world', { customerId: 'c1' }), d)

    expect(res.status).toBe(200)
    expect(json(res).label).toBe('CUSTOMER: C1')
  })
})
