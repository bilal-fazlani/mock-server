import { Agent, fetch as undiciFetch } from 'undici'
import type { ClientIdentity } from '../client-identity'

export interface PassthroughRequest {
  baseUrl: string
  method: string
  path: string
  search: string
  headers: Record<string, string>
  rawBody: Buffer | null
  timeoutMs: number
  clientIdentity?: ClientIdentity & { system: string }
}

export interface ProxiedResponse {
  status: number
  headers: Record<string, string>
  bodyBytes: Buffer
}

// Hop-by-hop headers (RFC 9110 §7.6.1) plus host/content-length, which the
// outbound fetch must own. content-encoding/length are also stripped from the
// response because fetch transparently decompresses.
const STRIP_REQUEST = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'host',
  'content-length',
])

const STRIP_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authenticate',
  'content-encoding',
  'content-length',
])

const dispatchers = new Map<string, { cert: string; key: string; agent: Agent }>()

function dispatcherFor({ system, cert, key }: ClientIdentity & { system: string }): Agent {
  const cached = dispatchers.get(system)
  if (cached && cached.cert === cert && cached.key === key) return cached.agent
  void cached?.agent.close()
  const agent = new Agent({ connect: { cert, key } })
  dispatchers.set(system, { cert, key, agent })
  return agent
}

export async function passthrough(req: PassthroughRequest): Promise<ProxiedResponse> {
  const url = new URL(req.path + req.search, req.baseUrl)
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (!STRIP_REQUEST.has(key.toLowerCase())) headers[key] = value
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), req.timeoutMs)
  try {
    const hasBody = req.rawBody !== null && !['GET', 'HEAD'].includes(req.method.toUpperCase())
    const init = {
      method: req.method,
      headers,
      body: hasBody ? new Uint8Array(req.rawBody!) : undefined,
      signal: controller.signal,
      redirect: 'manual' as const,
    }
    const res = req.clientIdentity
      ? await undiciFetch(url, { ...init, dispatcher: dispatcherFor(req.clientIdentity) })
      : await fetch(url, init)
    const bodyBytes = Buffer.from(await res.arrayBuffer())
    const outHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE.has(key)) outHeaders[key] = value
    })
    return { status: res.status, headers: outHeaders, bodyBytes }
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        status: 504,
        headers: { 'content-type': 'application/json' },
        bodyBytes: Buffer.from(
          JSON.stringify({
            error: `upstream timeout after ${req.timeoutMs}ms`,
            upstream: req.baseUrl,
          }),
        ),
      }
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
