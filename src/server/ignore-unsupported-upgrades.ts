// Serve requests that ask to switch to a protocol we do not speak, instead of
// dropping them (#72).
//
// Node routes a request to the HTTP server's `upgrade` event — never to the
// request listener — when it carries both `Connection: upgrade` and an
// `Upgrade` header. Next registers such a listener unconditionally
// (`next/dist/server/lib/start-server.js`) and its handler ends the socket for
// any upgrade whose target resolves to a route
// (`next/dist/server/lib/router-server.js`: `if (matchedOutput) return
// socket.end()`). The client sees an empty reply on every route.
//
// That is not a hypothetical: `java.net.http.HttpClient` defaults to
// `Version.HTTP_2`, and on a cleartext `http://` URL that means it opens with
// the h2c upgrade handshake — so a stock Spring Boot `RestClient` failed on its
// very first call to the mock. RFC 9110 §7.8 explicitly allows the other
// answer: "A server MAY ignore a received Upgrade header field if it wishes to
// continue using the current protocol on that connection."
//
// The fix takes the request head off the wire before Node's HTTP parser sees
// it, strips the upgrade negotiation, and hands the socket back. The parser
// then reads an ordinary HTTP/1.1 request and the route responds normally.
// Working at this level — rather than replaying the request from inside the
// `upgrade` event — is what keeps request bodies intact: once Node has decided
// a request is an upgrade, where the unread body lives differs by Node version
// (24+ wraps the socket and keeps feeding `req`; 22 frees the parser and leaves
// the bytes raw on the socket).
//
// `Upgrade: websocket` is passed through untouched, so Next's own upgrade
// handling is unaffected.

import http from 'node:http'
import type { Server } from 'node:http'
import type { Socket } from 'node:net'

/** Marks a socket already taken through the sanitizer, so the re-emitted
 *  `connection` event is not intercepted a second time. */
const SANITIZED = Symbol('mock-server.upgradeSanitized')

/** Set on a patched `createServer` so installing twice is a no-op. */
const INSTALLED = Symbol('mock-server.upgradeGuardInstalled')

/** Give up buffering and hand the socket over unchanged past this much head.
 *  Node's own `maxHeaderSize` default is 16 KiB, so anything this large is
 *  already headed for a 431 — that is Node's call to make, not ours. */
const MAX_HEAD_BYTES = 64 * 1024

/** Hand the socket over unchanged if the head never completes. Without this a
 *  client that opens a connection and stalls mid-header would sit in the
 *  sanitizer forever, outside the reach of Node's `headersTimeout`. */
const HEAD_TIMEOUT_MS = 30_000

const CRLF_CRLF = Buffer.from('\r\n\r\n', 'latin1')
const LF_LF = Buffer.from('\n\n', 'latin1')

/** Upgrade tokens we do speak: leave these alone and let Next answer them. */
const SUPPORTED_UPGRADES = new Set(['websocket'])

/** Headers that exist only to negotiate the upgrade, dropped along with it. */
const NEGOTIATION_HEADERS = new Set(['upgrade', 'http2-settings'])

/** Byte offset just past the end of the request head, or -1 while incomplete. */
function findHeadEnd(buffer: Buffer): number {
  const crlf = buffer.indexOf(CRLF_CRLF)
  const lf = buffer.indexOf(LF_LF)
  if (crlf === -1) return lf === -1 ? -1 : lf + LF_LF.length
  if (lf === -1 || crlf < lf) return crlf + CRLF_CRLF.length
  return lf + LF_LF.length
}

function splitHeader(line: string): { name: string; value: string } | null {
  const colon = line.indexOf(':')
  if (colon <= 0) return null
  return { name: line.slice(0, colon), value: line.slice(colon + 1) }
}

function tokenize(value: string): string[] {
  return value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

/**
 * Rewrite a request head that negotiates an upgrade we do not support, so it
 * reads as an ordinary HTTP/1.1 request.
 *
 * `head` is the request line and headers, without the blank-line terminator.
 * Returns the replacement head, or `null` to leave the request exactly as sent
 * — which is the answer for every request that is not negotiating an
 * unsupported upgrade, and the reason the common path costs nothing.
 */
export function rewriteUnsupportedUpgrade(head: string): string | null {
  const lines = head.split(/\r\n|\n/)

  // Obsolete line folding would leave a continuation line orphaned behind the
  // header it continues. Rare enough to not be worth reassembling; pass through.
  if (lines.some((line) => line.startsWith(' ') || line.startsWith('\t'))) return null

  let connectionUpgrade = false
  let upgraded = false
  for (const line of lines.slice(1)) {
    const header = splitHeader(line)
    if (!header) continue
    const name = header.name.trim().toLowerCase()
    if (name === 'connection' && tokenize(header.value).some((t) => t.toLowerCase() === 'upgrade')) {
      connectionUpgrade = true
    } else if (name === 'upgrade') {
      // A request naming even one protocol we speak is Next's to answer.
      if (tokenize(header.value).some((t) => SUPPORTED_UPGRADES.has(t.toLowerCase()))) return null
      upgraded = true
    }
  }

  // Node only diverts a request to the `upgrade` event when both are present,
  // so anything else is already being served normally — leave it untouched.
  if (!connectionUpgrade || !upgraded) return null

  const rewritten = [lines[0]]
  for (const line of lines.slice(1)) {
    const header = splitHeader(line)
    if (!header) {
      rewritten.push(line)
      continue
    }
    const name = header.name.trim().toLowerCase()
    if (NEGOTIATION_HEADERS.has(name)) continue
    if (name === 'connection') {
      const kept = tokenize(header.value).filter((t) => !NEGOTIATION_HEADERS.has(t.toLowerCase()))
      // An empty `Connection` is malformed; dropping it leaves the HTTP/1.1
      // default, which is the keep-alive the client would have got anyway.
      if (kept.length > 0) rewritten.push(`${header.name}: ${kept.join(', ')}`)
      continue
    }
    rewritten.push(line)
  }
  return rewritten.join('\r\n')
}

/**
 * Intercept a server's `connection` event so the first request head on every
 * connection passes through {@link rewriteUnsupportedUpgrade} before Node's
 * HTTP parser reads it.
 *
 * Only the first head is inspected: the h2c handshake is an opening move, sent
 * to establish the protocol of a fresh connection. Everything after it — the
 * request body, keep-alive follow-ups, pipelined requests — reaches the parser
 * over the same untouched socket.
 */
export function ignoreUnsupportedUpgrades<T extends Server>(server: T): T {
  const emit = server.emit.bind(server) as (event: string | symbol, ...args: unknown[]) => boolean

  server.emit = function (this: Server, event: string | symbol, ...args: unknown[]): boolean {
    const socket = args[0] as (Socket & { [SANITIZED]?: true }) | undefined
    if (event !== 'connection' || !socket || socket[SANITIZED]) {
      return emit(event, ...args)
    }
    socket[SANITIZED] = true

    let buffered: Buffer = Buffer.alloc(0)
    let settled = false

    const handOff = (replacement?: Buffer) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onGiveUp)
      socket.off('end', onGiveUp)
      socket.off('close', onGiveUp)
      const pending = replacement ?? buffered
      // Put the bytes back so Node parses the connection from its true start.
      if (pending.length > 0 && !socket.destroyed) socket.unshift(pending)
      emit('connection', socket)
    }

    // Hand over whatever arrived and let Node's own error, timeout and
    // malformed-request handling take it from here.
    const onGiveUp = () => handOff()

    const onData = (chunk: Buffer) => {
      buffered = buffered.length > 0 ? Buffer.concat([buffered, chunk]) : chunk
      const headEnd = findHeadEnd(buffered)
      if (headEnd === -1) {
        if (buffered.length > MAX_HEAD_BYTES) handOff()
        return
      }
      const terminator = buffered.subarray(headEnd - LF_LF.length, headEnd).equals(LF_LF) ? '\n\n' : '\r\n\r\n'
      const head = buffered.subarray(0, headEnd - terminator.length).toString('latin1')
      const rewritten = rewriteUnsupportedUpgrade(head)
      if (rewritten === null) return handOff()
      handOff(
        Buffer.concat([
          Buffer.from(`${rewritten}\r\n\r\n`, 'latin1'),
          buffered.subarray(headEnd),
        ]),
      )
    }

    const timer = setTimeout(onGiveUp, HEAD_TIMEOUT_MS)
    timer.unref()

    socket.on('data', onData)
    socket.on('error', onGiveUp)
    socket.on('end', onGiveUp)
    socket.on('close', onGiveUp)
    return true
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
