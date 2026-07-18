import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { compileFunctions, CompiledFn } from './functions'
import { RESERVED_NAMES } from './evaluate'

export interface LoadedFunctions {
  problems: string[]
  resolveTable(systemSlug: string, endpointName: string): Map<string, CompiledFn>
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
    if (hasTs && hasMjs) problems.push(`${label}: both _functions.ts and _functions.mjs present; using .ts`)
    const file = hasTs ? ts : mjs
    const loader = hasTs ? 'ts' : 'js'
    let compiled: Map<string, CompiledFn>
    try {
      compiled = compileFunctions(readFileSync(file, 'utf8'), `${label}/_functions.${hasTs ? 'ts' : 'mjs'}`, loader)
    } catch (err) {
      problems.push(`${label}: ${(err as Error).message}`)
      return new Map()
    }
    for (const name of [...compiled.keys()]) {
      if (RESERVED_NAMES.has(name)) {
        problems.push(`${label}: reserved name "${name}" is ignored`)
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

  return {
    problems,
    resolveTable(systemSlug, endpointName) {
      const merged = new Map(catalogLevel)
      for (const [k, v] of systemLevels.get(systemSlug) ?? []) merged.set(k, v)
      for (const [k, v] of endpointLevels.get(`${systemSlug}/${endpointName}`) ?? []) merged.set(k, v)
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
