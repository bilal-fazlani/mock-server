export interface PassthroughRequest {
  baseUrl: string
  method: string
  path: string
  search: string
  headers: Record<string, string>
  rawBody: Buffer | null
  timeoutMs: number
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
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? new Uint8Array(req.rawBody!) : undefined,
      signal: controller.signal,
      redirect: 'manual',
    })
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
