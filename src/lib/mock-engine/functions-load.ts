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
    // `.ts` authoring was dropped (#26) — probing for it only to fail loudly,
    // because a silently ignored `_functions.ts` would make its functions
    // vanish with nothing but confusing downstream placeholder errors.
    if (existsSync(join(dir, '_functions.ts'))) {
      problems.push(`${label}: _functions.ts is no longer supported; rename to _functions.mjs and remove type annotations`)
      return new Map()
    }
    const mjs = join(dir, '_functions.mjs')
    if (!existsSync(mjs)) return new Map()
    let compiled: Map<string, CompiledFn>
    try {
      compiled = compileFunctions(readFileSync(mjs, 'utf8'), `${label}/_functions.mjs`)
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
