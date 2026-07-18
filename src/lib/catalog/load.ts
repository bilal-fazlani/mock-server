import fs from 'node:fs'
import path from 'node:path'
import { loadFunctions } from '../mock-engine/functions-load'
import { type ParsedSpec, SpecError, findSpecFile, parseSpec, resolveEndpointSchema } from './spec'
import type { Catalog, EndpointDef, ScenarioMeta, SystemDef } from './types'

const SYSTEM_META = '_system.json'
const ENDPOINT_META = '_endpoint.json'
const SCHEMA_META = '_schema.json'
const SPEC_FILE = /^_spec\.(ya?ml|json)$/
const SCENARIO_FILE = /^([a-z0-9][a-z0-9_-]*)\.(json|ts)$/

export class CatalogLoadError extends Error {}

// Walks catalog/<system>/<endpoint>/<scenario>.json. Structural problems
// (missing metadata, stray entries, bad scenario names) are fatal and
// aggregated into one CatalogLoadError; fixture *content* problems are
// left to validateCatalog so they land in the startup error list.
export function loadCatalog(catalogDir: string): Catalog {
  if (!fs.existsSync(catalogDir)) {
    throw new CatalogLoadError(`catalog directory not found: ${catalogDir}`)
  }
  const problems: string[] = []
  const systems: SystemDef[] = []
  const warnings: string[] = []

  for (const sysEntry of sortedEntries(catalogDir)) {
    if (!sysEntry.isDirectory()) {
      problems.push(`unexpected entry in catalog root (systems are directories): ${sysEntry.name}`)
      continue
    }
    const slug = sysEntry.name
    const systemDir = path.join(catalogDir, slug)
    const sysMeta = readMetaFile(path.join(systemDir, SYSTEM_META), problems)
    if (!sysMeta) continue

    let spec: ParsedSpec | null = null
    try {
      const specFile = findSpecFile(systemDir)
      if (specFile) {
        spec = parseSpec(fs.readFileSync(specFile, 'utf8'), `${slug}/${path.basename(specFile)}`)
      }
    } catch (err) {
      if (err instanceof SpecError) problems.push(`${slug}: ${err.message}`)
      else throw err
    }

    const endpoints: EndpointDef[] = []
    for (const epEntry of sortedEntries(systemDir)) {
      if (epEntry.name === SYSTEM_META) continue
      if (epEntry.isFile() && SPEC_FILE.test(epEntry.name)) continue
      if (!epEntry.isDirectory()) {
        problems.push(`${slug}: unexpected entry (endpoints are directories): ${epEntry.name}`)
        continue
      }
      const endpointName = epEntry.name
      const endpointDir = path.join(systemDir, endpointName)
      const epMeta = readMetaFile(path.join(endpointDir, ENDPOINT_META), problems)
      if (!epMeta) continue

      const label = `${slug}/${endpointName}`
      const displayName = requireString(epMeta, 'displayName', label, problems)
      const method = requireString(epMeta, 'method', label, problems)
      const endpointPath = requireString(epMeta, 'path', label, problems)

      const schemaFile = path.join(endpointDir, SCHEMA_META)
      const hasSchemaFile = fs.existsSync(schemaFile)
      let schemaMeta: Record<string, unknown> | null = null
      if (spec) {
        if (hasSchemaFile) {
          problems.push(`${label}: _schema.json is not allowed when the system has a _spec file`)
        }
        if (method && endpointPath) {
          try {
            const resolved = resolveEndpointSchema(spec, method, endpointPath, label)
            if (resolved) schemaMeta = resolved
            else {
              warnings.push(
                `${label}: no operation for ${method.toUpperCase()} ${endpointPath} in the system spec — no schema applied`,
              )
            }
          } catch (err) {
            if (err instanceof SpecError) problems.push(err.message)
            else throw err
          }
        }
      } else if (hasSchemaFile) {
        schemaMeta = readMetaFile(schemaFile, problems)
      }

      const scenarios: Record<string, ScenarioMeta> = {}
      const fixtureSlugs = new Set<string>()
      const resolverSlugs = new Set<string>()
      for (const fixEntry of sortedEntries(endpointDir)) {
        if (fixEntry.name === ENDPOINT_META || fixEntry.name === SCHEMA_META) continue
        const match = fixEntry.isFile() ? SCENARIO_FILE.exec(fixEntry.name) : null
        if (!match) {
          problems.push(
            `${slug}/${endpointName}: unexpected entry (scenarios are <name>.json fixtures or ` +
              `<name>.ts resolvers, name matching [a-z0-9][a-z0-9_-]*): ${fixEntry.name}`,
          )
          continue
        }
        const [, scenario, ext] = match
        if (ext === 'ts') {
          resolverSlugs.add(scenario)
          // Label = slug for now; getRuntime patches in the compiled resolver's
          // `description` and `summary` exports after compilation.
          scenarios[scenario] ??= { label: scenario }
        } else {
          fixtureSlugs.add(scenario)
          const meta = parseScenarioFile(path.join(endpointDir, fixEntry.name))
          scenarios[scenario] = {
            label: meta.description ?? scenario,
            ...(meta.summary ? { summary: meta.summary } : {}),
          }
        }
      }
      for (const scenario of resolverSlugs) {
        if (fixtureSlugs.has(scenario)) {
          problems.push(
            `${slug}/${endpointName}: scenario "${scenario}" is backed by both ` +
              `${scenario}.json and ${scenario}.ts — pick one`,
          )
        }
      }

      endpoints.push({
        name: endpointName,
        displayName,
        method,
        path: endpointPath,
        ...optionalMockType(epMeta, label, problems),
        ...optionalProfileIdSelector(epMeta),
        ...optionalCaptureProfileKeys(epMeta, label, problems),
        scenarios: orderDefaultFirst(scenarios),
        resolverScenarios: [...resolverSlugs].sort(),
        ...(schemaMeta ? { schema: schemaMeta } : {}),
      })
    }

    systems.push({
      name: requireString(sysMeta, 'name', slug, problems),
      slug,
      baseUrlEnv: requireString(sysMeta, 'baseUrlEnv', slug, problems),
      endpoints,
    })
  }

  const fns = loadFunctions(catalogDir)
  problems.push(...fns.problems)

  if (problems.length > 0) {
    throw new CatalogLoadError(`invalid catalog structure:\n - ${problems.join('\n - ')}`)
  }
  return { systems, warnings, resolveFunctions: fns.resolveTable }
}

function optionalMockType(
  meta: Record<string, unknown>,
  label: string,
  problems: string[],
): Pick<EndpointDef, 'mockType'> | Record<string, never> {
  const value = meta.mockType
  if (value === undefined) return {}
  if (value === 'global' || value === 'profiled') return { mockType: value }
  problems.push(`${label}: "mockType" must be either "global" or "profiled"`)
  return {}
}

function optionalProfileIdSelector(
  meta: Record<string, unknown>,
): Pick<EndpointDef, 'profileIdSelector'> | Record<string, never> {
  const value = meta.profileIdSelector
  return typeof value === 'string' && value.length > 0 ? { profileIdSelector: value } : {}
}

function sortedEntries(dir: string): fs.Dirent[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function readMetaFile(file: string, problems: string[]): Record<string, unknown> | null {
  if (!fs.existsSync(file)) {
    problems.push(`missing metadata file: ${file}`)
    return null
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    problems.push(`metadata file must be a JSON object: ${file}`)
  } catch {
    problems.push(`metadata file is not valid JSON: ${file}`)
  }
  return null
}

function requireString(
  meta: Record<string, unknown>,
  field: string,
  label: string,
  problems: string[],
): string {
  const value = meta[field]
  if (typeof value === 'string' && value.length > 0) return value
  problems.push(`${label}: missing or invalid "${field}"`)
  return ''
}

function optionalCaptureProfileKeys(
  meta: Record<string, unknown>,
  label: string,
  problems: string[],
): Pick<EndpointDef, 'captureProfileKeys'> | Record<string, never> {
  const value = meta.captureProfileKeys
  if (value === undefined) return {}
  if (!Array.isArray(value)) {
    problems.push(`${label}: "captureProfileKeys" must be an array`)
    return {}
  }
  const captureProfileKeys: EndpointDef['captureProfileKeys'] = []
  for (const [index, item] of value.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      problems.push(`${label}: captureProfileKeys[${index}] must be an object`)
      continue
    }
    const capture = item as Record<string, unknown>
    const namespace = capture.namespace
    const keySelector = capture.keySelector
    if (typeof namespace !== 'string' || namespace.length === 0) {
      problems.push(`${label}: captureProfileKeys[${index}].namespace must be a non-empty string`)
    }
    if (typeof keySelector !== 'string' || keySelector.length === 0) {
      problems.push(`${label}: captureProfileKeys[${index}].keySelector must be a non-empty string`)
    }
    if (typeof namespace === 'string' && namespace.length > 0 && typeof keySelector === 'string' && keySelector.length > 0) {
      captureProfileKeys.push({ namespace, keySelector })
    }
  }
  return { captureProfileKeys }
}

// Lenient by design: an unreadable fixture falls back to the filename for the
// label here and gets reported properly by validateCatalog.
function parseScenarioFile(file: string): { description: string | null; summary: string | null } {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { description?: unknown; summary?: unknown }
      return {
        description: typeof obj.description === 'string' ? obj.description : null,
        summary: typeof obj.summary === 'string' && obj.summary.length > 0 ? obj.summary : null,
      }
    }
  } catch {
    // reported by validateCatalog
  }
  return { description: null, summary: null }
}

function orderDefaultFirst(
  scenarios: Record<string, ScenarioMeta>,
): Record<string, ScenarioMeta> {
  if (!('default' in scenarios)) return scenarios
  const { default: defaultMeta, ...rest } = scenarios
  return { default: defaultMeta, ...rest }
}
