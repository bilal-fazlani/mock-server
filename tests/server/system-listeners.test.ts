import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { SYSTEM_TOKEN_HEADER } from '../../src/lib/system-ports'
import {
  loopbackFor,
  startSystemListeners,
  SystemListenError,
} from '../../src/server/system-listeners'

const TOKEN = 't'.repeat(64)
const open: Array<{ close: (cb: () => void) => unknown }> = []

afterEach(async () => {
  while (open.length) {
    const server = open.pop()!
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

interface Seen {
  method: string
  url: string
  rawHeaders: string[]
  headers: http.IncomingHttpHeaders
  body: string
}

async function fakeAdmin(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_, res) => {
    res.writeHead(201, 'Made', ['x-reply', 'one', 'x-reply', 'two'])
    res.end('ok')
  },
): Promise<{ port: number; seen: Seen[]; server: http.Server }> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        rawHeaders: req.rawHeaders,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      })
      respond(req, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  open.push(server)
  return { port: (server.address() as net.AddressInfo).port, seen, server }
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function listenersFor(adminPort: number, ...slugs: string[]) {
  const systems = []
  for (const slug of slugs) systems.push({ slug, port: await freePort() })
  const servers = await startSystemListeners({
    systems,
    bindAddress: '127.0.0.1',
    target: { host: '127.0.0.1', port: adminPort },
    token: TOKEN,
  })
  open.push(...servers)
  return systems
}

function request(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; statusMessage: string; rawHeaders: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path ?? '/', headers: options.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('error', reject)
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            statusMessage: res.statusMessage!,
            rawHeaders: res.rawHeaders,
            body: Buffer.concat(chunks).toString(),
          }),
        )
      },
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

describe('system listeners', () => {
  it('forwards under the reserved prefix with the boot token, passing method, headers and body through', async () => {
    const admin = await fakeAdmin()
    const [alpha] = await listenersFor(admin.port, 'alpha')
    const res = await request(alpha.port, {
      method: 'POST',
      path: '/ui/orders?x=1',
      headers: { 'X-Custom': 'kept', 'content-type': 'application/json' },
      body: '{"a":1}',
    })

    expect(res.status).toBe(201)
    expect(res.statusMessage).toBe('Made')
    expect(res.body).toBe('ok')
    expect(res.rawHeaders).toEqual(expect.arrayContaining(['x-reply', 'one', 'x-reply', 'two']))
    const [seen] = admin.seen
    expect(seen.method).toBe('POST')
    expect(seen.url).toBe('/__mock-system__/alpha/ui/orders?x=1')
    expect(seen.body).toBe('{"a":1}')
    expect(seen.rawHeaders).toEqual(expect.arrayContaining(['X-Custom', 'kept']))
    expect(seen.headers[SYSTEM_TOKEN_HEADER]).toBe(TOKEN)
    expect(seen.headers['x-forwarded-for']).toBe('127.0.0.1')
    expect(seen.headers['x-forwarded-port']).toBe(String(alpha.port))
  })

  it('maps the root path to the bare prefix', async () => {
    const admin = await fakeAdmin()
    const [alpha] = await listenersFor(admin.port, 'alpha')
    await request(alpha.port, { path: '/' })
    await request(alpha.port, { path: '/?q=1' })
    expect(admin.seen.map((s) => s.url)).toEqual(['/__mock-system__/alpha', '/__mock-system__/alpha?q=1'])
  })

  it('replaces a token the client sent and keeps forwarded headers it already set', async () => {
    const admin = await fakeAdmin()
    const [alpha] = await listenersFor(admin.port, 'alpha')
    await request(alpha.port, {
      headers: { [SYSTEM_TOKEN_HEADER]: 'forged', 'x-forwarded-for': '203.0.113.9' },
    })
    expect(admin.seen[0].headers[SYSTEM_TOKEN_HEADER]).toBe(TOKEN)
    expect(admin.seen[0].headers['x-forwarded-for']).toBe('203.0.113.9')
  })

  it('serves an upgrade offer as an ordinary request and does not forward it', async () => {
    const admin = await fakeAdmin()
    const [alpha] = await listenersFor(admin.port, 'alpha')
    const res = await request(alpha.port, {
      method: 'POST',
      path: '/hello',
      headers: { connection: 'Upgrade, HTTP2-Settings', upgrade: 'h2c', 'http2-settings': 'AAMAAABkAAQAoAAAAAIAAAAA' },
      body: 'x',
    })
    expect(res.status).toBe(201)
    expect(admin.seen[0].headers.upgrade).toBeUndefined()
    expect(admin.seen[0].body).toBe('x')
  })

  it('answers every upgrade offer on a kept-alive connection, not just the first', async () => {
    const admin = await fakeAdmin((_, res) => res.end(`echo:${admin.seen.at(-1)!.body}`))
    admin.server.on('upgrade', (_, socket: net.Socket) => socket.end())
    const [alpha] = await listenersFor(admin.port, 'alpha')

    const socket = net.connect(alpha.port, '127.0.0.1')
    open.push({ close: (cb) => (socket.destroy(), cb()) })
    let received = ''
    socket.on('data', (chunk: Buffer) => (received += chunk))

    for (const body of ['req1', 'req2', 'req3']) {
      socket.write(
        'POST /hello HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\n' +
          `HTTP2-Settings: AAMAAABkAAQAoAAAAAIAAAAA\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
      )
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (received.includes(`echo:${body}`)) {
            socket.off('data', check)
            socket.off('close', fail)
            resolve()
          }
        }
        const fail = () => reject(new Error(`connection closed before ${body} was answered:\n${received}`))
        socket.on('data', check)
        socket.once('close', fail)
        check()
      })
    }

    expect(received.match(/HTTP\/1\.1 200 /g)).toHaveLength(3)
    expect(admin.seen.map((s) => s.body)).toEqual(['req1', 'req2', 'req3'])
    expect(admin.seen.every((s) => s.headers.upgrade === undefined)).toBe(true)
    expect(socket.destroyed).toBe(false)
  })

  it('maps a redirect under the prefix back to the system path', async () => {
    const admin = await fakeAdmin((req, res) => {
      res.writeHead(308, { location: '/__mock-system__/alpha/orders' })
      res.end()
    })
    const [alpha] = await listenersFor(admin.port, 'alpha')
    const res = await request(alpha.port, { path: '/orders/' })
    expect(res.status).toBe(308)
    expect(res.rawHeaders).toEqual(expect.arrayContaining(['location', '/orders']))
  })

  it('maps the Refresh header of a redirect back too', async () => {
    const admin = await fakeAdmin((req, res) => {
      res.writeHead(308, { location: '/__mock-system__/alpha/orders', refresh: '0;url=/__mock-system__/alpha/orders' })
      res.end()
    })
    const [alpha] = await listenersFor(admin.port, 'alpha')
    const res = await request(alpha.port, { path: '/orders/' })
    expect(res.rawHeaders).toEqual(expect.arrayContaining(['refresh', '0;url=/orders']))
  })

  it('resets the client when the admin side dies mid-body', async () => {
    const admin = await fakeAdmin((req, res) => {
      res.writeHead(200, { 'content-length': '100' })
      res.write('partial')
      setTimeout(() => res.socket?.destroy(), 20)
    })
    const [alpha] = await listenersFor(admin.port, 'alpha')
    await expect(request(alpha.port)).rejects.toThrow()
  })

  it('keeps each system on its own prefix', async () => {
    const admin = await fakeAdmin()
    const [alpha, beta] = await listenersFor(admin.port, 'alpha', 'beta')
    await request(alpha.port, { path: '/same' })
    await request(beta.port, { path: '/same' })
    expect(admin.seen.map((s) => s.url)).toEqual(['/__mock-system__/alpha/same', '/__mock-system__/beta/same'])
  })

  it('answers 502 naming the system while the admin port is not up', async () => {
    const [alpha] = await listenersFor(await freePort(), 'alpha')
    const res = await request(alpha.port)
    expect(res.status).toBe(502)
    expect(JSON.parse(res.body)).toMatchObject({ system: 'alpha' })
  })

  it('rejects naming the system and port when one cannot be bound, closing the others', async () => {
    const taken = net.createServer()
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve))
    open.push(taken)
    const takenPort = (taken.address() as net.AddressInfo).port
    const firstPort = await freePort()

    const attempt = startSystemListeners({
      systems: [
        { slug: 'alpha', port: firstPort },
        { slug: 'beta', port: takenPort },
      ],
      bindAddress: '127.0.0.1',
      target: { host: '127.0.0.1', port: 1 },
      token: TOKEN,
    })
    await expect(attempt).rejects.toThrow(SystemListenError)
    await expect(attempt).rejects.toThrow(
      `cannot listen on 127.0.0.1:${takenPort} for system "beta": the port is already in use`,
    )
    const probe = net.createServer()
    await new Promise<void>((resolve) => probe.listen(firstPort, '127.0.0.1', resolve))
    await new Promise((resolve) => probe.close(resolve))
  })
})

describe('loopbackFor', () => {
  it('reaches a wildcard bind through loopback and a specific one directly', () => {
    expect(loopbackFor('0.0.0.0')).toBe('127.0.0.1')
    expect(loopbackFor('::')).toBe('::1')
    expect(loopbackFor('10.1.2.3')).toBe('10.1.2.3')
  })
})
