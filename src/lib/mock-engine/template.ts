import {
  extractValue,
  parseSelector,
  RequestContext,
  SelectorParseError,
} from '../catalog/selector'

export class PlaceholderError extends Error {}

const PLACEHOLDER_RE = /\{\{(.+?)\}\}/g

function resolvePlaceholder(expr: string, ctx: RequestContext, now: Date): string {
  if (expr === 'now:iso') return now.toISOString()
  if (expr === 'now:YYYYMMDD') return now.toISOString().slice(0, 10).replace(/-/g, '')
  if (expr.startsWith('now:')) {
    throw new PlaceholderError(`unknown now formatter in "{{${expr}}}" (use now:iso or now:YYYYMMDD)`)
  }
  let selector: ReturnType<typeof parseSelector>
  try {
    selector = parseSelector(expr)
  } catch (err) {
    if (err instanceof SelectorParseError) {
      throw new PlaceholderError(`invalid placeholder "{{${expr}}}": ${err.message}`)
    }
    throw err
  }
  const value = extractValue(selector, ctx)
  if (value === null) {
    throw new PlaceholderError(`placeholder "{{${expr}}}" did not resolve against the request`)
  }
  return String(value)
}

export function resolveTemplate(
  node: unknown,
  ctx: RequestContext,
  now: Date,
  resolutions?: Record<string, string>,
): unknown {
  if (typeof node === 'string') {
    return node.replace(PLACEHOLDER_RE, (_, expr: string) => {
      const value = resolvePlaceholder(expr, ctx, now)
      if (resolutions) resolutions[`{{${expr}}}`] = value
      return value
    })
  }
  if (Array.isArray(node)) {
    return node.map((item) => resolveTemplate(item, ctx, now, resolutions))
  }
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, resolveTemplate(v, ctx, now, resolutions)]),
    )
  }
  return node
}

export function listPlaceholders(node: unknown): string[] {
  const found: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      for (const m of n.matchAll(PLACEHOLDER_RE)) found.push(m[1])
    } else if (Array.isArray(n)) {
      n.forEach(walk)
    } else if (n !== null && typeof n === 'object') {
      Object.values(n).forEach(walk)
    }
  }
  walk(node)
  return found
}
