import { getDb } from '../../../../lib/profiles/store'
import { BUILD_INFO } from '../../../../lib/build-info'

// Never cache — the health check must reflect live Mongo connectivity.
export const dynamic = 'force-dynamic'

// Fail fast: the MongoDB driver's default server-selection timeout is 30s, far
// longer than the compose healthcheck's 5s window. Bound the check so a down
// Mongo yields a prompt 503 instead of a hung request.
const CHECK_TIMEOUT_MS = 3000

export async function GET(): Promise<Response> {
  const build = { version: BUILD_INFO.version, sha: BUILD_INFO.gitSha }
  try {
    await withTimeout(pingMongo(), CHECK_TIMEOUT_MS)
    return Response.json({ status: 'ok', mongo: 'up', ...build })
  } catch (err) {
    return Response.json(
      { status: 'error', mongo: 'down', error: err instanceof Error ? err.message : String(err), ...build },
      { status: 503 },
    )
  }
}

async function pingMongo(): Promise<void> {
  const db = await getDb()
  await db.command({ ping: 1 })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`health check timed out after ${ms}ms`)),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
