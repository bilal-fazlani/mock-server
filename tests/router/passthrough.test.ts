import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { passthrough } from '../../src/lib/router/passthrough'

let server: http.Server
let baseUrl: string
const BINARY = Buffer.from([0x89, 0x50, 0x00, 0xff, 0x01])

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/slow')) {
      setTimeout(() => res.end('late'), 500)
      return
    }
    if (req.url?.startsWith('/binary')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(BINARY)
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', 'x-upstream': 'yes' })
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          host: req.headers.host,
          proxyAuth: req.headers['proxy-authorization'] ?? null,
          xKeep: req.headers['x-keep'] ?? null,
          echo: Buffer.concat(chunks).toString('utf8'),
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('passthrough', () => {
  it('preserves method/path/query/body, strips hop-by-hop headers, rewrites Host', async () => {
    const res = await passthrough({
      baseUrl,
      method: 'POST',
      path: '/hello/world',
      search: '?a=1&b=two',
      headers: {
        host: 'original.example.com',
        'proxy-authorization': 'secret',
        connection: 'keep-alive',
        'x-keep': 'kept',
        'content-type': 'application/json',
      },
      rawBody: Buffer.from('{"customerId":"c1"}'),
      timeoutMs: 5000,
    })
    expect(res.status).toBe(201)
    expect(res.headers['x-upstream']).toBe('yes')
    const upstream = JSON.parse(res.bodyBytes.toString('utf8'))
    expect(upstream.method).toBe('POST')
    expect(upstream.url).toBe('/hello/world?a=1&b=two')
    expect(upstream.host).toBe(new URL(baseUrl).host) // rewritten, not original.example.com
    expect(upstream.proxyAuth).toBeNull() // hop-by-hop stripped
    expect(upstream.xKeep).toBe('kept') // ordinary header preserved
    expect(upstream.echo).toBe('{"customerId":"c1"}')
  })

  it('returns the upstream body as opaque bytes', async () => {
    const res = await passthrough({
      baseUrl,
      method: 'GET',
      path: '/binary',
      search: '',
      headers: {},
      rawBody: null,
      timeoutMs: 5000,
    })
    expect(res.status).toBe(200)
    expect(Buffer.compare(res.bodyBytes, BINARY)).toBe(0)
  })

  it('returns 504 naming the upstream when the timeout elapses', async () => {
    const res = await passthrough({
      baseUrl,
      method: 'GET',
      path: '/slow',
      search: '',
      headers: {},
      rawBody: null,
      timeoutMs: 100,
    })
    expect(res.status).toBe(504)
    const body = JSON.parse(res.bodyBytes.toString('utf8'))
    expect(body.error).toMatch(/timeout/)
    expect(body.upstream).toBe(baseUrl)
  })
})
