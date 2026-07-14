import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  appendDynamicHistory,
  getDynamicHistory,
  resetDynamicHistory,
} from '../../src/lib/dynamic/history-store'
import { deleteProfile, ensureIndexes } from '../../src/lib/profiles/store'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('test')
  await ensureIndexes(db)
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  await db.collection('dynamicHistory').deleteMany({})
})

describe('dynamic history store', () => {
  it('starts empty and appends in order', async () => {
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual([])
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'b', 10)
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual(['a', 'b'])
  })

  it('caps to the last N entries', async () => {
    for (const slug of ['a', 'b', 'c', 'd']) {
      await appendDynamicHistory(db, 'profile', 'c1', 'ep', slug, 2)
    }
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual(['c', 'd'])
  })

  it('keys profile and global owners separately', async () => {
    await appendDynamicHistory(db, 'profile', 'shared', 'ep', 'p', 10)
    await appendDynamicHistory(db, 'global', 'shared', 'ep', 'g', 10)
    expect(await getDynamicHistory(db, 'profile', 'shared', 'ep')).toEqual(['p'])
    expect(await getDynamicHistory(db, 'global', 'shared', 'ep')).toEqual(['g'])
  })

  it('resets one endpoint or a whole owner', async () => {
    await appendDynamicHistory(db, 'profile', 'c1', 'ep1', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'c1', 'ep2', 'b', 10)
    await resetDynamicHistory(db, 'profile', 'c1', 'ep1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep1')).toEqual([])
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep2')).toEqual(['b'])
    await resetDynamicHistory(db, 'profile', 'c1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep2')).toEqual([])
  })

  it('deleteProfile removes that profile\'s dynamic history', async () => {
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'a', 10)
    await deleteProfile(db, 'c1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep')).toEqual([])
  })
})
