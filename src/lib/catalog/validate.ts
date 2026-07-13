import fs from 'node:fs'
import { fixtureFilePath, type Fixture } from '../mock-engine/fixtures'
import { listPlaceholders } from '../mock-engine/template'
import {
  parsePathTemplate,
  PathTemplate,
  PathTemplateError,
  templatesOverlap,
} from './path-template'
import {
  parseProfileIdSelector,
  parseSelector,
  SelectorParseError,
  type DirectSelector,
  type ProfileIdSelector,
} from './selector'
import { buildSchemaRegistry, schemaKey, type SchemaRegistry } from './schema'
import type { Catalog } from './types'

const DEFAULT_SCENARIO = 'default'
const REAL_SCENARIO = 'real'
const PROFILE_KEY_NAMESPACE_RE = /^[a-z0-9][a-z0-9_-]*$/

export interface ValidationResult {
  errors: string[]
  fixtures: Map<string, Fixture>
  schemas: SchemaRegistry
}

export function validateCatalog(catalog: Catalog, catalogDir: string): ValidationResult {
  const errors: string[] = []
  const fixtures = new Map<string, Fixture>()
  const { schemas, errors: schemaErrors } = buildSchemaRegistry(catalog)
  errors.push(...schemaErrors)
  const parsed: Array<{ method: string; template: PathTemplate; label: string }> = []

  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      const label = `${system.name}/${endpoint.name}`

      let template: PathTemplate | null = null
      try {
        template = parsePathTemplate(endpoint.path)
        parsed.push({ method: endpoint.method.toUpperCase(), template, label })
      } catch (err) {
        if (err instanceof PathTemplateError) errors.push(`${label}: ${err.message}`)
        else throw err
      }
      const declaredParams = new Set(
        template?.segments.flatMap((s) => (s.type === 'param' ? [s.name] : [])) ?? [],
      )
      const mockType = endpoint.mockType ?? 'profiled'

      if (mockType === 'global') {
        if (endpoint.profileIdSelector !== undefined) {
          errors.push(`${label}: global endpoint must not declare profileIdSelector`)
        }
        if ((endpoint.captureProfileKeys ?? []).length > 0) {
          errors.push(`${label}: global endpoint must not declare captureProfileKeys`)
        }
      } else {
        if (!endpoint.profileIdSelector) {
          errors.push(`${label}: profiled endpoint requires profileIdSelector`)
        } else {
          try {
            const selector = parseProfileIdSelector(endpoint.profileIdSelector)
            validateSelectorPath(label, 'selector', selector, declaredParams, errors)
            if (selector.source === 'profileKey') {
              validateNamespace(label, selector.namespace, 'profileIdSelector namespace', errors)
            }
          } catch (err) {
            if (err instanceof SelectorParseError) errors.push(`${label}: ${err.message}`)
            else throw err
          }
        }

        const captures = endpoint.captureProfileKeys ?? []
        if (captures.length > 0) {
          const profileSelector = endpoint.profileIdSelector
            ? parseProfileIdSelectorForValidation(
                endpoint.profileIdSelector,
                label,
                'profileIdSelector',
                errors,
              )
            : null
          if (profileSelector?.source === 'profileKey') {
            errors.push(`${label}: captureProfileKeys require a direct profileIdSelector`)
          }
        }
        captures.forEach((capture, index) => {
          validateNamespace(label, capture.namespace, `captureProfileKeys[${index}].namespace`, errors)
          const selector = parseSelectorForValidation(
            capture.keySelector,
            label,
            `captureProfileKeys[${index}].keySelector`,
            errors,
          )
          if (!selector) return
          if (selector.source === 'profileKey') {
            errors.push(`${label}: captureProfileKeys[${index}].keySelector must be a direct selector`)
            return
          }
          validateSelectorPath(
            label,
            `captureProfileKeys[${index}].keySelector`,
            selector,
            declaredParams,
            errors,
          )
        })
      }

      if (!(DEFAULT_SCENARIO in endpoint.scenarios)) {
        errors.push(`${label}: missing required "${DEFAULT_SCENARIO}" scenario (no default.json)`)
      }
      if (REAL_SCENARIO in endpoint.scenarios) {
        errors.push(
          `${label}: scenario "${REAL_SCENARIO}" must not exist (real.json) — passthrough is implicit`,
        )
      }

      for (const scenario of Object.keys(endpoint.scenarios)) {
        if (scenario === REAL_SCENARIO) continue // already flagged above
        const file = fixtureFilePath(catalogDir, system.slug, endpoint.name, scenario)
        if (!fs.existsSync(file)) {
          errors.push(`${label}: missing fixture for scenario "${scenario}" (${file})`)
          continue
        }
        let fixture: { status?: unknown; headers?: unknown; body?: unknown }
        try {
          fixture = JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch {
          errors.push(`${label}: fixture ${file} is not valid JSON`)
          continue
        }
        if (typeof fixture.status !== 'number' || !('body' in fixture)) {
          errors.push(`${label}: fixture ${file} must have numeric "status" and a "body"`)
          continue
        }
        fixtures.set(file, fixture as Fixture)
        const compiled = schemas.get(schemaKey(system.slug, endpoint.name))
        if (compiled) {
          if (!compiled.hasResponseFor(fixture.status)) {
            errors.push(
              `${label}: fixture ${file} has status ${fixture.status} with no matching response ` +
                `schema (declare "${fixture.status}", "${Math.floor(fixture.status / 100)}XX", ` +
                `or "default" in _schema.json responses)`,
            )
          } else {
            for (const issue of compiled.validateFixtureBody(fixture.status, fixture.body)) {
              errors.push(
                `${label}: fixture ${file} body does not match _schema.json: ${issue.path} ${issue.message}`,
              )
            }
          }
        }
        const placeholders = [
          ...listPlaceholders(fixture.body),
          ...listPlaceholders(fixture.headers ?? {}),
        ]
        for (const expr of placeholders) {
          if (expr === 'now:iso' || expr === 'now:YYYYMMDD') continue
          try {
            const sel = parseSelector(expr)
            if (sel.source === 'path' && !declaredParams.has(sel.name)) {
              errors.push(
                `${label}: fixture ${file} placeholder "{{${expr}}}" references undeclared path param`,
              )
            }
          } catch {
            errors.push(`${label}: fixture ${file} has invalid placeholder "{{${expr}}}"`)
          }
        }
      }
    }
  }

  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      if (
        parsed[i].method === parsed[j].method &&
        templatesOverlap(parsed[i].template, parsed[j].template)
      ) {
        errors.push(
          `ambiguous endpoints: ${parsed[i].label} and ${parsed[j].label} can match the same ${parsed[i].method} request`,
        )
      }
    }
  }

  return { errors, fixtures, schemas }
}

function parseSelectorForValidation(
  raw: string,
  label: string,
  field: string,
  errors: string[],
) {
  try {
    return parseSelector(raw)
  } catch (err) {
    if (err instanceof SelectorParseError) {
      errors.push(`${label}: invalid ${field}: ${err.message}`)
      return null
    }
    throw err
  }
}

function parseProfileIdSelectorForValidation(
  raw: string,
  label: string,
  field: string,
  errors: string[],
): ProfileIdSelector | null {
  try {
    return parseProfileIdSelector(raw)
  } catch (err) {
    if (err instanceof SelectorParseError) {
      errors.push(`${label}: invalid ${field}: ${err.message}`)
      return null
    }
    throw err
  }
}

function validateNamespace(
  label: string,
  namespace: string,
  field: string,
  errors: string[],
): void {
  if (!PROFILE_KEY_NAMESPACE_RE.test(namespace)) {
    errors.push(`${label}: ${field} "${namespace}" must match [a-z0-9][a-z0-9_-]*`)
  }
}

function validateSelectorPath(
  label: string,
  field: string,
  selector: DirectSelector | ProfileIdSelector,
  declaredParams: Set<string>,
  errors: string[],
): void {
  if (selector.source === 'bearer') return
  const directSelector = selector.source === 'profileKey' ? selector.keySelector : selector
  if (directSelector.source === 'path' && !declaredParams.has(directSelector.name)) {
    errors.push(
      `${label}: ${field} "path:${directSelector.name}" has no matching {${directSelector.name}} in path template`,
    )
  }
}

// App-wide config that only makes sense once the catalog is known. When
// passthrough is the implicit default, every system must be able to proxy at
// startup. Otherwise missing base URLs are reported only when a request or UI
// selection actually chooses passthrough.
export function validateAppConfig(
  catalog: Catalog,
  env: Record<string, string | undefined>,
  passthroughAsDefault: boolean,
): string[] {
  const errors: string[] = []
  if (passthroughAsDefault) {
    for (const system of catalog.systems) {
      if (!env[system.baseUrlEnv]) {
        errors.push(
          `system "${system.name}": PASSTHROUGH_AS_DEFAULT=true requires ${system.baseUrlEnv} to be set`,
        )
      }
    }
  }
  return errors
}
