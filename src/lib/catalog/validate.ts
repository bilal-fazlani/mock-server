import fs from 'node:fs'
import { DurationError, parseDelayMs } from '../mock-engine/duration'
import { builtinArity, CALLABLE_BUILTINS } from '../mock-engine/evaluate'
import { callNodes, parseExpr, ExprParseError, type Expr } from '../mock-engine/expr'
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
      const fnTable = new Set(catalog.resolveFunctions?.(system.slug, endpoint.name).keys() ?? [])
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
        errors.push(
          `${label}: missing required "${DEFAULT_SCENARIO}" scenario ` +
            `(no default.json or default.mjs)`,
        )
      }
      if (REAL_SCENARIO in endpoint.scenarios) {
        errors.push(
          `${label}: scenario "${REAL_SCENARIO}" must not exist (real.json or real.mjs) — ` +
            `passthrough is implicit`,
        )
      }
      const fixtureBacked = Object.keys(endpoint.scenarios).filter(
        (s) => !endpoint.resolverScenarios.includes(s),
      )
      if (Object.keys(endpoint.scenarios).length > 0 && fixtureBacked.length === 0) {
        errors.push(
          `${label}: every scenario is resolver-backed (.mjs) — declare at least one ` +
            `fixture-backed scenario for resolvers to return`,
        )
      }

      for (const scenario of Object.keys(endpoint.scenarios)) {
        if (scenario === REAL_SCENARIO) continue // already flagged above
        if (endpoint.resolverScenarios.includes(scenario)) continue // backed by <slug>.mjs, not a fixture
        const file = fixtureFilePath(catalogDir, system.slug, endpoint.name, scenario)
        if (!fs.existsSync(file)) {
          errors.push(`${label}: missing fixture for scenario "${scenario}" (${file})`)
          continue
        }
        let fixture: { status?: unknown; headers?: unknown; body?: unknown; delay?: unknown }
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
        if ('delay' in fixture && fixture.delay !== undefined) {
          if (typeof fixture.delay !== 'string') {
            errors.push(`${label}: fixture ${file} "delay" must be a string like "400ms", "2s", or "1m"`)
            continue
          }
          try {
            parseDelayMs(fixture.delay)
          } catch (err) {
            if (err instanceof DurationError) {
              errors.push(`${label}: fixture ${file} has ${err.message}`)
              continue
            }
            throw err
          }
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
          let ast: Expr
          try {
            ast = parseExpr(expr)
          } catch (err) {
            if (err instanceof ExprParseError) {
              errors.push(`${label}: fixture ${file} has invalid placeholder "{{${expr}}}"`)
              continue
            }
            throw err
          }
          for (const call of callNodes(ast)) {
            if (!CALLABLE_BUILTINS.has(call.name) && !fnTable.has(call.name)) {
              errors.push(
                `${label}: fixture ${file} placeholder "{{${expr}}}" calls unknown function "${call.name}"`,
              )
              continue
            }
            // Built-ins declare a fixed argument count (the piped value counts
            // as the first one), so "{{$.x | default}}" is a startup error
            // rather than a 500 on the first request that hits the fixture.
            // Custom functions are plain JS and take whatever they take.
            const arity = builtinArity(call.name)
            if (arity !== undefined && call.args.length !== arity) {
              errors.push(
                `${label}: fixture ${file} placeholder "{{${expr}}}" calls built-in "${call.name}" ` +
                  `with ${call.args.length} argument(s), expected ${arity}`,
              )
            }
          }
          // `default`/`omit` anywhere in the chain absorbs a missing value, so a
          // selector in such a placeholder can't 500 on absence — skip the whole
          // expr for the optional-field lint below.
          const hasFallback = callNodes(ast).some((c) => c.name === 'default' || c.name === 'omit')
          for (const sel of selectorNodes(ast)) {
            if (sel.selector.source === 'path' && !declaredParams.has(sel.selector.name)) {
              errors.push(
                `${label}: fixture ${file} placeholder "{{${expr}}}" references undeclared path param`,
              )
            }
            // A body selector over a field the request schema lets a caller omit,
            // with no fallback, will 500 on exactly those requests — the schema
            // says optional, the fixture makes it de-facto required. Detectable
            // ahead of time, so it is a startup error rather than a runtime 500
            // (#27). Only a *provably* optional field is flagged; anything the
            // presence walk can't decide is left alone.
            if (
              !hasFallback &&
              compiled &&
              sel.selector.source === 'body' &&
              compiled.guaranteesPresence(sel.selector.segments) === false
            ) {
              const path = bodyPath(sel.selector.segments)
              errors.push(
                `${label}: fixture ${file} placeholder "{{${expr}}}" reads request body field ` +
                  `${path}, which the request schema lets callers omit; a request without it ` +
                  `returns 500. Add a fallback ("{{${path} | omit}}" or "{{${path} | default:…}}"), ` +
                  `or add the field to the schema's "required".`,
              )
            }
          }
        }
        // `omit` drops the field it is the value of, so it is only meaningful as
        // the whole value of an object property or header. A misuse is a *static*
        // property of the fixture but would only 500 at runtime on the request
        // that actually omits the field, so it is caught here at startup (#24).
        const reportOmit = (msg: string): void => {
          errors.push(`${label}: fixture ${file} ${msg}`)
        }
        checkOmitPositions(fixture.body, 'root', reportOmit)
        checkOmitPositions(fixture.headers ?? {}, 'root', reportOmit)
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

// Render a body selector's segments back as its `$.…` source form for messages:
// ['a', 'b', 0, 'c'] → "$.a.b[0].c".
function bodyPath(segments: Array<string | number>): string {
  return segments.reduce<string>(
    (acc, seg) => acc + (typeof seg === 'number' ? `[${seg}]` : `.${seg}`),
    '$',
  )
}

function selectorNodes(expr: Expr): Array<Extract<Expr, { kind: 'selector' }>> {
  const out: Array<Extract<Expr, { kind: 'selector' }>> = []
  const walk = (e: Expr): void => {
    if (e.kind === 'selector') out.push(e)
    else if (e.kind === 'call') e.args.forEach(walk)
  }
  walk(expr)
  return out
}

// The container a placeholder-string sits in, which decides whether an `omit`
// there can drop anything. Only a named slot — an object property or a header —
// can lose a key; an array element or the whole body cannot.
type OmitPosition = 'root' | 'object-value' | 'array-element'

// The whole string is exactly one placeholder (so evaluating to OMIT would drop
// the containing key), else null. `"{{$.x | omit}}"` yes; `"hi {{$.x}}"` and
// `"{{a}}{{b}}"` no.
function wholeStringExpr(node: string): string | null {
  const exprs = listPlaceholders(node)
  return exprs.length === 1 && node === `{{${exprs[0]}}}` ? exprs[0] : null
}

// Walk the fixture body/headers and flag every `omit` that is not the whole
// value of an object property or header (decision 4 in #24). Parse failures are
// ignored here — the main placeholder loop already reports them.
function checkOmitPositions(node: unknown, position: OmitPosition, report: (msg: string) => void): void {
  if (typeof node === 'string') {
    const whole = wholeStringExpr(node)
    for (const expr of listPlaceholders(node)) {
      let ast: Expr
      try {
        ast = parseExpr(expr)
      } catch {
        continue
      }
      if (!callNodes(ast).some((c) => c.name === 'omit')) continue
      if (whole !== expr) {
        report(`placeholder "{{${expr}}}" uses "omit", which must be the entire value of a field, not part of a larger string`)
      } else if (!(ast.kind === 'call' && ast.name === 'omit')) {
        report(`placeholder "{{${expr}}}" must end with "omit" — it is the field-dropping stage and nothing can follow it`)
      } else if (position === 'array-element') {
        report(`placeholder "{{${expr}}}" uses "omit" in an array element; "omit" drops a named field, so it is not allowed in an array`)
      } else if (position === 'root') {
        report(`placeholder "{{${expr}}}" uses "omit" as the entire body; "omit" drops a field, so it cannot be the whole response`)
      }
    }
    return
  }
  if (Array.isArray(node)) {
    node.forEach((item) => checkOmitPositions(item, 'array-element', report))
  } else if (node !== null && typeof node === 'object') {
    Object.values(node).forEach((v) => checkOmitPositions(v, 'object-value', report))
  }
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
