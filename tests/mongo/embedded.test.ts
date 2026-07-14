import { MongoClient } from 'mongodb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
