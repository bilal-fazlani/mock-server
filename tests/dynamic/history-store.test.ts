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
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic')).toEqual([])
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic', 'b', 10)
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic')).toEqual(['a', 'b'])
  })

  it('caps to the last N entries', async () => {
    for (const slug of ['a', 'b', 'c', 'd']) {
      await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic', slug, 2)
    }
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic')).toEqual(['c', 'd'])
  })

  it('keys profile and global owners separately', async () => {
    await appendDynamicHistory(db, 'profile', 'shared', 'ep', 'dynamic', 'p', 10)
    await appendDynamicHistory(db, 'global', 'shared', 'ep', 'dynamic', 'g', 10)
    expect(await getDynamicHistory(db, 'profile', 'shared', 'ep', 'dynamic')).toEqual(['p'])
    expect(await getDynamicHistory(db, 'global', 'shared', 'ep', 'dynamic')).toEqual(['g'])
  })

  it('resets one endpoint or a whole owner', async () => {
    await appendDynamicHistory(db, 'profile', 'c1', 'ep1', 'dynamic', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'c1', 'ep2', 'dynamic', 'b', 10)
    await resetDynamicHistory(db, 'profile', 'c1', 'ep1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep1', 'dynamic')).toEqual([])
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep2', 'dynamic')).toEqual(['b'])
    await resetDynamicHistory(db, 'profile', 'c1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep2', 'dynamic')).toEqual([])
  })

  it('deleteProfile removes that profile\'s dynamic history', async () => {
    await appendDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic', 'a', 10)
    await deleteProfile(db, 'c1')
    expect(await getDynamicHistory(db, 'profile', 'c1', 'ep', 'dynamic')).toEqual([])
  })

  it('keeps separate windows per scenario slug on the same endpoint', async () => {
    await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount', 'hold', 10)
    await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'default', 'success', 10)
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount')).toEqual(['hold'])
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'default')).toEqual(['success'])
  })

  it('resetDynamicHistory clears every scenario window for the endpoint', async () => {
    await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount', 'hold', 10)
    await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'default', 'success', 10)
    await resetDynamicHistory(db, 'profile', 'p1', 'ep')
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'by-amount')).toEqual([])
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'default')).toEqual([])
  })
})
