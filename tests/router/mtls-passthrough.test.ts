import fs from 'node:fs'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { TLSSocket } from 'node:tls'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { passthrough } from '../../src/lib/router/passthrough'
import { routeRequest, type RouterDeps, type RouteTrace } from '../../src/lib/router/route-request'

const MTLS = path.join(__dirname, '../testdata/mtls')
const pem = (name: string) => fs.readFileSync(path.join(MTLS, name), 'utf8')
const CA = pem('ca.crt')
const CLIENT_CERT = pem('client.crt')
const CLIENT_KEY = pem('client.key')

// The upstream's server cert is signed by a test CA; trust it here rather than
// through a production option.
vi.mock('undici', async (importOriginal) => {
  const undici = await importOriginal<typeof import('undici')>()
  class TrustingAgent extends undici.Agent {
    constructor(options: import('undici').Agent.Options = {}) {
      super({ ...options, connect: { ...options.connect, ca: CA } })
    }
  }
  return { ...undici, Agent: TrustingAgent }
})

let server: https.Server
let baseUrl: string
let handshakes = 0

beforeAll(async () => {
  server = https.createServer(
    { cert: pem('server.crt'), key: pem('server.key'), ca: CA, requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      const peer = (req.socket as TLSSocket).getPeerCertificate()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ path: req.url, clientCn: peer.subject?.CN ?? null }))
    },
  )
  server.on('secureConnection', () => handshakes++)
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve))
  baseUrl = `https://localhost:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const CATALOG: Catalog = {
  systems: [
    {
      name: 'Secure System',
      slug: 'secure-system',
      baseUrlEnv: 'SECURE_SYSTEM_URL',
      clientCertEnv: 'SECURE_CLIENT_CERT',
      clientKeyEnv: 'SECURE_CLIENT_KEY',
      endpoints: [
        {
          name: 'info',
          displayName: 'Info',
          method: 'GET',
          path: '/info',
          mockType: 'global',
          scenarios: { default: { label: 'Info' } },
          resolverScenarios: [],
        },
      ],
    },
  ],
}

function deps(env: Record<string, string>, trace: RouteTrace): RouterDeps {
  return {
    catalog: CATALOG,
    passthroughAsDefault: true,
    unmockedUsers: 'ERROR',
    timeoutMs: 5000,
    env: { SECURE_SYSTEM_URL: baseUrl, ...env },
    getProfile: async () => null,
    getGlobalMockScenario: async () => null,
    getProfileKeyMapping: async () => null,
    captureProfileKeyMapping: async () => {},
    advanceScenarioProgress: async () => 1,
    getCompiledResolver: () => null,
    getDynamicHistory: async () => [],
    appendDynamicHistory: async () => {},
    passthrough,
    loadFixture: () => {
      throw new Error('fixtures are not used in this test')
    },
    now: () => new Date(),
    trace,
  }
}

async function getInfo(env: Record<string, string>) {
  const trace: RouteTrace = {}
  const res = await routeRequest(
    { method: 'GET', path: '/info', search: '?a=1', headers: {}, rawBody: null },
    deps(env, trace),
  )
  return { status: res.status, body: JSON.parse(Buffer.from(res.bodyBytes).toString('utf8')), trace }
}

describe('passthrough to an upstream that requires a client certificate', () => {
  it('presents the configured client certificate', async () => {
    const { status, body, trace } = await getInfo({
      SECURE_CLIENT_CERT: CLIENT_CERT,
      SECURE_CLIENT_KEY: CLIENT_KEY,
    })
    expect(status).toBe(200)
    expect(body).toEqual({ path: '/info?a=1', clientCn: 'example-client' })
    expect(trace.outcome).toBe('passthrough')
  })

  it('reuses the upstream connection across calls', async () => {
    const env = { SECURE_CLIENT_CERT: CLIENT_CERT, SECURE_CLIENT_KEY: CLIENT_KEY }
    await getInfo(env)
    const before = handshakes
    const second = await getInfo(env)
    expect(second.status).toBe(200)
    expect(handshakes).toBe(before)
  })

  it('rebuilds the connection pool when the client identity changes', async () => {
    await getInfo({ SECURE_CLIENT_CERT: CLIENT_CERT, SECURE_CLIENT_KEY: CLIENT_KEY })
    const before = handshakes
    const other = await getInfo({ SECURE_CLIENT_CERT: pem('server.crt'), SECURE_CLIENT_KEY: pem('server.key') })
    expect(other.body.clientCn).toBe('localhost')
    expect(handshakes).toBe(before + 1)
  })

  it('fails with missing_client_cert naming the env var when the key is unset', async () => {
    const { status, body, trace } = await getInfo({ SECURE_CLIENT_CERT: CLIENT_CERT })
    expect(status).toBe(500)
    expect(body).toEqual({ error: 'environment variable SECURE_CLIENT_KEY is not set', endpoint: 'info' })
    expect(trace.error).toEqual({
      code: 'missing_client_cert',
      message: 'environment variable SECURE_CLIENT_KEY is not set',
    })
  })

  it('fails with invalid_client_cert naming the env var when the certificate is not PEM', async () => {
    const { status, body, trace } = await getInfo({
      SECURE_CLIENT_CERT: 'not a certificate',
      SECURE_CLIENT_KEY: CLIENT_KEY,
    })
    expect(status).toBe(500)
    expect(body.error).toMatch(/^environment variable SECURE_CLIENT_CERT does not hold a PEM certificate/)
    expect(trace.error?.code).toBe('invalid_client_cert')
  })

  it('fails with invalid_client_cert when the key does not match the certificate', async () => {
    const { status, body, trace } = await getInfo({
      SECURE_CLIENT_CERT: CLIENT_CERT,
      SECURE_CLIENT_KEY: pem('server.key'),
    })
    expect(status).toBe(500)
    expect(body.error).toBe(
      'environment variable SECURE_CLIENT_KEY does not hold the private key for the certificate in SECURE_CLIENT_CERT',
    )
    expect(trace.error?.code).toBe('invalid_client_cert')
  })
})
