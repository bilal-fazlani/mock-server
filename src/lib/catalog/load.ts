import type { Dirent } from 'node:fs'
import path from 'node:path'
import { catalogPath, exists, listDir, readText } from './files'
import { loadFunctions } from '../mock-engine/functions-load'
import { type ParsedSpec, SpecError, findSpecFile, parseSpec, resolveEndpointSchema } from './spec'
import type { Catalog, EndpointDef, ScenarioMeta, SystemDef } from './types'

const SYSTEM_META = '_system.json'
const ENDPOINT_META = '_endpoint.json'
const SCHEMA_META = '_schema.json'
const SPEC_FILE = /^_spec\.(ya?ml|json)$/
// `.ts` still matches so a pre-#26 catalog gets a targeted migration error
// below instead of the generic "unexpected entry" complaint.
const SCENARIO_FILE = /^([a-z0-9][a-z0-9_-]*)\.(json|mjs|ts)$/
// User function files (loaded separately by loadFunctions at every scope) are
// not systems, endpoints, or scenarios — skip them in the structural scans below.
// `.ts` still matches only so the entry is skipped here rather than flagged as
// "unexpected" — loadFunctions owns the loud `_functions.ts` migration error.
const FUNCTIONS_FILE = /^_functions\.(ts|mjs)$/

export class CatalogLoadError extends Error {}

// Walks catalog/<system>/<endpoint>/<scenario>.json. Structural problems
// (missing metadata, stray entries, bad scenario names) are fatal and
// aggregated into one CatalogLoadError; fixture *content* problems are
// left to validateCatalog so they land in the startup error list.
export function loadCatalog(catalogDir: string): Catalog {
  if (!exists(catalogDir)) {
    throw new CatalogLoadError(
      `catalog directory not found: ${catalogDir}\n` +
        'Pass the catalog directory as an argument, set CATALOG_PATH, ' +
        'or in Docker mount one at /app/catalog (-v "$(pwd)/catalog:/app/catalog:ro").',
    )
  }
  const problems: string[] = []
  const systems: SystemDef[] = []
  const warnings: string[] = []

  for (const sysEntry of sortedEntries(catalogDir)) {
    if (sysEntry.isFile() && FUNCTIONS_FILE.test(sysEntry.name)) continue
    if (!sysEntry.isDirectory()) {
      problems.push(`unexpected entry in catalog root (systems are directories): ${sysEntry.name}`)
      continue
    }
    const slug = sysEntry.name
    const systemDir = catalogPath(catalogDir, slug)
    const sysMeta = readMetaFile(catalogPath(systemDir, SYSTEM_META), problems)
    if (!sysMeta) continue

    let spec: ParsedSpec | null = null
    try {
      const specFile = findSpecFile(systemDir)
      if (specFile) {
        spec = parseSpec(readText(specFile), `${slug}/${path.basename(specFile)}`)
      }
    } catch (err) {
      if (err instanceof SpecError) problems.push(`${slug}: ${err.message}`)
      else throw err
    }

    const endpoints: EndpointDef[] = []
    for (const epEntry of sortedEntries(systemDir)) {
      if (epEntry.name === SYSTEM_META) continue
      if (epEntry.isFile() && SPEC_FILE.test(epEntry.name)) continue
      if (epEntry.isFile() && FUNCTIONS_FILE.test(epEntry.name)) continue
      if (!epEntry.isDirectory()) {
        problems.push(`${slug}: unexpected entry (endpoints are directories): ${epEntry.name}`)
        continue
      }
      const endpointSlug = epEntry.name
      const endpointDir = catalogPath(systemDir, endpointSlug)
      const epMeta = readMetaFile(catalogPath(endpointDir, ENDPOINT_META), problems)
      if (!epMeta) continue

      const label = `${slug}/${endpointSlug}`
      const displayName = requireString(epMeta, 'displayName', label, problems)
      const method = requireString(epMeta, 'method', label, problems)
      const endpointPath = requireString(epMeta, 'path', label, problems)

      const schemaFile = catalogPath(endpointDir, SCHEMA_META)
      const hasSchemaFile = exists(schemaFile)
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
        if (fixEntry.isFile() && FUNCTIONS_FILE.test(fixEntry.name)) continue
        const match = fixEntry.isFile() ? SCENARIO_FILE.exec(fixEntry.name) : null
        if (!match) {
          problems.push(
            `${slug}/${endpointSlug}: unexpected entry (scenarios are <name>.json fixtures or ` +
              `<name>.mjs resolvers, name matching [a-z0-9][a-z0-9_-]*): ${fixEntry.name}`,
          )
          continue
        }
        const [, scenario, ext] = match
        if (ext === 'ts') {
          // Dropped in #26. Loud, not skipped: a silently ignored resolver file
          // would make its scenario vanish from the endpoint with no pointer to why.
          problems.push(
            `${slug}/${endpointSlug}: ${scenario}.ts resolvers are no longer supported; ` +
              `rename to ${scenario}.mjs and remove type annotations`,
          )
        } else if (ext === 'mjs') {
          resolverSlugs.add(scenario)
          // Label = slug for now; getRuntime patches in the compiled resolver's
          // `displayName` and `summary` exports after compilation.
          scenarios[scenario] ??= { displayName: scenario }
        } else {
          fixtureSlugs.add(scenario)
          const meta = parseScenarioFile(catalogPath(endpointDir, fixEntry.name))
          if (meta.legacyDescription) {
            problems.push(
              `${slug}/${endpointSlug}: ${fixEntry.name} uses "description"; rename it to "displayName"`,
            )
          }
          scenarios[scenario] = {
            displayName: meta.displayName ?? scenario,
            ...(meta.summary ? { summary: meta.summary } : {}),
            ...(meta.status !== null ? { status: meta.status } : {}),
          }
        }
      }
      for (const scenario of resolverSlugs) {
        if (fixtureSlugs.has(scenario)) {
          problems.push(
            `${slug}/${endpointSlug}: scenario "${scenario}" is backed by both ` +
              `${scenario}.json and ${scenario}.mjs — pick one`,
          )
        }
      }

      endpoints.push({
        slug: endpointSlug,
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

    if ('name' in sysMeta) {
      problems.push(`${slug}: ${SYSTEM_META} uses "name"; rename it to "displayName"`)
    }
    systems.push({
      displayName: requireString(sysMeta, 'displayName', slug, problems),
      slug,
      baseUrlEnv: requireString(sysMeta, 'baseUrlEnv', slug, problems),
      ...optionalClientIdentity(sysMeta, slug, problems),
      endpoints,
    })
  }

  const fns = loadFunctions(catalogDir)
  problems.push(...fns.problems)

  if (problems.length > 0) {
    throw new CatalogLoadError(`invalid catalog structure:\n - ${problems.join('\n - ')}`)
  }
  if (systems.length === 0) {
    throw new CatalogLoadError(
      `catalog directory ${catalogDir} contains no systems — if it is a Docker mount, check the host path exists`,
    )
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

function sortedEntries(dir: string): Dirent[] {
  return listDir(dir)
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function readMetaFile(file: string, problems: string[]): Record<string, unknown> | null {
  if (!exists(file)) {
    problems.push(`missing metadata file: ${file}`)
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readText(file))
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

function optionalClientIdentity(
  meta: Record<string, unknown>,
  label: string,
  problems: string[],
): Pick<SystemDef, 'clientCertEnv' | 'clientKeyEnv'> {
  const hasCert = meta.clientCertEnv !== undefined
  const hasKey = meta.clientKeyEnv !== undefined
  if (!hasCert && !hasKey) return {}
  if (hasCert !== hasKey) {
    problems.push(`${label}: "clientCertEnv" and "clientKeyEnv" must be set together`)
    return {}
  }
  return {
    clientCertEnv: requireString(meta, 'clientCertEnv', label, problems),
    clientKeyEnv: requireString(meta, 'clientKeyEnv', label, problems),
  }
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
function parseScenarioFile(file: string): {
  displayName: string | null
  legacyDescription: boolean
  summary: string | null
  status: number | null
} {
  try {
    const parsed: unknown = JSON.parse(readText(file))
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as {
        displayName?: unknown
        description?: unknown
        summary?: unknown
        status?: unknown
      }
      return {
        displayName: typeof obj.displayName === 'string' ? obj.displayName : null,
        legacyDescription: 'description' in obj,
        summary: typeof obj.summary === 'string' && obj.summary.length > 0 ? obj.summary : null,
        status: typeof obj.status === 'number' ? obj.status : null,
      }
    }
  } catch {
    // reported by validateCatalog
  }
  return { displayName: null, legacyDescription: false, summary: null, status: null }
}

function orderDefaultFirst(
  scenarios: Record<string, ScenarioMeta>,
): Record<string, ScenarioMeta> {
  if (!('default' in scenarios)) return scenarios
  const { default: defaultMeta, ...rest } = scenarios
  return { default: defaultMeta, ...rest }
}
