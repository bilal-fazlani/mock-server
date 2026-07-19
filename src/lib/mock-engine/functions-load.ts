import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compileFunctions, CompiledFn } from './functions'
import { RESERVED_NAMES } from './evaluate'

export interface LoadedFunctions {
  problems: string[]
  // Readonly because the merged table is memoized and handed to every caller —
  // a mutation would leak into every later render of that endpoint.
  resolveTable(systemSlug: string, endpointName: string): ReadonlyMap<string, CompiledFn>
}

type Level = Map<string, CompiledFn>

export function loadFunctions(catalogDir: string): LoadedFunctions {
  const problems: string[] = []
  const compileAt = (dir: string, label: string): Level => {
    const ts = join(dir, '_functions.ts')
    const mjs = join(dir, '_functions.mjs')
    const hasTs = existsSync(ts)
    const hasMjs = existsSync(mjs)
    if (!hasTs && !hasMjs) return new Map()
    // Fatal like every other entry in `problems`, so it must not read as a
    // recovery ("using .ts") — the catalog does not load until one is removed.
    if (hasTs && hasMjs) problems.push(`${label}: both _functions.ts and _functions.mjs present; keep only one`)
    const file = hasTs ? ts : mjs
    const loader = hasTs ? 'ts' : 'js'
    let compiled: Map<string, CompiledFn>
    try {
      compiled = compileFunctions(readFileSync(file, 'utf8'), `${label}/_functions.${hasTs ? 'ts' : 'mjs'}`, loader)
    } catch (err) {
      // compileFunctions already prefixes its messages with the file label.
      problems.push((err as Error).message)
      return new Map()
    }
    for (const name of [...compiled.keys()]) {
      if (RESERVED_NAMES.has(name)) {
        problems.push(`${label}: "${name}" is a reserved name and cannot be used for a function`)
        compiled.delete(name)
      }
    }
    return compiled
  }

  const catalogLevel = compileAt(catalogDir, '<catalog>')
  const systemLevels = new Map<string, Level>()
  const endpointLevels = new Map<string, Level>() // key `${system}/${endpoint}`

  for (const sys of dirsOf(catalogDir)) {
    systemLevels.set(sys, compileAt(join(catalogDir, sys), sys))
    for (const ep of dirsOf(join(catalogDir, sys))) {
      endpointLevels.set(`${sys}/${ep}`, compileAt(join(catalogDir, sys, ep), `${sys}/${ep}`))
    }
  }

  // Levels are immutable once loaded, so the merged table for a given endpoint
  // is too — compute it once instead of on every fixture render.
  const tableCache = new Map<string, Map<string, CompiledFn>>()

  return {
    problems,
    resolveTable(systemSlug, endpointName) {
      const key = `${systemSlug}/${endpointName}`
      const cached = tableCache.get(key)
      if (cached) return cached
      const merged = new Map(catalogLevel)
      for (const [k, v] of systemLevels.get(systemSlug) ?? []) merged.set(k, v)
      for (const [k, v] of endpointLevels.get(key) ?? []) merged.set(k, v)
      tableCache.set(key, merged)
      return merged
    },
  }
}

function dirsOf(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}
