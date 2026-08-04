import type { MongoMemoryServer } from 'mongodb-memory-server'
import { writeConsoleLog } from '../logs/console'

// A single embedded mongod, booted lazily and shared process-wide. The boot is
// memoized as a promise so concurrent callers await the same instance rather
// than racing to start two servers. Data is ephemeral by design: this path is
// only taken when no external MONGODB_CONNECTION_STRING is configured.
//
// The memo lives on globalThis, not in a module-level `let`, because a module
// `let` is NOT one value per process under Next: the server-component graph and
// the route-handler graph are compiled as separate bundles, and `next dev`
// re-evaluates a module on every HMR recompile. Each copy would boot its own
// mongod with its own empty dataset — so a profile saved through the UI would
// be invisible to the mock router serving `/[...path]`, which reports it as
// `profile_not_found`. globalThis is the only thing all those module instances
// share.
const globalScope = globalThis as typeof globalThis & {
  __mockServerEmbeddedMongoUri?: Promise<string> | null
  __mockServerEmbeddedMongo?: MongoMemoryServer | null
}

async function bootEmbedded(): Promise<string> {
  // Dynamic import keeps mongodb-memory-server out of the hot path when an
  // external connection string is configured.
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  writeConsoleLog(
    'info',
    '[mock-server] MONGODB_CONNECTION_STRING not set; starting embedded in-memory MongoDB (data is ephemeral)…',
    { fields: { 'event.action': 'embedded_mongo_start' } },
  )
  const booted = await MongoMemoryServer.create()
  globalScope.__mockServerEmbeddedMongo = booted
  return booted.getUri()
}

export async function resolveMongoUri(): Promise<string> {
  const configured = process.env.MONGODB_CONNECTION_STRING
  if (configured) return configured
  if (!globalScope.__mockServerEmbeddedMongoUri) {
    globalScope.__mockServerEmbeddedMongoUri = bootEmbedded().catch((err) => {
      // A failed boot must not poison the singleton — clear it so the next
      // call retries a fresh start rather than returning the dead rejection.
      globalScope.__mockServerEmbeddedMongoUri = null
      throw err
    })
  }
  return globalScope.__mockServerEmbeddedMongoUri
}

export async function stopEmbeddedMongo(): Promise<void> {
  const running = globalScope.__mockServerEmbeddedMongo
  globalScope.__mockServerEmbeddedMongo = null
  globalScope.__mockServerEmbeddedMongoUri = null
  if (running) await running.stop()
}
