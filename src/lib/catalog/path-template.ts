export type PathSegment =
  | { type: 'literal'; value: string }
  | { type: 'param'; name: string }

export interface PathTemplate {
  raw: string
  segments: PathSegment[]
}

export class PathTemplateError extends Error {}

const PARAM_RE = /^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/

export function parsePathTemplate(raw: string): PathTemplate {
  if (!raw.startsWith('/')) {
    throw new PathTemplateError(`path template must start with "/": ${raw}`)
  }
  const segments: PathSegment[] = raw
    .slice(1)
    .split('/')
    .map((part) => {
      const m = PARAM_RE.exec(part)
      if (m) return { type: 'param' as const, name: m[1] }
      if (part === '') throw new PathTemplateError(`empty segment in template: ${raw}`)
      if (part.includes('{') || part.includes('}')) {
        throw new PathTemplateError(`invalid segment "${part}" in template: ${raw}`)
      }
      return { type: 'literal' as const, value: part }
    })
  return { raw, segments }
}

export function matchPath(
  template: PathTemplate,
  requestPath: string,
): Record<string, string> | null {
  const parts = requestPath.split('/').filter((p) => p !== '')
  if (parts.length !== template.segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < parts.length; i++) {
    const seg = template.segments[i]
    if (seg.type === 'literal') {
      if (seg.value !== parts[i]) return null
    } else {
      params[seg.name] = decodeURIComponent(parts[i])
    }
  }
  return params
}

export function templatesOverlap(a: PathTemplate, b: PathTemplate): boolean {
  if (a.segments.length !== b.segments.length) return false
  return a.segments.every((seg, i) => {
    const other = b.segments[i]
    if (seg.type === 'literal' && other.type === 'literal') {
      return seg.value === other.value
    }
    return true // a param position overlaps anything
  })
}
