import { MongoClient } from 'mongodb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMongoUri, stopEmbeddedMongo } from '../../src/lib/mongo/embedded'

const ORIGINAL = process.env.MONGODB_CONNECTION_STRING

beforeEach(() => {
  delete process.env.MONGODB_CONNECTION_STRING
})

afterEach(async () => {
  await stopEmbeddedMongo()
  if (ORIGINAL === undefined) delete process.env.MONGODB_CONNECTION_STRING
  else process.env.MONGODB_CONNECTION_STRING = ORIGINAL
})

describe('resolveMongoUri', () => {
  it('returns the configured connection string without booting embedded', async () => {
    process.env.MONGODB_CONNECTION_STRING = 'mongodb://configured.example:27017'
    expect(await resolveMongoUri()).toBe('mongodb://configured.example:27017')
  })

  it('boots an embedded mongod when no connection string is set', async () => {
    const uri = await resolveMongoUri()
    expect(uri).toMatch(/^mongodb:\/\//)

    const client = new MongoClient(uri)
    await client.connect()
    const ping = await client.db('admin').command({ ping: 1 })
    expect(ping.ok).toBe(1)
    await client.close()
  })

  it('reuses a single embedded instance across concurrent calls', async () => {
    const [a, b] = await Promise.all([resolveMongoUri(), resolveMongoUri()])
    expect(a).toBe(b)
  })
})

describe('resolveMongoUri boot failure recovery', () => {
  afterEach(() => {
    vi.doUnmock('mongodb-memory-server')
    vi.resetModules()
  })

  it('clears the memoized promise on boot failure so the next call retries a fresh boot', async () => {
    // Simulate a transient failure (e.g. binary download hiccup) on the first
    // MongoMemoryServer.create() call, then a successful boot on the second.
    const createMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom: simulated transient boot failure'))
      .mockResolvedValueOnce({
        getUri: () => 'mongodb://127.0.0.1:27099/test',
        stop: vi.fn(async () => {}),
      })

    vi.doMock('mongodb-memory-server', () => ({
      MongoMemoryServer: { create: createMock },
    }))
    vi.resetModules()

    // Re-import the module fresh so it picks up the mocked dependency and has
    // its own isolated `embeddedPromise`/`server` module state.
    const isolated = await import('../../src/lib/mongo/embedded')

    await expect(isolated.resolveMongoUri()).rejects.toThrow(
      'boom: simulated transient boot failure',
    )

    // If the singleton were poisoned, this second call would return the same
    // cached rejection instead of attempting a fresh boot.
    const uri = await isolated.resolveMongoUri()
    expect(uri).toBe('mongodb://127.0.0.1:27099/test')
    expect(createMock).toHaveBeenCalledTimes(2)

    await isolated.stopEmbeddedMongo()
  })
})
