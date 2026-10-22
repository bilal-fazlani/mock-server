import { appendDynamicHistory, getDynamicHistory } from '../../lib/dynamic/history-store'
import { insertLogEntry } from '../../lib/logs/store'
import {
  advanceScenarioProgress,
  captureProfileKeyMapping,
  getDb,
  getGlobalMockScenario,
  getProfileForRequest,
  getProfileKeyMapping,
} from '../../lib/profiles/store'
import { createMockHandler } from '../../lib/router/handler'
import { passthrough } from '../../lib/router/passthrough'
import { getRuntime } from '../../lib/runtime'
import {
  adminPortNotFoundBody,
  resolveSystemRequest,
  SYSTEM_TOKEN_ENV,
  SYSTEM_TOKEN_HEADER,
} from '../../lib/system-ports'

async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const rt = getRuntime()
  const target = resolveSystemRequest(
    rt.catalog,
    (await params).path,
    request.headers.get(SYSTEM_TOKEN_HEADER) ?? undefined,
    process.env[SYSTEM_TOKEN_ENV],
  )
  if (!target) return Response.json(adminPortNotFoundBody(rt.catalog), { status: 404 })
  const handler = createMockHandler({
    ...rt,
    system: target.system,
    env: process.env,
    getProfile: async (profileId) => getProfileForRequest(await getDb(), profileId),
    getGlobalMockScenario: async (system, endpoint) =>
      (await getGlobalMockScenario(await getDb(), system, endpoint))?.scenario ?? null,
    getProfileKeyMapping: async (namespace, key) =>
      getProfileKeyMapping(await getDb(), namespace, key),
    captureProfileKeyMapping: async (input, ownerless) =>
      captureProfileKeyMapping(await getDb(), {
        ...input,
        ephemeralTtlSeconds: ownerless ? rt.profileKeyTtlSeconds : null,
      }),
    advanceScenarioProgress: async (profileId, endpointSlug, steps) =>
      advanceScenarioProgress(await getDb(), profileId, endpointSlug, steps),
    getDynamicHistory: async (ownerType, ownerKey, endpointSlug, scenario) =>
      getDynamicHistory(await getDb(), ownerType, ownerKey, endpointSlug, scenario),
    appendDynamicHistory: async (ownerType, ownerKey, endpointSlug, scenario, slug, ownerless) =>
      appendDynamicHistory(
        await getDb(),
        ownerType,
        ownerKey,
        endpointSlug,
        scenario,
        slug,
        rt.resolverHistoryLimit,
        ownerless ? rt.resolverHistoryTtlSeconds : null,
      ),
    passthrough,
    writeLog: async (entry) => insertLogEntry(await getDb(), entry),
  })
  return handler(request, target.segments)
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
