import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { ignoreUnsupportedUpgrades, installUpgradeGuard } from '@/server/ignore-unsupported-upgrades'

describe('installUpgradeGuard', () => {
  it('wraps servers created after it runs, once', () => {
    const created: http.Server[] = []
    const target = {
      createServer: ((...args: Parameters<typeof http.createServer>) => {
        const server = http.createServer(...args)
        created.push(server)
        return server
      }) as typeof http.createServer,
    }
    const beforeInstall = target.createServer

    installUpgradeGuard(target)
    const afterFirst = target.createServer
    installUpgradeGuard(target)

    expect(afterFirst).not.toBe(beforeInstall)
    expect(target.createServer).toBe(afterFirst)

    const server = target.createServer()
    expect(created).toHaveLength(1)
    expect(server.listenerCount('upgrade')).toBe(0)
    server.close()
  })
})

describe('ignoreUnsupportedUpgrades', () => {
  it('refuses an upgrade listener however it is registered', () => {
    const server = ignoreUnsupportedUpgrades(http.createServer())
    const noop = () => {}

    server.on('upgrade', noop)
    server.addListener('upgrade', noop)
    server.once('upgrade', noop)
    server.prependListener('upgrade', noop)
    server.prependOnceListener('upgrade', noop)

    expect(server.listenerCount('upgrade')).toBe(0)
    server.close()
  })

  it('removes an upgrade listener registered before it ran', () => {
    const server = http.createServer()
    server.on('upgrade', () => {})

    expect(server.listenerCount('upgrade')).toBe(1)
    expect(ignoreUnsupportedUpgrades(server).listenerCount('upgrade')).toBe(0)
    server.close()
  })

  it('leaves every other event alone, and is idempotent', () => {
    const server = ignoreUnsupportedUpgrades(http.createServer())
    ignoreUnsupportedUpgrades(server)

    const seen: string[] = []
    server.on('request', () => seen.push('request'))
    server.once('close', () => seen.push('close'))

    expect(server.listenerCount('request')).toBe(1)
    expect(server.listenerCount('close')).toBe(1)
    expect(server.on('request', () => {})).toBe(server)
    server.close()
  })
})

/** One raw exchange on a fresh connection: write `chunks`, collect everything
 *  the server sends back, and resolve once the socket goes quiet. */
function exchange(port: number, chunks: string[], { holdMs = 250 } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      chunks.forEach((chunk, index) => setTimeout(() => socket.write(chunk), index * 40))
    })
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => (received += chunk))
    socket.on('error', reject)
    socket.on('close', () => resolve(received))
    setTimeout(() => socket.end(), chunks.length * 40 + holdMs)
  })
}

const statusLine = (response: string) => response.split('\r\n')[0]

/** Split a keep-alive stream into one body per response, walking it
 *  `Content-Length` by `Content-Length` — pipelined responses run together with
 *  no separator between one body and the next status line. */
function bodies(response: string): string[] {
  const out: string[] = []
  let rest = response
  while (rest.length > 0) {
    const headEnd = rest.indexOf('\r\n\r\n')
    if (headEnd === -1) break
    const length = Number(/content-length: *(\d+)/i.exec(rest.slice(0, headEnd))?.[1] ?? NaN)
    if (!Number.isFinite(length)) break
    out.push(rest.slice(headEnd + 4, headEnd + 4 + length))
    rest = rest.slice(headEnd + 4 + length)
  }
  return out
}

/** The h2c handshake `java.net.http.HttpClient` opens a cleartext connection
 *  with — and, on a connection it considers new, re-sends. */
const h2c = (method: string, url: string, extra = '') =>
  `${method} ${url} HTTP/1.1\r\n` +
  'Host: localhost\r\n' +
  'Connection: Upgrade, HTTP2-Settings\r\n' +
  'Upgrade: h2c\r\n' +
  'HTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA\r\n' +
  extra +
  '\r\n'

describe('ignoreUnsupportedUpgrades on a live server', () => {
  let server: http.Server
  let port: number

  beforeEach(async () => {
    server = ignoreUnsupportedUpgrades(
      http.createServer((req, res) => {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ url: req.url, method: req.method, body }))
        })
      }),
    )
    // Stands in for Next's upgrade handler, which ends the socket without
    // responding — the behaviour #72 reported. The guard must refuse it.
    server.on('upgrade', (_req, socket) => socket.end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('serves a GET carrying the h2c handshake as HTTP/1.1', async () => {
    const response = await exchange(port, [h2c('GET', '/inventory/SKU-1?customerId=probe-1')])

    expect(statusLine(response)).toBe('HTTP/1.1 200 OK')
    expect(JSON.parse(bodies(response)[0])).toMatchObject({
      url: '/inventory/SKU-1?customerId=probe-1',
      method: 'GET',
    })
  })

  it('delivers a request body that arrives after the head', async () => {
    const body = 'x'.repeat(40)
    const response = await exchange(port, [
      h2c('POST', '/orders', `Content-Length: ${body.length}\r\n`) + body.slice(0, 10),
      body.slice(10),
    ])

    expect(JSON.parse(bodies(response)[0])).toMatchObject({ method: 'POST', body })
  })

  // The regression the first fix left behind: it sanitised only the opening
  // head, so request 2 reached Next's upgrade handler and was dropped with no
  // response — while request 1 kept working, hiding it from any suite that
  // called an endpoint once.
  it('answers every upgrade-bearing request on one kept-alive connection, not just the first', async () => {
    const response = await exchange(port, [
      h2c('POST', '/quotes', 'Content-Length: 5\r\n') + 'one--',
      h2c('POST', '/quotes', 'Content-Length: 5\r\n') + 'two--',
      h2c('POST', '/quotes', 'Content-Length: 5\r\n') + 'three',
    ])

    expect(bodies(response).map((b) => JSON.parse(b).body)).toEqual(['one--', 'two--', 'three'])
  })

  it('keeps the connection usable for a follow-up that drops the handshake', async () => {
    const response = await exchange(port, [
      h2c('GET', '/first'),
      'GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n',
      h2c('GET', '/third'),
    ])

    expect(bodies(response).map((b) => JSON.parse(b).url)).toEqual(['/first', '/second', '/third'])
  })

  // Documented consequence of suppressing the dispatch: nothing here serves
  // websockets, so they get the router's ordinary answer rather than a socket
  // closed without a response.
  it('answers a websocket upgrade as an ordinary request', async () => {
    const response = await exchange(port, [
      'GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n\r\n',
    ])

    expect(statusLine(response)).toBe('HTTP/1.1 200 OK')
    expect(JSON.parse(bodies(response)[0])).toMatchObject({ url: '/socket' })
  })

  it('leaves an ordinary request untouched', async () => {
    const response = await exchange(port, ['GET /plain HTTP/1.1\r\nHost: localhost\r\n\r\n'])

    expect(statusLine(response)).toBe('HTTP/1.1 200 OK')
    expect(JSON.parse(bodies(response)[0])).toMatchObject({ url: '/plain' })
  })
})
