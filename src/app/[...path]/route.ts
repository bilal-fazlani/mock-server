import { appendDynamicHistory, getDynamicHistory } from '../../lib/dynamic/history-store'
import { insertLogEntry } from '../../lib/logs/store'
import {
  advanceScenarioProgress,
  captureProfileKeyMapping,
  getDb,
  getGlobalMockScenario,
  getProfile,
  getProfileKeyMapping,
} from '../../lib/profiles/store'
import { createMockHandler } from '../../lib/router/handler'
import { passthrough } from '../../lib/router/passthrough'
import { getRuntime } from '../../lib/runtime'

async function handle(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const rt = getRuntime()
  const handler = createMockHandler({
    ...rt,
    env: process.env,
    getProfile: async (profileId) => getProfile(await getDb(), profileId),
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
  return handler(request, (await params).path)
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
