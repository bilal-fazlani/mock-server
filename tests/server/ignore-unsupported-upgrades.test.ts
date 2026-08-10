import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import {
  ignoreUnsupportedUpgrades,
  installUpgradeGuard,
  rewriteUnsupportedUpgrade,
} from '@/server/ignore-unsupported-upgrades'

describe('rewriteUnsupportedUpgrade', () => {
  it('strips the h2c handshake a cleartext HTTP/2 client opens with', () => {
    const head = [
      'GET /inventory/SKU-1 HTTP/1.1',
      'Host: localhost:3000',
      'Connection: Upgrade, HTTP2-Settings',
      'Upgrade: h2c',
      'HTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA',
      'User-Agent: Java-http-client/21',
    ].join('\r\n')

    expect(rewriteUnsupportedUpgrade(head)).toBe(
      ['GET /inventory/SKU-1 HTTP/1.1', 'Host: localhost:3000', 'User-Agent: Java-http-client/21'].join('\r\n'),
    )
  })

  it('keeps the connection tokens that are not part of the upgrade', () => {
    const head = ['GET / HTTP/1.1', 'Connection: keep-alive, Upgrade', 'Upgrade: h2c'].join('\r\n')

    expect(rewriteUnsupportedUpgrade(head)).toBe(['GET / HTTP/1.1', 'Connection: keep-alive'].join('\r\n'))
  })

  it('matches tokens case-insensitively', () => {
    const head = ['POST / HTTP/1.1', 'CONNECTION: upgrade', 'UPGRADE: H2C'].join('\r\n')

    expect(rewriteUnsupportedUpgrade(head)).toBe('POST / HTTP/1.1')
  })

  it('leaves a websocket upgrade for Next to answer', () => {
    const head = [
      'GET /socket HTTP/1.1',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
    ].join('\r\n')

    expect(rewriteUnsupportedUpgrade(head)).toBeNull()
  })

  it.each([
    ['no Upgrade header', ['GET / HTTP/1.1', 'Connection: upgrade']],
    ['no Connection: upgrade', ['GET / HTTP/1.1', 'Upgrade: h2c']],
    ['no upgrade at all', ['GET / HTTP/1.1', 'Host: localhost', 'Accept: */*']],
  ])('leaves a request with %s exactly as sent', (_case, lines) => {
    expect(rewriteUnsupportedUpgrade(lines.join('\r\n'))).toBeNull()
  })

  it('passes through a head using obsolete line folding rather than orphaning the continuation', () => {
    const head = ['GET / HTTP/1.1', 'Connection: upgrade', 'Upgrade: h2c,', '\th2c-fake'].join('\r\n')

    expect(rewriteUnsupportedUpgrade(head)).toBeNull()
  })

  it('accepts a bare-LF head and normalises the rewrite to CRLF', () => {
    const head = ['GET / HTTP/1.1', 'Host: h', 'Connection: upgrade', 'Upgrade: h2c'].join('\n')

    expect(rewriteUnsupportedUpgrade(head)).toBe('GET / HTTP/1.1\r\nHost: h')
  })
})

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
    // The wrapper replaces `emit`; the raw server prototype's is untouched.
    expect(Object.hasOwn(server, 'emit')).toBe(true)
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

describe('ignoreUnsupportedUpgrades on a live server', () => {
  let server: http.Server
  let port: number
  let upgradesSeen: string[]

  beforeEach(async () => {
    upgradesSeen = []
    server = ignoreUnsupportedUpgrades(
      http.createServer((req, res) => {
        let body = ''
        req.setEncoding('utf8')
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ url: req.url, method: req.method, body, upgrade: req.headers.upgrade ?? null }))
        })
      }),
    )
    // Stands in for Next's upgrade handler, which ends the socket without
    // responding — the behaviour #72 reported.
    server.on('upgrade', (req, socket) => {
      upgradesSeen.push(String(req.headers.upgrade))
      socket.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('serves a GET carrying the h2c handshake as HTTP/1.1', async () => {
    const response = await exchange(port, [
      'GET /inventory/SKU-1?customerId=probe-1 HTTP/1.1\r\n' +
        'Host: localhost\r\n' +
        'Connection: Upgrade, HTTP2-Settings\r\n' +
        'Upgrade: h2c\r\n' +
        'HTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA\r\n\r\n',
    ])

    expect(statusLine(response)).toBe('HTTP/1.1 200 OK')
    expect(JSON.parse(bodies(response)[0])).toMatchObject({
      url: '/inventory/SKU-1?customerId=probe-1',
      method: 'GET',
      upgrade: null,
    })
    expect(upgradesSeen).toEqual([])
  })

  it('delivers a request body that arrives after the head', async () => {
    const body = 'x'.repeat(40)
    const response = await exchange(port, [
      'POST /orders HTTP/1.1\r\n' +
        'Host: localhost\r\n' +
        'Connection: Upgrade, HTTP2-Settings\r\n' +
        'Upgrade: h2c\r\n' +
        `Content-Length: ${body.length}\r\n\r\n` +
        body.slice(0, 10),
      body.slice(10),
    ])

    expect(JSON.parse(bodies(response)[0])).toMatchObject({ method: 'POST', body })
  })

  it('keeps the connection usable for the follow-up request', async () => {
    const response = await exchange(port, [
      'GET /first HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\n\r\n',
      'GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n',
    ])

    expect(bodies(response).map((b) => JSON.parse(b).url)).toEqual(['/first', '/second'])
  })

  it('still routes a websocket upgrade to the upgrade handler', async () => {
    const response = await exchange(port, [
      'GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n\r\n',
    ])

    expect(response).toBe('')
    expect(upgradesSeen).toEqual(['websocket'])
  })

  it('leaves an ordinary request untouched', async () => {
    const response = await exchange(port, ['GET /plain HTTP/1.1\r\nHost: localhost\r\n\r\n'])

    expect(statusLine(response)).toBe('HTTP/1.1 200 OK')
    expect(JSON.parse(bodies(response)[0])).toMatchObject({ url: '/plain' })
  })
})
