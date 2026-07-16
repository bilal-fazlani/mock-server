import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureIndexes } from '../../src/lib/profiles/store'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('test')
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  await db.collection('requestLogs').drop().catch(() => {})
})

async function tsIndexTtl(db: Db): Promise<number | undefined> {
  const indexes = await db.collection('requestLogs').indexes()
  const ts = indexes.find((i) => JSON.stringify(i.key) === JSON.stringify({ ts: 1 }))
  return ts?.expireAfterSeconds
}

describe('requestLogs TTL index reconciliation', () => {
  it('creates the ts_1 TTL index with the given retention', async () => {
    await ensureIndexes(db, 100)
    expect(await tsIndexTtl(db)).toBe(100)
  })

  it('migrates an existing TTL index in place when the value changes, keeping documents', async () => {
    await ensureIndexes(db, 100)
    await db.collection('requestLogs').insertOne({ logId: 'a', ts: new Date() })

    await ensureIndexes(db, 200)

    expect(await tsIndexTtl(db)).toBe(200)
    expect(await db.collection('requestLogs').countDocuments()).toBe(1)
  })

  it('is a no-op when the value is unchanged', async () => {
    await ensureIndexes(db, 100)
    await ensureIndexes(db, 100)
    expect(await tsIndexTtl(db)).toBe(100)
  })

  it('replaces a pre-existing non-TTL ts_1 index with a TTL one', async () => {
    await db.collection('requestLogs').createIndex({ ts: 1 })
    expect(await tsIndexTtl(db)).toBeUndefined()

    await ensureIndexes(db, 100)

    expect(await tsIndexTtl(db)).toBe(100)
  })
})
