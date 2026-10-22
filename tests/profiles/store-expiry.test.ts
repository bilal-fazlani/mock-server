import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { appendDynamicHistory, getDynamicHistory } from '../../src/lib/dynamic/history-store'
import {
  advanceScenarioProgress,
  captureProfileKeyMapping,
  deleteProfile,
  ensureIndexes,
  getProfile,
  getProfileForRequest,
  getProfileKeyMapping,
  getScenarioProgress,
  listProfiles,
  type MockProfile,
  ProfileKeyMappingConflictError,
  slideProfileExpiry,
  slideProfileExpiryById,
  sweepExpiredProfiles,
  upsertProfile,
} from '../../src/lib/profiles/store'

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
  for (const name of [
    'mockProfiles',
    'profileKeyMappings',
    'scenarioProgress',
    'dynamicHistory',
    'requestLogs',
  ]) {
    await db.collection(name).deleteMany({})
  }
})

const T0 = new Date('2026-10-22T12:00:00Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const raw = (profileId: string) =>
  db.collection<MockProfile>('mockProfiles').findOne({ profileId }, { projection: { _id: 0 } })

const put = (
  profileId: string,
  ttl: string | false | undefined,
  now: Date,
  defaultTtl: string | null = '1d',
) =>
  upsertProfile(db, { profileId, endpointScenarios: {}, ttl }, { defaultTtl, now })

const uiSave = (profileId: string, now: Date) =>
  upsertProfile(db, { profileId, endpointScenarios: {} }, { now })

async function seedState(profileId: string): Promise<void> {
  await captureProfileKeyMapping(db, {
    namespace: 'order-id',
    key: `${profileId}-key`,
    profileId,
    capturedBy: { system: 's', endpoint: 'e' },
  })
  await advanceScenarioProgress(db, profileId, 'ep', ['a', 'b'])
  await appendDynamicHistory(db, 'profile', profileId, 'ep', 'by-amount', 'ok', 10, null)
  await db.collection('requestLogs').insertOne({ logId: `${profileId}-log`, profileId, ts: new Date() })
}

describe('PUT rules', () => {
  it('creates with the server default when no ttl is given', async () => {
    await put('p', undefined, T0)
    expect(await raw('p')).toMatchObject({ ttl: '1d', expiresAt: at(DAY) })
  })

  it('creates with no expiry when the default is off', async () => {
    await put('p', undefined, T0, null)
    const p = await raw('p')
    expect(p).not.toHaveProperty('ttl')
    expect(p).not.toHaveProperty('expiresAt')
  })

  it('creates with the given ttl', async () => {
    await put('p', '2h', T0)
    expect(await raw('p')).toMatchObject({ ttl: '2h', expiresAt: at(2 * HOUR) })
  })

  it('creates with no expiry for ttl false', async () => {
    await put('p', false, T0)
    expect(await raw('p')).not.toHaveProperty('expiresAt')
  })

  it('slides an existing expiry by its stored ttl, not the current default, when no ttl is given', async () => {
    await put('p', '2h', T0)
    await put('p', undefined, at(HOUR), '7d')
    expect(await raw('p')).toMatchObject({ ttl: '2h', expiresAt: at(3 * HOUR) })
  })

  it('switches an existing expiry to a new ttl and restarts it, even when shorter', async () => {
    await put('p', '7d', T0)
    await put('p', '2h', at(HOUR))
    expect(await raw('p')).toMatchObject({ ttl: '2h', expiresAt: at(3 * HOUR) })
  })

  it('removes an existing expiry for ttl false', async () => {
    await put('p', '2h', T0)
    await put('p', false, at(HOUR))
    const p = await raw('p')
    expect(p).not.toHaveProperty('ttl')
    expect(p).not.toHaveProperty('expiresAt')
  })

  it('keeps a profile with no expiry that way when no ttl is given', async () => {
    await put('p', false, T0)
    await put('p', undefined, at(HOUR))
    expect(await raw('p')).not.toHaveProperty('expiresAt')
  })

  it('gives a profile with no expiry the requested ttl', async () => {
    await put('p', false, T0)
    await put('p', '2h', at(HOUR))
    expect(await raw('p')).toMatchObject({ ttl: '2h', expiresAt: at(3 * HOUR) })
  })

  it('leaves a profile with no expiry unchanged for ttl false', async () => {
    await put('p', false, T0)
    await put('p', false, at(HOUR))
    expect(await raw('p')).not.toHaveProperty('expiresAt')
  })

  it('keeps createdAt across saves', async () => {
    await put('p', '2h', T0)
    await put('p', '2h', at(HOUR))
    expect((await raw('p'))!.createdAt).toEqual(T0)
  })
})

describe('profiles from before the upgrade', () => {
  it('keep no expiry through an API PUT with no ttl and a UI save', async () => {
    await db.collection('mockProfiles').insertOne({
      profileId: 'legacy',
      endpointScenarios: {},
      createdAt: T0,
      modifiedAt: T0,
    })
    await put('legacy', undefined, at(HOUR))
    await uiSave('legacy', at(2 * HOUR))
    expect(await raw('legacy')).not.toHaveProperty('expiresAt')
    expect(await getProfile(db, 'legacy', at(365 * DAY))).not.toBeNull()
  })
})

describe('UI save', () => {
  it('creates a profile with no expiry', async () => {
    await uiSave('p', T0)
    expect(await raw('p')).not.toHaveProperty('expiresAt')
  })

  it('slides an existing expiry without changing its ttl', async () => {
    await put('p', '2h', T0)
    await uiSave('p', at(HOUR))
    expect(await raw('p')).toMatchObject({ ttl: '2h', expiresAt: at(3 * HOUR) })
  })
})

describe('expired profiles read as absent', () => {
  it('getProfile and listProfiles leave out a profile once expiresAt <= now', async () => {
    await put('gone', '1h', T0)
    await put('kept', false, T0)
    expect(await getProfile(db, 'gone', at(HOUR - 1))).not.toBeNull()
    expect(await getProfile(db, 'gone', at(HOUR))).toBeNull()
    expect((await listProfiles(db, 20, at(HOUR))).map((p) => p.profileId)).toEqual(['kept'])
  })

  it('getProfileForRequest returns null for an expired profile and does not revive it', async () => {
    await put('gone', '1h', T0)
    expect(await getProfileForRequest(db, 'gone', at(2 * HOUR))).toBeNull()
    expect((await raw('gone'))!.expiresAt).toEqual(at(HOUR))
  })
})

describe('mocked requests slide the expiry', () => {
  it('restarts the expiry on every request, however soon after the last', async () => {
    await put('p', '1h', T0)
    await getProfileForRequest(db, 'p', at(1))
    expect((await raw('p'))!.expiresAt).toEqual(at(1 + HOUR))
    await getProfileForRequest(db, 'p', at(2))
    expect((await raw('p'))!.expiresAt).toEqual(at(2 + HOUR))
  })

  it('keeps a profile idle for just under its ttl alive, then restarts the full ttl', async () => {
    await put('p', '1m', T0)
    expect(await getProfileForRequest(db, 'p', at(MIN - 1))).not.toBeNull()
    expect((await raw('p'))!.expiresAt).toEqual(at(MIN - 1 + MIN))
    expect(await getProfileForRequest(db, 'p', at(2 * MIN - 2))).not.toBeNull()
  })

  it('expires a profile idle for its full ttl', async () => {
    await put('p', '1m', T0)
    expect(await getProfileForRequest(db, 'p', at(MIN))).toBeNull()
  })

  it('slides by the stored ttl and never adds an expiry', async () => {
    await put('p', '2h', T0)
    await put('none', false, T0)
    await getProfileForRequest(db, 'p', at(HOUR))
    await getProfileForRequest(db, 'none', at(HOUR))
    expect((await raw('p'))!.expiresAt).toEqual(at(3 * HOUR))
    expect(await raw('none')).not.toHaveProperty('expiresAt')
  })

  it('never pulls an expiry earlier when a stale read races a later slide', async () => {
    await put('p', '1h', T0)
    const stale = await getProfile(db, 'p', at(2 * MIN))
    await getProfileForRequest(db, 'p', at(10 * MIN))
    await slideProfileExpiry(db, stale!, at(2 * MIN))
    expect((await raw('p'))!.expiresAt).toEqual(at(10 * MIN + HOUR))
  })
})

describe('reset slides the expiry', () => {
  it('restarts it from now with no minimum step and keeps its ttl', async () => {
    await put('p', '1h', T0)
    await slideProfileExpiryById(db, 'p', at(1000))
    expect(await raw('p')).toMatchObject({ ttl: '1h', expiresAt: at(1000 + HOUR) })
  })

  it('never adds an expiry or revives an expired profile', async () => {
    await put('none', false, T0)
    await put('gone', '1h', T0)
    await slideProfileExpiryById(db, 'none', at(MIN))
    await slideProfileExpiryById(db, 'gone', at(2 * HOUR))
    expect(await raw('none')).not.toHaveProperty('expiresAt')
    expect((await raw('gone'))!.expiresAt).toEqual(at(HOUR))
  })
})

describe('saving over an expired, unswept profile', () => {
  it('clears its progress, key mappings and resolver history, and starts a new profile', async () => {
    await put('p', '1h', T0)
    await seedState('p')

    await put('p', '2h', at(2 * HOUR))

    expect(await getScenarioProgress(db, 'p')).toEqual([])
    expect(await getProfileKeyMapping(db, 'order-id', 'p-key')).toBeNull()
    expect(await getDynamicHistory(db, 'profile', 'p', 'ep', 'by-amount')).toEqual([])
    expect(await raw('p')).toMatchObject({
      ttl: '2h',
      expiresAt: at(4 * HOUR),
      createdAt: at(2 * HOUR),
    })
  })

  it('leaves a recreated profile state alone when a PUT lands mid-sweep', async () => {
    await put('p', '1h', T0)
    await seedState('p')
    // Lands the PUT between the sweeper's profile delete and its state cascade.
    const racing = new Proxy(db, {
      get(target, prop) {
        if (prop !== 'collection') return Reflect.get(target, prop)
        return (name: string) => {
          const collection = target.collection(name)
          if (name !== 'mockProfiles') return collection
          return new Proxy(collection, {
            get(c, key) {
              if (key !== 'deleteOne') return Reflect.get(c, key)
              return async (...args: Parameters<typeof c.deleteOne>) => {
                const result = await c.deleteOne(...args)
                await c.insertOne({ profileId: 'p', endpointScenarios: {}, createdAt: T0, modifiedAt: T0 })
                return result
              }
            },
          })
        }
      },
    })

    expect(await sweepExpiredProfiles(racing, at(2 * HOUR))).toBe(1)
    expect(await getScenarioProgress(db, 'p')).toHaveLength(1)
  })

  it('takes the server default when no ttl is given, not the expired profile ttl', async () => {
    await put('p', '1h', T0)
    await put('p', undefined, at(2 * HOUR), '1d')
    expect(await raw('p')).toMatchObject({ ttl: '1d' })
  })

  it('creates it with no expiry from a UI save', async () => {
    await put('p', '1h', T0)
    await uiSave('p', at(2 * HOUR))
    expect(await raw('p')).not.toHaveProperty('expiresAt')
  })
})

describe('key mappings owned by an expired profile', () => {
  const capture = (profileId: string) =>
    captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-1',
      profileId,
      capturedBy: { system: 's', endpoint: 'e' },
    })

  it('can be claimed by another profile with no conflict', async () => {
    await upsertProfile(db, { profileId: 'old', endpointScenarios: {}, ttl: '1m' })
    await capture('old')
    await db
      .collection('mockProfiles')
      .updateOne({ profileId: 'old' }, { $set: { expiresAt: new Date(1) } })

    await expect(capture('new')).resolves.toBeUndefined()
    expect(await getProfileKeyMapping(db, 'order-id', 'evt-1')).toMatchObject({ profileId: 'new' })
  })

  it('still conflict while the owning profile is live', async () => {
    await upsertProfile(db, { profileId: 'old', endpointScenarios: {}, ttl: '1h' })
    await capture('old')
    await expect(capture('new')).rejects.toBeInstanceOf(ProfileKeyMappingConflictError)
  })
})

describe('sweepExpiredProfiles', () => {
  it('deletes expired profiles with their mappings, progress and history but keeps request logs', async () => {
    await put('gone', '1h', T0)
    await put('live', '1d', T0)
    await put('forever', false, T0)
    await seedState('gone')
    await seedState('live')

    expect(await sweepExpiredProfiles(db, at(2 * HOUR))).toBe(1)

    expect(await raw('gone')).toBeNull()
    expect(await getScenarioProgress(db, 'gone')).toEqual([])
    expect(await getProfileKeyMapping(db, 'order-id', 'gone-key')).toBeNull()
    expect(await getDynamicHistory(db, 'profile', 'gone', 'ep', 'by-amount')).toEqual([])
    expect(await db.collection('requestLogs').countDocuments({ profileId: 'gone' })).toBe(1)

    expect(await raw('live')).not.toBeNull()
    expect(await raw('forever')).not.toBeNull()
    expect(await getScenarioProgress(db, 'live')).toHaveLength(1)
    expect(await getProfileKeyMapping(db, 'order-id', 'live-key')).not.toBeNull()
  })

  it('is harmless when two sweepers run at once', async () => {
    await put('a', '1h', T0)
    await put('b', '1h', T0)
    const counts = await Promise.all([
      sweepExpiredProfiles(db, at(2 * HOUR)),
      sweepExpiredProfiles(db, at(2 * HOUR)),
    ])
    expect(counts[0] + counts[1]).toBe(2)
    expect(await db.collection('mockProfiles').countDocuments()).toBe(0)
  })

  it('uses a partial, non-TTL index on expiresAt', async () => {
    const index = (await db.collection('mockProfiles').indexes()).find(
      (i) => JSON.stringify(i.key) === JSON.stringify({ expiresAt: 1 }),
    )
    expect(index).toMatchObject({ partialFilterExpression: { expiresAt: { $exists: true } } })
    expect(index?.expireAfterSeconds).toBeUndefined()
    const plan = await db
      .collection('mockProfiles')
      .find({ expiresAt: { $lte: T0 } })
      .explain()
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('mockProfiles_expiresAt')
  })

  it('manual delete still removes request logs', async () => {
    await put('p', '1h', T0)
    await seedState('p')
    await deleteProfile(db, 'p')
    expect(await db.collection('requestLogs').countDocuments({ profileId: 'p' })).toBe(0)
  })
})
