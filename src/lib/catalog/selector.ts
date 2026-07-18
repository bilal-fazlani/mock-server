export type DirectSelector =
  | { source: 'body'; segments: Array<string | number> }
  | { source: 'path'; name: string }
  | { source: 'query'; name: string }

export type ProfileKeySelector = {
  source: 'profileKey'
  namespace: string
  keySelector: DirectSelector
}

export type Selector = DirectSelector | ProfileKeySelector

export type BearerProfileIdSelector = {
  source: 'bearer'
  claim?: string
}

export type ProfileIdSelector = Selector | BearerProfileIdSelector

export class SelectorParseError extends Error {}

export interface RequestContext {
  body: unknown
  pathParams: Record<string, string>
  query: URLSearchParams
  headers: Record<string, string>
}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/
const PROFILE_KEY_NAMESPACE_RE = /^[a-z0-9][a-z0-9_-]*$/
const BODY_TOKEN_RE = /\.([a-zA-Z_][a-zA-Z0-9_]*)|\[(\d+)\]/g
const BEARER_TOKEN_RE = /^Bearer +([a-zA-Z0-9\-._~+/]+=*)$/i

export function parseProfileIdSelector(raw: string): ProfileIdSelector {
  if (raw === 'bearer') return { source: 'bearer' }
  if (raw.startsWith('bearer:')) {
    const claim = raw.slice('bearer:'.length)
    if (!NAME_RE.test(claim)) {
      throw new SelectorParseError(`invalid bearer claim selector: ${raw}`)
    }
    return { source: 'bearer', claim }
  }
  return parseSelector(raw)
}

export function parseSelector(raw: string): Selector {
  if (raw.startsWith('profileKey:')) {
    const rest = raw.slice('profileKey:'.length)
    const sep = rest.indexOf(':')
    if (sep <= 0) throw new SelectorParseError(`invalid profile key selector: ${raw}`)
    const namespace = rest.slice(0, sep)
    const nestedRaw = rest.slice(sep + 1)
    if (!PROFILE_KEY_NAMESPACE_RE.test(namespace) || nestedRaw.length === 0) {
      throw new SelectorParseError(`invalid profile key selector: ${raw}`)
    }
    const keySelector = parseSelector(nestedRaw)
    if (keySelector.source === 'profileKey') {
      throw new SelectorParseError(`invalid profile key selector: ${raw}`)
    }
    return { source: 'profileKey', namespace, keySelector }
  }
  if (raw.startsWith('path:')) {
    const name = raw.slice('path:'.length)
    if (!NAME_RE.test(name)) throw new SelectorParseError(`invalid path selector: ${raw}`)
    return { source: 'path', name }
  }
  if (raw.startsWith('query:')) {
    const name = raw.slice('query:'.length)
    if (!NAME_RE.test(name)) throw new SelectorParseError(`invalid query selector: ${raw}`)
    return { source: 'query', name }
  }
  if (raw.startsWith('$')) {
    return { source: 'body', segments: parseBodyPath(raw) }
  }
  throw new SelectorParseError(
    `selector must start with "$", "path:", or "query:": ${raw}`,
  )
}

function parseBodyPath(raw: string): Array<string | number> {
  const rest = raw.slice(1)
  const segments: Array<string | number> = []
  let consumed = 0
  BODY_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = BODY_TOKEN_RE.exec(rest)) !== null) {
    if (m.index !== consumed) throw new SelectorParseError(`invalid body selector: ${raw}`)
    segments.push(m[1] !== undefined ? m[1] : Number(m[2]))
    consumed = BODY_TOKEN_RE.lastIndex
  }
  if (consumed !== rest.length || segments.length === 0) {
    throw new SelectorParseError(`invalid body selector: ${raw}`)
  }
  return segments
}

// Extraction separates "the selector resolved to a value" from "no value is
// there". `null` used to double as both, which made a body field that is
// literally `false`/`null`/`{}` indistinguishable from a missing one. The
// `value` is whatever JSON the body/path/query held — any JSON type, including
// `null` — so callers that need a scalar (identity keys) narrow it themselves.
export type Extraction = { found: false } | { found: true; value: unknown }

const NOT_FOUND: Extraction = { found: false }

export function extractValue(selector: Selector, ctx: RequestContext): Extraction {
  if (selector.source === 'profileKey') return extractValue(selector.keySelector, ctx)
  if (selector.source === 'path') {
    const v = ctx.pathParams[selector.name]
    return v === undefined ? NOT_FOUND : { found: true, value: v }
  }
  if (selector.source === 'query') {
    const v = ctx.query.get(selector.name)
    return v === null ? NOT_FOUND : { found: true, value: v }
  }
  let current: unknown = ctx.body
  for (const seg of selector.segments) {
    if (typeof seg === 'number') {
      if (!Array.isArray(current)) return NOT_FOUND
      current = current[seg]
    } else {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return NOT_FOUND
      current = (current as Record<string, unknown>)[seg]
    }
  }
  // A present body key that is JSON `null` stays `{ found: true, value: null }`;
  // only an absent key (JS `undefined`) is treated as missing.
  return current === undefined ? NOT_FOUND : { found: true, value: current }
}

// Identity keys (profile IDs, capture keys) are only ever strings or numbers;
// any richer JSON value is nonsense there and collapses to "unresolved". This
// narrowing lives at the identity boundary, keeping the shared extractor wide.
export function extractScalar(
  selector: Selector,
  ctx: RequestContext,
): string | number | null {
  const extraction = extractValue(selector, ctx)
  if (!extraction.found) return null
  const { value } = extraction
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

export function extractProfileIdValue(
  selector: ProfileIdSelector,
  ctx: RequestContext,
): string | number | null {
  if (selector.source !== 'bearer') return extractScalar(selector, ctx)

  const authorization = headerValue(ctx.headers, 'authorization')
  const match = authorization?.trim().match(BEARER_TOKEN_RE)
  const token = match?.[1]
  if (!token) return null
  if (!selector.claim) return token

  return extractJwtClaim(token, selector.claim)
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return null
}

// JWT claims are decoded only to select a mock profile. This is deliberately
// not authentication: signatures, issuer, audience, and expiry are not verified.
function extractJwtClaim(token: string, claim: string): string | number | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[1].length === 0) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
    const value = (payload as Record<string, unknown>)[claim]
    return typeof value === 'string' || typeof value === 'number' ? value : null
  } catch {
    return null
  }
}
