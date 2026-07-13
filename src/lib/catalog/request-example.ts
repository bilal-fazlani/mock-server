import {
  parseProfileIdSelector,
  parseSelector,
  type DirectSelector,
} from './selector'
import type { EndpointDef } from './types'

export interface EndpointRequestExample {
  method: string
  path: string
  search: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

/**
 * Builds a skeleton request for an endpoint from what the catalog declares:
 * path template params, the profile-ID selector, and capture key selectors.
 * Values are `<name>` placeholders for the caller to fill in.
 */
export function buildEndpointRequestExample(endpoint: EndpointDef): EndpointRequestExample {
  const selectors = collectSelectors(endpoint)
  const body: Record<string, unknown> = {}
  const query: string[] = []
  const headers: Record<string, string> = {}

  if (endpoint.profileIdSelector) {
    try {
      const profileSelector = parseProfileIdSelector(endpoint.profileIdSelector)
      if (profileSelector.source === 'bearer') {
        headers.authorization = profileSelector.claim
          ? `Bearer <JWT with ${profileSelector.claim} claim>`
          : 'Bearer <profileId>'
      }
    } catch {
      // Invalid selectors are reported by catalog validation.
    }
  }

  for (const selector of selectors) {
    if (selector.source === 'body') {
      setBodyPath(body, selector.segments)
    } else if (selector.source === 'query') {
      query.push(`${selector.name}=<${selector.name}>`)
    }
    // path selectors are covered by the path-template substitution below
  }

  return {
    method: endpoint.method.toUpperCase(),
    path: endpoint.path.replace(/\{([^}]+)\}/g, '<$1>'),
    search: query.length > 0 ? `?${query.join('&')}` : '',
    headers,
    body: Object.keys(body).length > 0 ? body : null,
  }
}

function collectSelectors(endpoint: EndpointDef): DirectSelector[] {
  const selectors: DirectSelector[] = []

  if (endpoint.profileIdSelector) {
    try {
      const parsed = parseProfileIdSelector(endpoint.profileIdSelector)
      if (parsed.source !== 'bearer') {
        selectors.push(parsed.source === 'profileKey' ? parsed.keySelector : parsed)
      }
    } catch {
      // Invalid selectors are reported by catalog validation.
    }
  }

  for (const capture of endpoint.captureProfileKeys ?? []) {
    let parsed
    try {
      parsed = parseSelector(capture.keySelector)
    } catch {
      continue
    }
    selectors.push(parsed.source === 'profileKey' ? parsed.keySelector : parsed)
  }
  return selectors
}

function setBodyPath(target: Record<string, unknown>, segments: Array<string | number>): void {
  let current = target
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = String(segments[i])
    const next = current[segment]
    if (next === null || typeof next !== 'object') {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  const leaf = segments[segments.length - 1]
  current[String(leaf)] = `<${String(leaf)}>`
}
