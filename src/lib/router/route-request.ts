import { matchPath, parsePathTemplate } from '../catalog/path-template'
import { schemaKey, type SchemaRegistry } from '../catalog/schema'
import {
  extractProfileIdValue,
  extractValue,
  parseProfileIdSelector,
  parseSelector,
  RequestContext,
} from '../catalog/selector'
import type { Catalog, EndpointDef, SystemDef } from '../catalog/types'
import type { UnmockedUsers } from '../config'
import type { DynamicOwnerType } from '../dynamic/history-store'
import type { LogOutcome, LogTraceData } from '../logs/store'
import { FixtureError, type Fixture } from '../mock-engine/fixtures'
import {
  DEFAULT_DYNAMIC_TIMEOUT_MS,
  ResolverRuntimeError,
  ResolverTimeoutError,
  type CompiledResolver,
  type ResolverInput,
} from '../mock-engine/resolver'
import { PlaceholderError, resolveTemplate } from '../mock-engine/template'
import {
  ProfileKeyMappingConflictError,
  type MockProfile,
  type ProfileKeyMapping,
  type ProfileKeyMappingCaptureInput,
  type ScenarioSelection,
} from '../profiles/store'
import { DEFAULT_SCENARIO, DYNAMIC_SCENARIO, implicitScenario, isScenarioDeclared, REAL_SCENARIO } from '../scenarios'
import type { PassthroughRequest, ProxiedResponse } from './passthrough'

export interface IncomingRequest {
  method: string
  path: string
  search: string
  headers: Record<string, string>
  rawBody: Buffer | null
}

export interface RouteResult {
  status: number
  headers: Record<string, string>
  bodyBytes: Buffer
}

/**
 * Mutable per-request decision trace. The caller passes an empty object via
 * RouterDeps.trace; each routing stage annotates it as it runs, so the
 * resulting log entry is the actual decision path, not a reconstruction.
 */
export interface RouteTrace extends LogTraceData {
  system?: string
  endpoint?: string
  profileId?: string
  outcome?: LogOutcome
  error?: { code: string; message: string }
}

export interface RouterDeps {
  catalog: Catalog
  schemas?: SchemaRegistry
  passthroughAsDefault: boolean
  unmockedUsers: UnmockedUsers
  timeoutMs: number
  env: Record<string, string | undefined>
  getProfile: (profileId: string) => Promise<MockProfile | null>
  getGlobalMockScenario: (systemSlug: string, endpointName: string) => Promise<string | null>
  getProfileKeyMapping: (namespace: string, key: string) => Promise<ProfileKeyMapping | null>
  captureProfileKeyMapping: (input: ProfileKeyMappingCaptureInput) => Promise<void>
  advanceScenarioProgress: (
    profileId: string,
    endpointName: string,
    steps: string[],
  ) => Promise<number>
  getCompiledResolver: (systemSlug: string, endpointName: string) => CompiledResolver | null
  getDynamicHistory: (
    ownerType: DynamicOwnerType,
    ownerKey: string,
    endpointName: string,
    scenario: string,
  ) => Promise<string[]>
  appendDynamicHistory: (
    ownerType: DynamicOwnerType,
    ownerKey: string,
    endpointName: string,
    scenario: string,
    slug: string,
  ) => Promise<void>
  dynamicResolverTimeoutMs?: number
  passthrough: (req: PassthroughRequest) => Promise<ProxiedResponse>
  loadFixture: (systemSlug: string, endpointName: string, scenario: string) => Fixture
  now?: () => Date
  trace?: RouteTrace
}

function jsonResult(status: number, body: unknown): RouteResult {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    bodyBytes: Buffer.from(JSON.stringify(body)),
  }
}

export async function routeRequest(
  req: IncomingRequest,
  deps: RouterDeps,
): Promise<RouteResult> {
  const trace = deps.trace ?? {}
  const match = findEndpoint(deps.catalog, req.method, req.path)
  if (!match) {
    traceError(trace, 'no_match', `no matching endpoint for ${req.method} ${req.path}`)
    return jsonResult(404, { error: 'no matching endpoint', method: req.method, path: req.path })
  }
  const { system, endpoint, pathParams } = match
  trace.system = system.slug
  trace.endpoint = endpoint.name
  const ctx: RequestContext = {
    body: null,
    pathParams,
    query: new URLSearchParams(req.search),
    headers: req.headers,
  }

  if (req.rawBody && req.rawBody.length > 0) {
    try {
      ctx.body = JSON.parse(req.rawBody.toString('utf8'))
    } catch {
      traceError(trace, 'invalid_json', 'invalid JSON request body')
      return jsonResult(400, { error: 'invalid JSON request body', endpoint: endpoint.name })
    }
  }

  let profileId: string | null = null
  let scenario: string
  if ((endpoint.mockType ?? 'profiled') === 'global') {
    const globalPick = await deps.getGlobalMockScenario(system.slug, endpoint.name)
    scenario = globalPick ?? implicitScenario(deps.passthroughAsDefault)
    trace.scenario = scenario
    trace.scenarioSource = globalPick === null ? 'implicit' : 'global'
  } else {
    const resolvedProfile = await resolveProfileId(endpoint, ctx, deps, trace)
    if (!resolvedProfile.ok) return resolvedProfile.result
    profileId = resolvedProfile.profileId
    trace.profileId = profileId

    const profile = await deps.getProfile(profileId)

    if (!profile) {
      switch (deps.unmockedUsers) {
        case 'ERROR':
          traceError(trace, 'profile_not_found', `profile "${profileId}" not found`)
          return jsonResult(404, { error: `profile "${profileId}" not found`, endpoint: endpoint.name })
        case 'DEFAULT_MOCK':
          scenario = DEFAULT_SCENARIO
          trace.scenarioSource = 'unmocked_policy'
          break
        case 'REAL':
          scenario = REAL_SCENARIO
          trace.scenarioSource = 'unmocked_policy'
          break
      }
    } else {
      // Profiles store only deviations from the configured implicit scenario
      // (delta save); a missing entry means "follow the environment default".
      scenario = await resolveScenarioSelection(
        profile.endpointScenarios[endpoint.name],
        endpoint,
        profileId,
        deps,
        trace,
      )
    }
    trace.scenario = scenario
  }

  if (scenario === DYNAMIC_SCENARIO) {
    const resolved = await resolveDynamic(system, endpoint, profileId, ctx, deps, trace)
    if (!resolved.ok) return resolved.result
    scenario = resolved.scenario
    trace.scenario = scenario
    trace.scenarioSource = 'dynamic'
    trace.dynamic = { returned: scenario }
  }

  if (scenario === REAL_SCENARIO) {
    const captureError = profileId
      ? await captureProfileKeys(system, endpoint, profileId, ctx, deps, trace)
      : null
    if (captureError) return captureError
    return proxy(system, endpoint, req, deps, trace)
  }

  const compiled = deps.schemas?.get(schemaKey(system.slug, endpoint.name))
  if (compiled) {
    const issues = compiled.validateRequestBody(ctx.body)
    if (issues.length > 0) {
      setValidation(trace, 'request', 'failed')
      traceError(trace, 'request_schema_invalid', 'request body does not match schema')
      return jsonResult(400, {
        error: 'request body does not match schema',
        endpoint: endpoint.name,
        details: issues,
      })
    }
    setValidation(trace, 'request', 'ok')
  }

  if (profileId) {
    const captureError = await captureProfileKeys(system, endpoint, profileId, ctx, deps, trace)
    if (captureError) return captureError
  }

  if (!(scenario in endpoint.scenarios)) {
    // Drift: a profile pinned a scenario the catalog no longer declares.
    // "default" is always declared (startup-validated), so this can only
    // happen for an explicit, non-default pin.
    traceError(
      trace,
      'scenario_undeclared',
      `scenario "${scenario}" is not declared for endpoint "${endpoint.name}"`,
    )
    return jsonResult(500, {
      error: `scenario "${scenario}" is not declared for endpoint "${endpoint.name}"`,
      endpoint: endpoint.name,
      scenario,
    })
  }

  try {
    const fixture = deps.loadFixture(system.slug, endpoint.name, scenario)
    const now = deps.now ? deps.now() : new Date()
    const placeholders: Record<string, string> = {}
    const body = resolveTemplate(fixture.body, ctx, now, placeholders)
    if (compiled) {
      const issues = compiled.validateResponseBody(fixture.status, body)
      if (issues.length > 0) {
        setValidation(trace, 'response', 'failed')
        traceError(trace, 'response_schema_invalid', 'generated response does not match schema')
        return jsonResult(500, {
          error: 'generated response does not match schema',
          endpoint: endpoint.name,
          scenario,
          details: issues,
        })
      }
      setValidation(trace, 'response', 'ok')
    }
    const headers = {
      'content-type': 'application/json',
      ...(resolveTemplate(fixture.headers ?? {}, ctx, now, placeholders) as Record<string, string>),
    }
    trace.placeholders = placeholders
    trace.outcome = 'fixture'
    return { status: fixture.status, headers, bodyBytes: Buffer.from(JSON.stringify(body)) }
  } catch (err) {
    if (err instanceof PlaceholderError || err instanceof FixtureError) {
      traceError(trace, 'template_error', err.message)
      return jsonResult(500, { error: err.message, endpoint: endpoint.name, scenario })
    }
    throw err
  }
}

function traceError(trace: RouteTrace, code: string, message: string): void {
  trace.outcome = 'error'
  trace.error = { code, message }
}

function setValidation(
  trace: RouteTrace,
  side: 'request' | 'response',
  result: 'ok' | 'failed' | 'drift_warning',
): void {
  trace.validation = { ...trace.validation, [side]: result }
}

// A sequence advances one step per served call and sticks on its last step;
// the progress counter lives in the store, keyed to the exact steps array.
async function resolveScenarioSelection(
  selection: ScenarioSelection | undefined,
  endpoint: EndpointDef,
  profileId: string,
  deps: RouterDeps,
  trace: RouteTrace,
): Promise<string> {
  if (!Array.isArray(selection)) {
    trace.scenarioSource = selection === undefined ? 'implicit' : 'pin'
    return selection ?? implicitScenario(deps.passthroughAsDefault)
  }
  if (selection.length === 0) {
    trace.scenarioSource = 'implicit'
    return implicitScenario(deps.passthroughAsDefault)
  }
  const served = await deps.advanceScenarioProgress(profileId, endpoint.name, selection)
  const step = Math.min(served, selection.length)
  trace.scenarioSource = 'sequence'
  trace.sequence = { step, of: selection.length, served }
  return selection[step - 1]
}

async function resolveDynamic(
  system: SystemDef,
  endpoint: EndpointDef,
  profileId: string | null,
  ctx: RequestContext,
  deps: RouterDeps,
  trace: RouteTrace,
): Promise<{ ok: true; scenario: string } | { ok: false; result: RouteResult }> {
  let compiled: CompiledResolver | null
  try {
    compiled = deps.getCompiledResolver(system.slug, endpoint.name)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    traceError(trace, 'dynamic_compile_error', message)
    return {
      ok: false,
      result: jsonResult(500, {
        error: 'dynamic resolver failed to compile',
        endpoint: endpoint.name,
        message,
      }),
    }
  }
  if (!compiled) {
    traceError(
      trace,
      'dynamic_resolver_missing',
      `dynamic scenario selected but endpoint "${endpoint.name}" has no _dynamic.ts`,
    )
    return {
      ok: false,
      result: jsonResult(500, {
        error: 'dynamic scenario selected but no _dynamic.ts resolver is present',
        endpoint: endpoint.name,
      }),
    }
  }

  const ownerType: DynamicOwnerType = profileId ? 'profile' : 'global'
  const ownerKey = profileId ?? system.slug
  const history = await deps.getDynamicHistory(ownerType, ownerKey, endpoint.name, DYNAMIC_SCENARIO)
  const input: ResolverInput = {
    request: {
      method: endpoint.method,
      path: endpoint.path,
      pathParams: ctx.pathParams,
      query: queryToRecord(ctx.query),
      headers: ctx.headers,
      body: ctx.body,
    },
    history,
    profileId,
  }
  // Isolate the resolver's input from the live request context: resolveDynamic
  // runs before request-schema validation, captureProfileKeys, and template
  // resolution, all of which still read ctx. A resolver that mutates its input
  // by reference must not be able to corrupt the response served afterward.
  const isolatedInput = structuredClone(input)

  let returned: unknown
  try {
    returned = compiled.invoke(isolatedInput, deps.dynamicResolverTimeoutMs ?? DEFAULT_DYNAMIC_TIMEOUT_MS)
  } catch (err) {
    if (err instanceof ResolverTimeoutError) {
      traceError(trace, 'dynamic_timeout', err.message)
    } else if (err instanceof ResolverRuntimeError) {
      traceError(trace, 'dynamic_threw', err.message)
    } else {
      traceError(trace, 'dynamic_threw', err instanceof Error ? err.message : String(err))
    }
    return { ok: false, result: jsonResult(500, { error: 'dynamic resolver failed', endpoint: endpoint.name }) }
  }

  if (typeof returned !== 'string' || returned === DYNAMIC_SCENARIO || !isScenarioDeclared(endpoint, returned)) {
    traceError(
      trace,
      'dynamic_bad_return',
      `_dynamic.ts returned an invalid scenario: ${JSON.stringify(returned)}`,
    )
    return {
      ok: false,
      result: jsonResult(500, {
        error: 'dynamic resolver returned an undeclared scenario',
        endpoint: endpoint.name,
        returned,
      }),
    }
  }

  await deps.appendDynamicHistory(ownerType, ownerKey, endpoint.name, DYNAMIC_SCENARIO, returned)
  return { ok: true, scenario: returned }
}

function queryToRecord(query: URLSearchParams): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const key of new Set(query.keys())) out[key] = query.getAll(key)
  return out
}

async function resolveProfileId(
  endpoint: EndpointDef,
  ctx: RequestContext,
  deps: RouterDeps,
  trace: RouteTrace,
): Promise<{ ok: true; profileId: string } | { ok: false; result: RouteResult }> {
  if (!endpoint.profileIdSelector) {
    traceError(
      trace,
      'no_profile_selector',
      `profiled endpoint "${endpoint.name}" has no profileIdSelector`,
    )
    return {
      ok: false,
      result: jsonResult(500, {
        error: `profiled endpoint "${endpoint.name}" has no profileIdSelector`,
        endpoint: endpoint.name,
      }),
    }
  }
  const selector = parseProfileIdSelector(endpoint.profileIdSelector)
  const value = extractProfileIdValue(selector, ctx)
  if (value === null) {
    traceError(
      trace,
      'selector_unresolved',
      `profile ID selector "${endpoint.profileIdSelector}" did not resolve`,
    )
    return {
      ok: false,
      result: jsonResult(400, {
        error: `profile ID selector "${endpoint.profileIdSelector}" did not resolve`,
        endpoint: endpoint.name,
      }),
    }
  }
  if (selector.source !== 'profileKey') {
    trace.profileResolution = {
      selector: endpoint.profileIdSelector,
      value: String(value),
      via: 'direct',
    }
    return { ok: true, profileId: String(value) }
  }

  const key = String(value)
  const mapping = await deps.getProfileKeyMapping(selector.namespace, key)
  if (!mapping) {
    traceError(
      trace,
      'mapping_not_found',
      `no profile key mapping for ${selector.namespace}/${key}`,
    )
    return {
      ok: false,
      result: jsonResult(404, {
        error: 'profile_key_mapping_not_found',
        namespace: selector.namespace,
        key,
        endpoint: endpoint.name,
      }),
    }
  }
  trace.profileResolution = {
    selector: endpoint.profileIdSelector,
    value: key,
    via: { namespace: selector.namespace, key },
  }
  return { ok: true, profileId: mapping.profileId }
}

async function captureProfileKeys(
  system: SystemDef,
  endpoint: EndpointDef,
  profileId: string,
  ctx: RequestContext,
  deps: RouterDeps,
  trace: RouteTrace,
): Promise<RouteResult | null> {
  for (const capture of endpoint.captureProfileKeys ?? []) {
    const selector = parseSelector(capture.keySelector)
    const value = extractValue(selector, ctx)
    if (value === null) {
      traceError(
        trace,
        'capture_unresolved',
        `profile key selector "${capture.keySelector}" did not resolve`,
      )
      return jsonResult(400, {
        error: `profile key selector "${capture.keySelector}" did not resolve`,
        endpoint: endpoint.name,
        namespace: capture.namespace,
      })
    }
    try {
      await deps.captureProfileKeyMapping({
        namespace: capture.namespace,
        key: String(value),
        profileId,
        capturedBy: { system: system.slug, endpoint: endpoint.name },
      })
      trace.captures = [...(trace.captures ?? []), { namespace: capture.namespace, key: String(value) }]
    } catch (err) {
      if (err instanceof ProfileKeyMappingConflictError) {
        traceError(
          trace,
          'mapping_conflict',
          `${err.namespace}/${err.key} already mapped to ${err.existingProfileId}`,
        )
        return jsonResult(409, {
          error: 'profile_key_mapping_conflict',
          namespace: err.namespace,
          key: err.key,
          existingProfileId: err.existingProfileId,
          newProfileId: err.newProfileId,
        })
      }
      throw err
    }
  }
  return null
}

async function proxy(
  system: SystemDef,
  endpoint: EndpointDef,
  req: IncomingRequest,
  deps: RouterDeps,
  trace: RouteTrace,
): Promise<RouteResult> {
  const baseUrl = deps.env[system.baseUrlEnv]
  if (!baseUrl) {
    // Startup validation guarantees this is set when passthrough is the
    // configured default; otherwise explicit passthrough selections can still
    // reach this defensive, self-explaining route-time error.
    traceError(trace, 'missing_base_url', `environment variable ${system.baseUrlEnv} is not set`)
    return jsonResult(500, {
      error: `environment variable ${system.baseUrlEnv} is not set`,
      endpoint: endpoint.name,
    })
  }
  const targetUrl = `${baseUrl}${req.path}${req.search}`
  const startedAt = Date.now()
  let proxied: ProxiedResponse
  try {
    proxied = await deps.passthrough({
      baseUrl,
      method: req.method,
      path: req.path,
      search: req.search,
      headers: req.headers,
      rawBody: req.rawBody,
      timeoutMs: deps.timeoutMs,
    })
  } catch (err) {
    const message = passthroughFailureMessage(err)
    traceError(trace, 'passthrough_failed', `passthrough to ${targetUrl} failed: ${message}`)
    return jsonResult(502, {
      error: 'passthrough request failed',
      endpoint: endpoint.name,
      upstream: targetUrl,
      message,
    })
  }
  trace.outcome = 'passthrough'
  trace.upstream = {
    url: targetUrl,
    status: proxied.status,
    durationMs: Date.now() - startedAt,
  }
  warnOnSchemaDrift(system, endpoint, proxied, deps, trace)
  return { status: proxied.status, headers: proxied.headers, bodyBytes: proxied.bodyBytes }
}

function passthroughFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const code = err instanceof Error ? errorCode((err as Error & { cause?: unknown }).cause) : null
  return code ? `${message} (${code})` : message
}

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const maybeCode = (value as { code?: unknown }).code
  if (typeof maybeCode === 'string') return maybeCode
  const maybeErrors = (value as { errors?: unknown }).errors
  if (!Array.isArray(maybeErrors)) return null
  for (const nested of maybeErrors) {
    const nestedCode = errorCode(nested)
    if (nestedCode) return nestedCode
  }
  return null
}

// Warn-only drift probe: a real upstream response that violates _schema.json
// means the schema (and therefore the mocks validated against it) has drifted
// from reality. Never blocks or modifies the proxied response.
function warnOnSchemaDrift(
  system: SystemDef,
  endpoint: EndpointDef,
  proxied: ProxiedResponse,
  deps: RouterDeps,
  trace: RouteTrace,
): void {
  const compiled = deps.schemas?.get(schemaKey(system.slug, endpoint.name))
  if (!compiled) return
  const contentType = proxied.headers['content-type'] ?? ''
  if (!contentType.includes('json')) return
  let body: unknown
  try {
    body = JSON.parse(proxied.bodyBytes.toString('utf8'))
  } catch {
    return
  }
  const issues = compiled.validateResponseBody(proxied.status, body)
  if (issues.length > 0) {
    setValidation(trace, 'response', 'drift_warning')
  }
}

function findEndpoint(
  catalog: Catalog,
  method: string,
  path: string,
): { system: SystemDef; endpoint: EndpointDef; pathParams: Record<string, string> } | null {
  for (const system of catalog.systems) {
    for (const endpoint of system.endpoints) {
      if (endpoint.method.toUpperCase() !== method.toUpperCase()) continue
      const pathParams = matchPath(parsePathTemplate(endpoint.path), path)
      if (pathParams) return { system, endpoint, pathParams }
    }
  }
  return null
}
