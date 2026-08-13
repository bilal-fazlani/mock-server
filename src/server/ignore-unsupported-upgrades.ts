// Serve requests that ask to switch to a protocol we do not speak, instead of
// dropping them (#72).
//
// Node routes a request to the HTTP server's `upgrade` event — never to the
// request listener — when it carries both `Connection: upgrade` and an
// `Upgrade` header **and the server has at least one `upgrade` listener**. That
// last condition is the whole mechanism: `lib/_http_server.js` decides with
//
//     req.upgrade = req.method === 'CONNECT' || server.listenerCount('upgrade') > 0
//
// so on a server with no such listener the very same request is parsed and
// answered as an ordinary HTTP/1.1 request, connection reuse and all.
//
// Next registers one unconditionally (`next/dist/server/lib/start-server.js`)
// and its handler ends the socket for any upgrade whose target resolves to a
// route (`next/dist/server/lib/router-server.js`: `if (matchedOutput) return
// socket.end()`). The client sees an empty reply.
//
// That is not a hypothetical: `java.net.http.HttpClient` defaults to
// `Version.HTTP_2`, and on a cleartext `http://` URL that means it opens with
// the h2c upgrade handshake — so a stock Spring Boot `RestClient` failed on its
// very first call to the mock. RFC 9110 §7.8 explicitly allows the other
// answer: "A server MAY ignore a received Upgrade header field if it wishes to
// continue using the current protocol on that connection."
//
// So the guard keeps the listener count at zero and lets Node do exactly that.
//
// An earlier fix instead took the first request head off the wire, stripped the
// upgrade negotiation from it and unshifted it back. That worked for the first
// request on a connection and only that one: a JDK client re-sends the
// handshake on every connection it considers new, and once one upgrade-bearing
// request got past the sanitizer it reached the parser intact and Next ended
// the socket — so the second POST on a kept-alive connection died with no
// response at all, while the first succeeded. Suppressing the dispatch covers
// every request on every connection, needs no framing to find where one request
// ends and the next begins, and leaves request bodies where Node put them.
//
// The cost is that `Upgrade: websocket` is no longer handed to Next either: it
// is answered as an ordinary request, which for this server means the router's
// normal 404. Nothing here serves websockets, and Next's production upgrade
// handler ends the socket for a matched route regardless, so there is nothing
// to preserve — and a 404 beats a silently closed connection. Development is
// unaffected: this guard ships only in the standalone entry point (see
// `serve-main.ts`), never in `next dev`, whose HMR websocket keeps working.

import http from 'node:http'
import type { Server } from 'node:http'

/** Marks a server whose upgrade dispatch is already suppressed. */
const GUARDED = Symbol('mock-server.upgradeGuarded')

/** Set on a patched `createServer` so installing twice is a no-op. */
const INSTALLED = Symbol('mock-server.upgradeGuardInstalled')

/** Every way a listener can be added to an `EventEmitter`. Missing one would
 *  leave a door open for the `upgrade` listener this guard exists to refuse. */
const REGISTRARS = ['on', 'addListener', 'once', 'prependListener', 'prependOnceListener'] as const

type Registrar = (typeof REGISTRARS)[number]
type Register = (event: string | symbol, listener: (...args: never[]) => void) => Server

/**
 * Stop a server from ever having an `upgrade` listener, so Node answers an
 * unsupported upgrade request as the ordinary HTTP/1.1 request it also is.
 *
 * Registrations are dropped rather than deferred — there is nothing to replay
 * them onto later — and any listener added before the guard ran is removed.
 * Applying this twice to one server is a no-op.
 */
export function ignoreUnsupportedUpgrades<T extends Server>(server: T): T {
  const guarded = server as T & { [GUARDED]?: true }
  if (guarded[GUARDED]) return server
  guarded[GUARDED] = true

  // Next registers its listener after `createServer` returns, but a caller
  // wrapping an already-built server may not have.
  server.removeAllListeners('upgrade')

  for (const name of REGISTRARS) {
    const register = (server[name] as Register).bind(server)
    const refuse: Register = (event, listener) => (event === 'upgrade' ? server : register(event, listener))
    ;(server as unknown as Record<Registrar, Register>)[name] = refuse
  }

  return server
}

/**
 * Wrap every HTTP server created from here on, so Next's own
 * `http.createServer(...)` call — which we never get to touch — is covered.
 * Must run before the server is created, which means before Next's standalone
 * entry point is loaded.
 */
export function installUpgradeGuard(target: { createServer: typeof http.createServer } = http): void {
  const current = target.createServer as typeof http.createServer & { [INSTALLED]?: true }
  if (current[INSTALLED]) return

  const patched = ((...args: Parameters<typeof http.createServer>) =>
    ignoreUnsupportedUpgrades(current(...args))) as typeof http.createServer & { [INSTALLED]?: true }
  patched[INSTALLED] = true
  target.createServer = patched
}
