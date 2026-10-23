// One listener per catalog system, each a loopback forwarder to the Next server
// on the admin port. Shared by the shipped entry (serve-main.ts) and the dev
// entry (dev-main.ts), so both route system traffic the same way.
//
// A forwarded request differs from the one received in exactly these ways:
//
// - its path gains the reserved `/__mock-system__/<slug>` prefix, so it reaches
//   the catch-all route instead of whatever Next serves at that path (`/`,
//   `/api`, `/_next`), and a Location pointing under that prefix is mapped back;
// - it carries this boot's token, which is what lets the app tell a forwarded
//   request from one sent straight to the admin port;
// - `x-forwarded-for` and `x-forwarded-port` are filled in when absent, with the
//   values Next would have filled in had the client connected to it directly;
// - hop-by-hop headers (RFC 9110 §7.6.1) are not forwarded, which also keeps an
//   `Upgrade` offer away from a `next dev` server that would end the socket.

import http from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { SystemDef } from '../lib/catalog/types'
import { SYSTEM_TOKEN_HEADER, systemPathPrefix } from '../lib/system-ports'
import { ignoreUnsupportedUpgrades } from './ignore-unsupported-upgrades'

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'upgrade'])

export interface SystemListenerOptions {
  systems: Pick<SystemDef, 'slug' | 'port'>[]
  bindAddress: string
  target: { host: string; port: number }
  token: string
}

export class SystemListenError extends Error {}

/** The loopback address that reaches a server listening on `bindAddress`. */
export function loopbackFor(bindAddress: string): string {
  if (bindAddress === '0.0.0.0') return '127.0.0.1'
  if (bindAddress === '::') return '::1'
  return bindAddress
}

/**
 * Opens every system's listener, resolving once all of them accept
 * connections. If any port can't be bound, the ones already open are closed and
 * the promise rejects with a `SystemListenError` naming the system and port.
 */
export async function startSystemListeners(options: SystemListenerOptions): Promise<Server[]> {
  const servers: Server[] = []
  try {
    for (const system of options.systems) {
      servers.push(await listen(system, options))
    }
  } catch (err) {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    throw err
  }
  return servers
}

function listen(system: Pick<SystemDef, 'slug' | 'port'>, options: SystemListenerOptions): Promise<Server> {
  const server = ignoreUnsupportedUpgrades(
    http.createServer((req, res) => forward(system, options, req, res)),
  )
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      reject(
        new SystemListenError(
          `cannot listen on ${options.bindAddress}:${system.port} for system "${system.slug}": ${describeListenError(err)}`,
        ),
      )
    }
    server.once('error', onError)
    server.listen(system.port, options.bindAddress, () => {
      server.off('error', onError)
      resolve(server)
    })
  })
}

function describeListenError(err: NodeJS.ErrnoException): string {
  if (err.code === 'EADDRINUSE') return 'the port is already in use'
  if (err.code === 'EACCES') return 'permission denied'
  if (err.code === 'EADDRNOTAVAIL') return 'the address is not available on this machine'
  return err.message
}

function forward(
  system: Pick<SystemDef, 'slug' | 'port'>,
  options: SystemListenerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = req.url ?? '/'
  if (!url.startsWith('/')) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'request target must be a path', system: system.slug }))
    return
  }
  const prefix = systemPathPrefix(system.slug)
  // `/` maps to the bare prefix: with a trailing slash Next would redirect it.
  const path = url === '/' || url.startsWith('/?') ? prefix + url.slice(1) : prefix + url

  const headers: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || lower === SYSTEM_TOKEN_HEADER) continue
    seen.add(lower)
    headers.push(name, req.rawHeaders[i + 1])
  }
  if (!seen.has('x-forwarded-for') && req.socket.remoteAddress) {
    headers.push('x-forwarded-for', req.socket.remoteAddress)
  }
  if (!seen.has('x-forwarded-port')) headers.push('x-forwarded-port', String(system.port))
  headers.push(SYSTEM_TOKEN_HEADER, options.token)

  const upstream = http.request(
    {
      host: options.target.host,
      port: options.target.port,
      method: req.method,
      path,
      headers,
    },
    (upstreamRes) => {
      const responseHeaders: string[] = []
      for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2) {
        const name = upstreamRes.rawHeaders[i]
        const lower = name.toLowerCase()
        if (HOP_BY_HOP.has(lower)) continue
        const value = upstreamRes.rawHeaders[i + 1]
        responseHeaders.push(name, unprefixHeader(lower, value, prefix))
      }
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, responseHeaders)
      // pipe() never ends `res` when the upstream dies mid-body; the client would hang.
      upstreamRes.on('close', () => {
        if (!upstreamRes.complete) res.destroy()
      })
      upstreamRes.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    if (res.headersSent) {
      res.destroy(err)
      return
    }
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({ error: 'mock server is not reachable on its admin port', system: system.slug }),
    )
  })
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy()
  })
  req.pipe(upstream)
}

function unprefixHeader(name: string, value: string, prefix: string): string {
  if (name === 'location') return unprefixLocation(value, prefix)
  if (name === 'refresh') {
    const match = /^(\s*\d+\s*;\s*url=)(.*)$/i.exec(value)
    if (match) return match[1] + unprefixLocation(match[2], prefix)
  }
  return value
}

function unprefixLocation(location: string, prefix: string): string {
  const match = /^(https?:\/\/[^/]+)?(\/.*)$/.exec(location)
  if (!match) return location
  const [, origin = '', path] = match
  if (path !== prefix && !path.startsWith(prefix + '/') && !path.startsWith(prefix + '?')) {
    return location
  }
  const rest = path.slice(prefix.length)
  return origin + (rest.startsWith('/') ? rest : '/' + rest)
}
