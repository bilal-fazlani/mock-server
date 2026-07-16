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
    captureProfileKeyMapping: async (input) => captureProfileKeyMapping(await getDb(), input),
    advanceScenarioProgress: async (profileId, endpointName, steps) =>
      advanceScenarioProgress(await getDb(), profileId, endpointName, steps),
    getDynamicHistory: async (ownerType, ownerKey, endpointName, scenario) =>
      getDynamicHistory(await getDb(), ownerType, ownerKey, endpointName, scenario),
    appendDynamicHistory: async (ownerType, ownerKey, endpointName, scenario, slug) =>
      appendDynamicHistory(await getDb(), ownerType, ownerKey, endpointName, scenario, slug, rt.resolverHistoryLimit),
    passthrough,
    writeLog: async (entry) => insertLogEntry(await getDb(), entry),
  })
  return handler(request, (await params).path)
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
