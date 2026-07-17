import { describe, expect, it } from 'vitest'
import { buildEndpointRequestExample } from '../../src/lib/catalog/request-example'
import type { EndpointDef } from '../../src/lib/catalog/types'

function endpoint(overrides: Partial<EndpointDef> = {}): EndpointDef {
  return {
    name: 'hello_world',
    displayName: 'Hello World',
    method: 'POST',
    path: '/hello/world',
    profileIdSelector: '$.customerId',
    scenarios: { default: { label: 'Success' } },
    resolverScenarios: [],
    ...overrides,
  }
}

describe('buildEndpointRequestExample', () => {
  it('builds a body skeleton from a direct body selector', () => {
    const example = buildEndpointRequestExample(endpoint())
    expect(example).toEqual({
      method: 'POST',
      path: '/hello/world',
      search: '',
      headers: {},
      body: { customerId: '<customerId>' },
    })
  })

  it('merges nested selectors and capture keys into one body', () => {
    const example = buildEndpointRequestExample(
      endpoint({
        profileIdSelector: '$.customer.customerId',
        captureProfileKeys: [{ namespace: 'order-id', keySelector: '$.orderId' }],
      }),
    )
    expect(example.body).toEqual({
      customer: { customerId: '<customerId>' },
      orderId: '<orderId>',
    })
  })

  it('uses the inner selector of a profileKey lookup', () => {
    const example = buildEndpointRequestExample(
      endpoint({ profileIdSelector: 'profileKey:order-id:$.orderId' }),
    )
    expect(example.body).toEqual({ orderId: '<orderId>' })
  })

  it('fills path template params with placeholders', () => {
    const example = buildEndpointRequestExample(
      endpoint({
        method: 'GET',
        path: '/customers/{customerId}/status',
        profileIdSelector: 'path:customerId',
      }),
    )
    expect(example.method).toBe('GET')
    expect(example.path).toBe('/customers/<customerId>/status')
    expect(example.body).toBeNull()
  })

  it('puts query selectors into the search string', () => {
    const example = buildEndpointRequestExample(
      endpoint({ method: 'GET', path: '/lookup', profileIdSelector: 'query:cid' }),
    )
    expect(example.search).toBe('?cid=<cid>')
    expect(example.body).toBeNull()
  })

  it('returns an empty body for endpoints without body selectors', () => {
    const example = buildEndpointRequestExample(
      endpoint({ mockType: 'global', profileIdSelector: undefined, path: '/oauth/token' }),
    )
    expect(example.body).toBeNull()
  })

  it('adds an authorization header for opaque and JWT-claim bearer selectors', () => {
    expect(
      buildEndpointRequestExample(endpoint({ profileIdSelector: 'bearer' })).headers,
    ).toEqual({ authorization: 'Bearer <profileId>' })
    expect(
      buildEndpointRequestExample(endpoint({ profileIdSelector: 'bearer:sub' })).headers,
    ).toEqual({ authorization: 'Bearer <JWT with sub claim>' })
  })
})
