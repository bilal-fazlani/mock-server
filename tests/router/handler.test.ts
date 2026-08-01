import { describe, expect, it, vi } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import type { LogEntry } from '../../src/lib/logs/store'
import type { MockProfile } from '../../src/lib/profiles/store'
import { createMockHandler, type MockHandlerDeps } from '../../src/lib/router/handler'

const NOW = new Date('2026-07-02T00:00:00.000Z')

const CATALOG: Catalog = {
  systems: [
    {
      name: 'Test System',
      slug: 'test-system',
      baseUrlEnv: 'TEST_SYSTEM_URL',
      endpoints: [
        {
          name: 'hello',
          displayName: 'Hello',
          method: 'POST',
          path: '/hello',
          profileIdSelector: '$.customerId',
          scenarios: { default: { label: 'Success' } },
          resolverScenarios: [],
        },
      ],
    },
  ],
}

const profile: MockProfile = {
  profileId: 'c1',
  endpointScenarios: {},
  createdAt: NOW,
  modifiedAt: NOW,
}

function handlerWith(
  overrides: Partial<MockHandlerDeps> = {},
  fixtureBody: unknown = { ok: true },
) {
  const written: LogEntry[] = []
  const deps: MockHandlerDeps = {
    catalog: CATALOG,
    passthroughAsDefault: false,
    unmockedUsers: 'ERROR',
    timeoutMs: 1000,
    env: {},
    getProfile: async (id) => (id === 'c1' ? profile : null),
    getGlobalMockScenario: async () => null,
    getProfileKeyMapping: async () => null,
    captureProfileKeyMapping: async () => {},
    advanceScenarioProgress: async () => 1,
    getCompiledResolver: () => null,
    getDynamicHistory: async () => [],
    appendDynamicHistory: async () => {},
    passthrough: async () => {
      throw new Error('not used')
    },
    loadFixture: () => ({ status: 200, headers: {}, body: fixtureBody }),
    now: () => NOW,
    writeLog: async (entry) => {
      written.push(entry)
    },
    ...overrides,
  }
  return { handle: createMockHandler(deps), written }
}

function helloRequest(body: unknown = { customerId: 'c1' }): Request {
  return new Request('http://localhost:3000/hello', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'

function tracedRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/hello', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ customerId: 'c1' }),
  })
}

const settle = () => new Promise((r) => setTimeout(r, 0))

function spyConsole() {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return {
    info,
    warn,
    error,
    restore: () => {
      info.mockRestore()
      warn.mockRestore()
      error.mockRestore()
    },
  }
}

describe('mock handler logging', () => {
  it('appends delay= to the console line when the fixture declares a delay', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({
      consoleLogLevel: 'info',
      sleep: async () => {},
      loadFixture: () => ({ status: 200, headers: {}, delay: '400ms', body: { ok: true } }),
    })
    await handle(helloRequest(), ['hello'])
    await settle()
    expect(consoleSpy.info).toHaveBeenCalledTimes(1)
    expect(consoleSpy.info.mock.calls[0][0]).toMatch(
      /^\[mock\] POST \/hello -> 200 \d+ms test-system\/hello profile=c1 scenario=default outcome=fixture delay=400ms$/,
    )
    consoleSpy.restore()
  })

  it('omits delay= when the fixture has no delay', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({ consoleLogLevel: 'info' })
    await handle(helloRequest(), ['hello'])
    await settle()
    expect(consoleSpy.info.mock.calls[0][0]).not.toContain('delay=')
    consoleSpy.restore()
  })

  it('prints a compact info line for routed fixture responses regardless of fixture status', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({
      consoleLogLevel: 'info',
      loadFixture: () => ({ status: 404, headers: {}, body: { expected: 'missing' } }),
    })

    const res = await handle(helloRequest(), ['hello'])

    expect(res.status).toBe(404)
    expect(consoleSpy.info).toHaveBeenCalledTimes(1)
    expect(consoleSpy.info.mock.calls[0][0]).toMatch(
      /^\[mock\] POST \/hello -> 404 \d+ms test-system\/hello profile=c1 scenario=default outcome=fixture$/,
    )
    expect(consoleSpy.warn).not.toHaveBeenCalled()
    expect(consoleSpy.error).not.toHaveBeenCalled()
    consoleSpy.restore()
  })

  it('treats unmatched requests as warnings and honors the warn threshold', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({ consoleLogLevel: 'warn' })

    await handle(helloRequest(), ['hello'])
    await handle(new Request('http://localhost:3000/nope?x=1', { method: 'GET' }), ['nope'])

    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
    expect(consoleSpy.warn.mock.calls[0][0]).toMatch(
      /^\[mock\] GET \/nope\?x=1 -> 404 \d+ms outcome=error error=no_match$/,
    )
    expect(consoleSpy.error).not.toHaveBeenCalled()
    consoleSpy.restore()
  })

  it('logs unmocked-user fallback as a warning when the response succeeds', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({
      consoleLogLevel: 'warn',
      unmockedUsers: 'DEFAULT_MOCK',
      getProfile: async () => null,
    })

    const res = await handle(helloRequest({ customerId: 'ghost' }), ['hello'])

    expect(res.status).toBe(200)
    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
    expect(consoleSpy.warn.mock.calls[0][0]).toMatch(
      /^\[mock\] POST \/hello -> 200 \d+ms test-system\/hello profile=ghost scenario=default source=unmocked_policy outcome=fixture$/,
    )
    expect(consoleSpy.error).not.toHaveBeenCalled()
    consoleSpy.restore()
  })

  it('logs profile-not-found under UNMOCKED_USERS=ERROR as an error', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({
      consoleLogLevel: 'error',
      getProfile: async () => null,
    })

    const res = await handle(helloRequest({ customerId: 'ghost' }), ['hello'])

    expect(res.status).toBe(404)
    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).not.toHaveBeenCalled()
    expect(consoleSpy.error).toHaveBeenCalledTimes(1)
    expect(consoleSpy.error.mock.calls[0][0]).toMatch(
      /^\[mock\] POST \/hello -> 404 \d+ms test-system\/hello profile=ghost outcome=error error=profile_not_found$/,
    )
    consoleSpy.restore()
  })

  it('logs failed request-log writes as warnings through the configured threshold', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({
      consoleLogLevel: 'warn',
      writeLog: async () => {
        throw new Error('mongo down')
      },
    })

    const res = await handle(helloRequest(), ['hello'])
    await settle()

    expect(res.status).toBe(200)
    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).toHaveBeenCalledWith(
      '[mock-log] failed to write log entry: mongo down',
    )
    expect(consoleSpy.error).not.toHaveBeenCalled()
    consoleSpy.restore()
  })

  it('echoes a log id header and writes a matching entry', async () => {
    const { handle, written } = handlerWith()

    const res = await handle(helloRequest(), ['hello'])
    await settle()

    const logId = res.headers.get('x-mock-log-id')
    expect(logId).toMatch(/^lg_/)
    expect(written).toHaveLength(1)
    const entry = written[0]
    expect(entry.logId).toBe(logId)
    expect(entry.kind).toBe('request')
    expect(entry.method).toBe('POST')
    expect(entry.path).toBe('/hello')
    expect(entry.profileId).toBe('c1')
    expect(entry.system).toBe('test-system')
    expect(entry.endpoint).toBe('hello')
    expect(entry.outcome).toBe('fixture')
    expect(entry.request?.body).toEqual({ customerId: 'c1' })
    expect(entry.request?.truncated).toBe(false)
    expect(entry.response?.status).toBe(200)
    expect(entry.response?.body).toEqual({ ok: true })
    expect(entry.response?.headers['x-mock-log-id']).toBe(logId)
    expect(typeof entry.durationMs).toBe('number')
    expect(entry.ts).toBeInstanceOf(Date)
    expect(entry.trace.scenario).toBe('default')
    expect(entry.trace.scenarioSource).toBe('implicit')
    expect(entry.trace.profileResolution).toEqual({
      selector: '$.customerId',
      value: 'c1',
      via: 'direct',
    })
  })

  it('redacts authorization headers from persisted request logs', async () => {
    const { handle, written } = handlerWith()
    const request = new Request('http://localhost:3000/hello', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ customerId: 'c1' }),
    })

    await handle(request, ['hello'])
    await settle()

    expect(written).toHaveLength(1)
    expect(written[0].request?.headers.authorization).toBe('[REDACTED]')
    expect(written[0].request?.headers['content-type']).toBe('application/json')
  })

  it('records error entries for unmatched requests', async () => {
    const { handle, written } = handlerWith()

    const res = await handle(
      new Request('http://localhost:3000/nope', { method: 'GET' }),
      ['nope'],
    )
    await settle()

    expect(res.status).toBe(404)
    expect(written).toHaveLength(1)
    expect(written[0].outcome).toBe('error')
    expect(written[0].error?.code).toBe('no_match')
    expect(written[0].profileId).toBeUndefined()
  })

  it('does not write request logs for Next.js internal asset paths', async () => {
    const { handle, written } = handlerWith()

    const res = await handle(
      new Request('http://localhost:3000/_next/static/chunks/app.js', { method: 'GET' }),
      ['_next', 'static', 'chunks', 'app.js'],
    )
    await settle()

    expect(res.status).toBe(404)
    expect(res.headers.get('x-mock-log-id')).toBeNull()
    expect(written).toHaveLength(0)
  })

  it('records an error entry when passthrough throws before receiving a response', async () => {
    const { handle, written } = handlerWith({
      env: { TEST_SYSTEM_URL: 'http://127.0.0.1:1' },
      getProfile: async (id) =>
        id === 'c1'
          ? {
              ...profile,
              endpointScenarios: { hello: 'real' },
            }
          : null,
      passthrough: async () => {
        const err = new TypeError('fetch failed') as TypeError & { cause?: unknown }
        err.cause = { code: 'ECONNREFUSED' }
        throw err
      },
    })

    const res = await handle(helloRequest(), ['hello'])
    await settle()

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'passthrough request failed',
      endpoint: 'hello',
      upstream: 'http://127.0.0.1:1/hello',
      message: 'fetch failed (ECONNREFUSED)',
    })
    expect(written).toHaveLength(1)
    expect(written[0].profileId).toBe('c1')
    expect(written[0].outcome).toBe('error')
    expect(written[0].error?.code).toBe('passthrough_failed')
    expect(written[0].error?.message).toContain('ECONNREFUSED')
    expect(written[0].trace.scenario).toBe('real')
    expect(written[0].response?.status).toBe(502)
  })

  it('truncates oversized bodies and flags them', async () => {
    const bigString = 'x'.repeat(20 * 1024)
    const { handle, written } = handlerWith({}, { blob: bigString })

    await handle(helloRequest({ customerId: 'c1', padding: bigString }), ['hello'])
    await settle()

    const entry = written[0]
    expect(entry.request?.truncated).toBe(true)
    expect(typeof entry.request?.body).toBe('string')
    expect((entry.request?.body as string).length).toBeLessThanOrEqual(16 * 1024)
    expect(entry.response?.truncated).toBe(true)
    expect((entry.response?.body as string).length).toBeLessThanOrEqual(16 * 1024)
  })

  it('serves the response even when the log write fails', async () => {
    const { handle } = handlerWith({
      writeLog: async () => {
        throw new Error('mongo down')
      },
    })

    const res = await handle(helloRequest(), ['hello'])
    await settle()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('works without a writeLog dependency', async () => {
    const { handle } = handlerWith({ writeLog: undefined })
    const res = await handle(helloRequest(), ['hello'])
    expect(res.status).toBe(200)
  })
})

describe('mock handler JSON console logging', () => {
  function parsedLine(call: unknown[]): Record<string, unknown> {
    return JSON.parse(call[0] as string) as Record<string, unknown>
  }

  it('emits one ECS-style object per request, with the text line kept as message', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({
      consoleLogLevel: 'info',
      logFormat: 'json',
      sleep: async () => {},
      loadFixture: () => ({ status: 200, headers: {}, delay: '400ms', body: { ok: true } }),
    })

    const res = await handle(
      new Request('http://localhost:3000/hello?trace=1&x=2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: 'c1' }),
      }),
      ['hello'],
    )
    await settle()

    expect(consoleSpy.info).toHaveBeenCalledTimes(1)
    const line = parsedLine(consoleSpy.info.mock.calls[0])
    expect(line).toMatchObject({
      'log.level': 'info',
      message: expect.stringMatching(/^\[mock\] POST \/hello\?trace=1&x=2 -> 200 /),
      'service.name': 'mock-server',
      'http.request.method': 'POST',
      'url.path': '/hello',
      // ECS stores the query without the leading "?"
      'url.query': 'trace=1&x=2',
      'http.response.status_code': 200,
      'mock.logId': res.headers.get('x-mock-log-id'),
      'mock.system': 'test-system',
      'mock.endpoint': 'hello',
      'mock.profileId': 'c1',
      'mock.scenario': 'default',
      'mock.scenarioSource': 'implicit',
      'mock.outcome': 'fixture',
      'mock.delayMs': 400,
    })
    expect(typeof line['service.version']).toBe('string')
    expect(Date.parse(line['@timestamp'] as string)).not.toBeNaN()
    // event.duration is nanoseconds per ECS, so it is 1e6 × the ms in `message`.
    const durationMs = Number(/-> 200 (\d+)ms/.exec(line.message as string)![1])
    expect(line['event.duration']).toBe(durationMs * 1_000_000)
    expect(line['mock.error.code']).toBeUndefined()
    consoleSpy.restore()
  })

  it('omits url.query entirely when the request has no query string', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({ consoleLogLevel: 'info', logFormat: 'json' })

    await handle(helloRequest(), ['hello'])
    await settle()

    const line = parsedLine(consoleSpy.info.mock.calls[0])
    expect(line).not.toHaveProperty('url.query')
    consoleSpy.restore()
  })

  it('routes severity to the matching console method and log.level', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({ consoleLogLevel: 'warn', logFormat: 'json' })

    await handle(helloRequest(), ['hello'])
    await handle(new Request('http://localhost:3000/nope?x=1', { method: 'GET' }), ['nope'])
    await settle()

    expect(consoleSpy.info).not.toHaveBeenCalled()
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
    expect(parsedLine(consoleSpy.warn.mock.calls[0])).toMatchObject({
      'log.level': 'warn',
      'http.request.method': 'GET',
      'url.path': '/nope',
      'url.query': 'x=1',
      'http.response.status_code': 404,
      'mock.outcome': 'error',
      'mock.error.code': 'no_match',
    })
    consoleSpy.restore()
  })

  it('emits the failed-log-write warning as JSON too, so the stream has no stray text lines', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({
      consoleLogLevel: 'warn',
      logFormat: 'json',
      writeLog: async () => {
        throw new Error('mongo down')
      },
    })

    const res = await handle(helloRequest(), ['hello'])
    await settle()

    expect(consoleSpy.warn).toHaveBeenCalledTimes(1)
    expect(parsedLine(consoleSpy.warn.mock.calls[0])).toMatchObject({
      'log.level': 'warn',
      message: '[mock-log] failed to write log entry: mongo down',
      'mock.logId': res.headers.get('x-mock-log-id'),
    })
    consoleSpy.restore()
  })

  it('emits the caller trace ID as ECS trace.id, alongside the sampled flag', async () => {
    const consoleSpy = spyConsole()
    const { handle, written } = handlerWith({ consoleLogLevel: 'info', logFormat: 'json' })

    await handle(tracedRequest({ traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01` }), ['hello'])
    await settle()

    expect(parsedLine(consoleSpy.info.mock.calls[0])).toMatchObject({
      'trace.id': TRACE_ID,
      'mock.traceSampled': true,
    })
    expect(written[0].traceId).toBe(TRACE_ID)
    consoleSpy.restore()
  })

  it('falls back to x-request-id, and reports no sampled flag for it', async () => {
    const consoleSpy = spyConsole()
    const { handle, written } = handlerWith({ consoleLogLevel: 'info', logFormat: 'json' })

    await handle(tracedRequest({ 'x-request-id': 'req-42' }), ['hello'])
    await settle()

    const line = parsedLine(consoleSpy.info.mock.calls[0])
    expect(line['trace.id']).toBe('req-42')
    expect(line).not.toHaveProperty('mock.traceSampled')
    expect(written[0].traceId).toBe('req-42')
    consoleSpy.restore()
  })

  it('omits the field entirely when the request carries no trace header', async () => {
    const consoleSpy = spyConsole()
    const { handle, written } = handlerWith({ consoleLogLevel: 'info', logFormat: 'json' })

    await handle(helloRequest(), ['hello'])
    await settle()

    expect(parsedLine(consoleSpy.info.mock.calls[0])).not.toHaveProperty('trace.id')
    expect(written[0]).not.toHaveProperty('traceId')
    consoleSpy.restore()
  })

  it('ignores a malformed traceparent rather than failing the request', async () => {
    const consoleSpy = spyConsole()
    const { handle, written } = handlerWith({ consoleLogLevel: 'info', logFormat: 'json' })

    const res = await handle(tracedRequest({ traceparent: 'not-a-traceparent' }), ['hello'])
    await settle()

    expect(res.status).toBe(200)
    expect(parsedLine(consoleSpy.info.mock.calls[0])).not.toHaveProperty('trace.id')
    expect(written[0]).not.toHaveProperty('traceId')
    consoleSpy.restore()
  })

  it('leaves the text format byte-identical when logFormat is unset', async () => {
    const consoleSpy = spyConsole()
    const { handle } = handlerWith({ consoleLogLevel: 'info' })

    await handle(helloRequest(), ['hello'])
    await settle()

    expect(consoleSpy.info.mock.calls[0][0]).toMatch(
      /^\[mock\] POST \/hello -> 200 \d+ms test-system\/hello profile=c1 scenario=default outcome=fixture$/,
    )
    consoleSpy.restore()
  })
})
