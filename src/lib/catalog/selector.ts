export type DirectSelector =
  | { source: 'body'; segments: Array<string | number> }
  | { source: 'path'; name: string }
  | { source: 'query'; name: string }
  // `name` is always lower-cased at parse time, so lookup is a case-insensitive
  // match against whatever casing the caller actually sent.
  | { source: 'header'; name: string }

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
// Credential-bearing headers a fixture must never be able to echo back. The
// check is at parse time, so a blocked name fails catalog validation at startup
// rather than silently rendering nothing at request time.
const BLOCKED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
])
const PROFILE_KEY_NAMESPACE_RE = /^[a-z0-9][a-z0-9_-]*$/
const BODY_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const BODY_IDENT_AT = /[a-zA-Z_][a-zA-Z0-9_]*/y
const BODY_INDEX_AT = /(\d+)\]/y
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
  if (raw.startsWith('header:')) {
    const name = raw.slice('header:'.length).toLowerCase()
    // The RFC token charset would admit "'" and "|", which are separators in the
    // placeholder expression grammar — a header named with either could not be
    // written inside {{ }}. NAME_RE covers every realistic header name instead.
    if (!NAME_RE.test(name)) throw new SelectorParseError(`invalid header selector: ${raw}`)
    if (BLOCKED_HEADERS.has(name)) {
      throw new SelectorParseError(
        `header selector "${raw}" reads a credential header and is not allowed`,
      )
    }
    return { source: 'header', name }
  }
  if (raw.startsWith('$')) {
    return { source: 'body', segments: parseBodyPath(raw) }
  }
  throw new SelectorParseError(
    `selector must start with "$", "path:", "query:", or "header:": ${raw}`,
  )
}

// Segments: `.ident`, `[n]`, and quoted keys `['k']` / `["k"]`. A quoted key
// is taken verbatim up to the matching quote — there is no escaping — so a key
// containing one quote kind is written with the other.
function parseBodyPath(raw: string): Array<string | number> {
  const fail = (reason?: string) =>
    new SelectorParseError(`invalid body selector: ${raw}${reason ? ` (${reason})` : ''}`)
  const segments: Array<string | number> = []
  let i = 1
  while (i < raw.length) {
    if (raw[i] === '.') {
      BODY_IDENT_AT.lastIndex = i + 1
      const m = BODY_IDENT_AT.exec(raw)
      if (!m) throw fail()
      segments.push(m[0])
      i = BODY_IDENT_AT.lastIndex
    } else if (raw[i] === '[') {
      const quote = raw[i + 1]
      if (quote === "'" || quote === '"') {
        const close = raw.indexOf(quote, i + 2)
        if (close === -1) throw fail('unterminated quoted key')
        const key = raw.slice(i + 2, close)
        if (key.length === 0) throw fail('empty quoted key')
        if (raw[close + 1] !== ']') throw fail('expected "]" after quoted key')
        segments.push(key)
        i = close + 2
      } else {
        BODY_INDEX_AT.lastIndex = i + 1
        const m = BODY_INDEX_AT.exec(raw)
        if (!m) throw fail('expected an index or a quoted key after "["')
        segments.push(Number(m[1]))
        i = BODY_INDEX_AT.lastIndex
      }
    } else {
      throw fail()
    }
  }
  if (segments.length === 0) throw fail()
  return segments
}

// The inverse of parseBodyPath, for messages: ['a', 'b-c', 0] → "$.a['b-c'][0]".
export function formatBodyPath(segments: Array<string | number>): string {
  return segments.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`
    if (BODY_IDENT_RE.test(seg)) return `${acc}.${seg}`
    return seg.includes("'") ? `${acc}["${seg}"]` : `${acc}['${seg}']`
  }, '$')
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
  if (selector.source === 'header') {
    const v = headerValue(ctx.headers, selector.name)
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
