import type { MongoMemoryServer } from 'mongodb-memory-server'

// A single embedded mongod, booted lazily and shared process-wide. The boot is
// memoized as a promise so concurrent callers await the same instance rather
// than racing to start two servers. Data is ephemeral by design: this path is
// only taken when no external MONGODB_CONNECTION_STRING is configured.
let embeddedPromise: Promise<string> | null = null
let server: MongoMemoryServer | null = null

async function bootEmbedded(): Promise<string> {
  // Dynamic import keeps mongodb-memory-server out of the hot path when an
  // external connection string is configured.
  const { MongoMemoryServer } = await import('mongodb-memory-server')
  console.log(
    '[mock-server] MONGODB_CONNECTION_STRING not set; starting embedded in-memory MongoDB (data is ephemeral)…',
  )
  server = await MongoMemoryServer.create()
  return server.getUri()
}

export async function resolveMongoUri(): Promise<string> {
  const configured = process.env.MONGODB_CONNECTION_STRING
  if (configured) return configured
  if (!embeddedPromise) {
    embeddedPromise = bootEmbedded().catch((err) => {
      // A failed boot must not poison the singleton — clear it so the next
      // call retries a fresh start rather than returning the dead rejection.
      embeddedPromise = null
      throw err
    })
  }
  return embeddedPromise
}

export async function stopEmbeddedMongo(): Promise<void> {
  const running = server
  server = null
  embeddedPromise = null
  if (running) await running.stop()
}
