import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  appendDynamicHistory,
  getDynamicHistory,
  pruneOrphanedDynamicHistory,
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

async function rawDoc(ownerKey: string, scenario = 'dynamic') {
  return db.collection('dynamicHistory').findOne({ ownerType: 'profile', ownerKey, endpointName: 'ep', scenario })
}

describe('owner-less history expiry', () => {
  it('leaves rows for a real owner with no expiresAt', async () => {
    await appendDynamicHistory(db, 'profile', 'owned', 'ep', 'dynamic', 'a', 10)
    expect(await rawDoc('owned')).not.toHaveProperty('expiresAt')
  })

  it('stamps expiresAt on owner-less rows, TTL seconds ahead', async () => {
    const before = Date.now()
    await appendDynamicHistory(db, 'profile', 'unmocked', 'ep', 'dynamic', 'a', 10, 3600)
    const doc = await rawDoc('unmocked')
    const expiresAt = (doc?.expiresAt as Date).getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600_000)
    expect(expiresAt).toBeLessThan(before + 3600_000 + 60_000)
  })

  it('slides expiresAt forward on every append so an active caller keeps its window', async () => {
    await appendDynamicHistory(db, 'profile', 'unmocked', 'ep', 'dynamic', 'a', 10, 60)
    const first = (await rawDoc('unmocked'))?.expiresAt as Date
    await appendDynamicHistory(db, 'profile', 'unmocked', 'ep', 'dynamic', 'b', 10, 3600)
    const second = (await rawDoc('unmocked'))?.expiresAt as Date
    expect(second.getTime()).toBeGreaterThan(first.getTime())
    expect(await getDynamicHistory(db, 'profile', 'unmocked', 'ep', 'dynamic')).toEqual(['a', 'b'])
  })

  // Creating the profile for an ID that was previously unmocked must promote
  // its history to permanent — otherwise a curated profile inherits a TTL.
  it('clears expiresAt once the owner exists', async () => {
    await appendDynamicHistory(db, 'profile', 'later', 'ep', 'dynamic', 'a', 10, 3600)
    expect(await rawDoc('later')).toHaveProperty('expiresAt')
    await appendDynamicHistory(db, 'profile', 'later', 'ep', 'dynamic', 'b', 10)
    expect(await rawDoc('later')).not.toHaveProperty('expiresAt')
    expect(await getDynamicHistory(db, 'profile', 'later', 'ep', 'dynamic')).toEqual(['a', 'b'])
  })

  it('creates a TTL index on expiresAt that expires at the stored instant', async () => {
    const indexes = await db.collection('dynamicHistory').indexes()
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    )
  })
})

describe('pruneOrphanedDynamicHistory', () => {
  it('drops windows whose scenario is no longer resolver-backed, keeping live ones', async () => {
    await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'live', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'removed', 'b', 10)
    await appendDynamicHistory(db, 'global', 'sys', 'ep', 'removed', 'c', 10)

    const deleted = await pruneOrphanedDynamicHistory(db, [{ endpointName: 'ep', scenario: 'live' }])

    expect(deleted).toBe(2)
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'live')).toEqual(['a'])
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'removed')).toEqual([])
    expect(await getDynamicHistory(db, 'global', 'sys', 'ep', 'removed')).toEqual([])
  })

  it('keeps a scenario name that is live on another endpoint', async () => {
    await appendDynamicHistory(db, 'profile', 'p1', 'ep1', 'default', 'a', 10)
    await appendDynamicHistory(db, 'profile', 'p1', 'ep2', 'default', 'b', 10)

    const deleted = await pruneOrphanedDynamicHistory(db, [
      { endpointName: 'ep2', scenario: 'default' },
    ])

    expect(deleted).toBe(1)
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep1', 'default')).toEqual([])
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep2', 'default')).toEqual(['b'])
  })

  // Rows written before the per-scenario key can never be read again.
  it('sweeps legacy rows that carry no scenario field', async () => {
    await db.collection('dynamicHistory').insertOne({
      ownerType: 'profile',
      ownerKey: 'p1',
      endpointName: 'ep',
      history: ['a'],
      createdAt: new Date(),
      modifiedAt: new Date(),
    })

    const deleted = await pruneOrphanedDynamicHistory(db, [{ endpointName: 'ep', scenario: 'live' }])

    expect(deleted).toBe(1)
    expect(await db.collection('dynamicHistory').countDocuments({})).toBe(0)
  })

  it('deletes nothing when every window is still backed', async () => {
    await appendDynamicHistory(db, 'profile', 'p1', 'ep', 'live', 'a', 10)
    expect(await pruneOrphanedDynamicHistory(db, [{ endpointName: 'ep', scenario: 'live' }])).toBe(0)
    expect(await getDynamicHistory(db, 'profile', 'p1', 'ep', 'live')).toEqual(['a'])
  })
})
