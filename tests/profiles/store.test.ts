import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { appendDynamicHistory, getDynamicHistory } from '../../src/lib/dynamic/history-store'
import {
  advanceScenarioProgress,
  captureProfileKeyMapping,
  clearGlobalMockScenario,
  deleteProfile,
  ensureIndexes,
  getGlobalMockScenario,
  getProfile,
  getProfileKeyMapping,
  getScenarioProgress,
  listGlobalMockScenarios,
  listProfiles,
  ProfileKeyMappingConflictError,
  resetScenarioProgress,
  upsertGlobalMockScenario,
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
  await db.collection('mockProfiles').deleteMany({})
  await db.collection('profileKeyMappings').deleteMany({})
  await db.collection('globalMockScenarios').deleteMany({})
  await db.collection('scenarioProgress').deleteMany({})
  await db.collection('dynamicHistory').deleteMany({})
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('profile store', () => {
  it('creates a profile with timestamps on first upsert', async () => {
    await upsertProfile(db, {
      profileId: 'customer-123',
      displayName: 'Happy path',
      endpointScenarios: { hello_world: 'success' },
    })
    const p = await getProfile(db, 'customer-123')
    expect(p).not.toBeNull()
    expect(p!.displayName).toBe('Happy path')
    expect(p!.endpointScenarios).toEqual({ hello_world: 'success' })
    expect(p!.createdAt).toBeInstanceOf(Date)
    expect(p!.modifiedAt).toBeInstanceOf(Date)
  })

  it('updates scenarios and modifiedAt on re-upsert, preserving createdAt', async () => {
    await upsertProfile(db, { profileId: 'c1', endpointScenarios: { hello_world: 'success' } })
    const before = (await getProfile(db, 'c1'))!
    await sleep(10)
    await upsertProfile(db, { profileId: 'c1', endpointScenarios: { hello_world: 'failure' } })
    const after = (await getProfile(db, 'c1'))!
    expect(after.endpointScenarios).toEqual({ hello_world: 'failure' })
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())
    expect(after.modifiedAt.getTime()).toBeGreaterThan(before.modifiedAt.getTime())
  })

  it('returns null for a missing profile', async () => {
    expect(await getProfile(db, 'ghost')).toBeNull()
  })

  it('lists profiles sorted by modifiedAt descending, without _id', async () => {
    await upsertProfile(db, { profileId: 'old', endpointScenarios: {} })
    await sleep(10)
    await upsertProfile(db, { profileId: 'new', endpointScenarios: {} })
    const profiles = await listProfiles(db)
    expect(profiles.map((p) => p.profileId)).toEqual(['new', 'old'])
    expect('_id' in profiles[0]).toBe(false)
  })

  it('has no TTL index on the collection', async () => {
    const indexes = await db.collection('mockProfiles').indexes()
    expect(indexes.every((i) => i.expireAfterSeconds === undefined)).toBe(true)
  })

  it('deletes a profile and its key mappings while leaving unrelated records', async () => {
    await upsertProfile(db, { profileId: 'c1', endpointScenarios: { hello_world: 'success' } })
    await upsertProfile(db, { profileId: 'c2', endpointScenarios: { hello_world: 'failure' } })
    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-1',
      profileId: 'c1',
      capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
    })
    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-2',
      profileId: 'c2',
      capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
    })

    await deleteProfile(db, 'c1')

    await expect(getProfile(db, 'c1')).resolves.toBeNull()
    await expect(getProfile(db, 'c2')).resolves.toMatchObject({ profileId: 'c2' })
    await expect(getProfileKeyMapping(db, 'order-id', 'evt-1')).resolves.toBeNull()
    await expect(getProfileKeyMapping(db, 'order-id', 'evt-2')).resolves.toMatchObject({
      profileId: 'c2',
    })
  })
})

describe('profile key mapping store', () => {
  it('creates and resolves a profile key mapping', async () => {
    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-1',
      profileId: 'account-123',
      capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
    })

    const mapping = await getProfileKeyMapping(db, 'order-id', 'evt-1')
    expect(mapping).toMatchObject({
      namespace: 'order-id',
      key: 'evt-1',
      profileId: 'account-123',
      capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
    })
    expect(mapping!.createdAt).toBeInstanceOf(Date)
    expect(mapping!.modifiedAt).toBeInstanceOf(Date)
    expect('_id' in mapping!).toBe(false)
  })

  it('idempotently recaptures the same key for the same profile id', async () => {
    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-1',
      profileId: 'account-123',
      capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
    })
    const before = (await getProfileKeyMapping(db, 'order-id', 'evt-1'))!
    await sleep(10)

    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-1',
      profileId: 'account-123',
      capturedBy: { system: 'hello-system', endpoint: 'customer_status' },
    })

    const after = (await getProfileKeyMapping(db, 'order-id', 'evt-1'))!
    expect(after.profileId).toBe('account-123')
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())
    expect(after.modifiedAt.getTime()).toBeGreaterThan(before.modifiedAt.getTime())
    expect(after.capturedBy).toEqual({ system: 'hello-system', endpoint: 'customer_status' })
  })

  it('rejects the same namespace and key captured for a different profile id', async () => {
    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-1',
      profileId: 'account-123',
      capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
    })

    await expect(
      captureProfileKeyMapping(db, {
        namespace: 'order-id',
        key: 'evt-1',
        profileId: 'account-999',
        capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
      }),
    ).rejects.toMatchObject({
      namespace: 'order-id',
      key: 'evt-1',
      existingProfileId: 'account-123',
      newProfileId: 'account-999',
    })
    await expect(
      captureProfileKeyMapping(db, {
        namespace: 'order-id',
        key: 'evt-1',
        profileId: 'account-999',
        capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
      }),
    ).rejects.toBeInstanceOf(ProfileKeyMappingConflictError)
  })

  it('allows different keys to map to the same profile id', async () => {
    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-1',
      profileId: 'account-123',
      capturedBy: { system: 'hello-system', endpoint: 'hello_world' },
    })
    await captureProfileKeyMapping(db, {
      namespace: 'order-id',
      key: 'evt-2',
      profileId: 'account-123',
      capturedBy: { system: 'hello-system', endpoint: 'customer_status' },
    })

    await expect(getProfileKeyMapping(db, 'order-id', 'evt-1')).resolves.toMatchObject({
      profileId: 'account-123',
    })
    await expect(getProfileKeyMapping(db, 'order-id', 'evt-2')).resolves.toMatchObject({
      profileId: 'account-123',
    })
  })

  it('returns null for a missing profile key mapping', async () => {
    expect(await getProfileKeyMapping(db, 'order-id', 'missing')).toBeNull()
  })

  it('creates mapping indexes without TTL', async () => {
    const indexes = await db.collection('profileKeyMappings').indexes()
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { namespace: 1, key: 1 }, unique: true }),
        expect.objectContaining({ key: { profileId: 1 } }),
      ]),
    )
    expect(indexes.every((i) => i.expireAfterSeconds === undefined)).toBe(true)
  })
})

describe('scenario progress store', () => {
  const STEPS = ['timeout', 'review_hold', 'default']

  it('counts calls served per profile and endpoint, starting at 1', async () => {
    expect(await advanceScenarioProgress(db, 'c1', 'assess', STEPS)).toBe(1)
    expect(await advanceScenarioProgress(db, 'c1', 'assess', STEPS)).toBe(2)
    expect(await advanceScenarioProgress(db, 'c1', 'assess', STEPS)).toBe(3)
    expect(await advanceScenarioProgress(db, 'c1', 'assess', STEPS)).toBe(4)
  })

  it('tracks progress independently per profile and per endpoint', async () => {
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    expect(await advanceScenarioProgress(db, 'c2', 'assess', STEPS)).toBe(1)
    expect(await advanceScenarioProgress(db, 'c1', 'notify', STEPS)).toBe(1)
    expect(await advanceScenarioProgress(db, 'c1', 'assess', STEPS)).toBe(3)
  })

  it('resets to 1 when the steps change', async () => {
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    expect(await advanceScenarioProgress(db, 'c1', 'assess', ['default', 'timeout'])).toBe(1)
    expect(await advanceScenarioProgress(db, 'c1', 'assess', ['default', 'timeout'])).toBe(2)
  })

  it('advances atomically under concurrent calls', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => advanceScenarioProgress(db, 'c1', 'assess', STEPS)),
    )
    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('lists progress for a profile without _id', async () => {
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    await advanceScenarioProgress(db, 'c1', 'notify', ['default'])
    await advanceScenarioProgress(db, 'c2', 'assess', STEPS)

    const progress = await getScenarioProgress(db, 'c1')
    expect(progress).toHaveLength(2)
    expect(progress.find((p) => p.endpointName === 'assess')).toMatchObject({
      profileId: 'c1',
      served: 2,
      steps: STEPS,
    })
    expect(progress.find((p) => p.endpointName === 'notify')).toMatchObject({ served: 1 })
    expect(progress.every((p) => !('_id' in p))).toBe(true)
  })

  it('resets progress for a single endpoint', async () => {
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    await advanceScenarioProgress(db, 'c1', 'notify', STEPS)

    await resetScenarioProgress(db, 'c1', 'assess')

    expect(await getScenarioProgress(db, 'c1')).toHaveLength(1)
    expect(await advanceScenarioProgress(db, 'c1', 'assess', STEPS)).toBe(1)
  })

  it('resets all progress for a profile when no endpoint is given', async () => {
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    await advanceScenarioProgress(db, 'c1', 'notify', STEPS)
    await advanceScenarioProgress(db, 'c2', 'assess', STEPS)

    await resetScenarioProgress(db, 'c1')

    expect(await getScenarioProgress(db, 'c1')).toHaveLength(0)
    expect(await getScenarioProgress(db, 'c2')).toHaveLength(1)
  })

  it('deleteProfile also removes its scenario progress', async () => {
    await upsertProfile(db, { profileId: 'c1', endpointScenarios: { assess: STEPS } })
    await advanceScenarioProgress(db, 'c1', 'assess', STEPS)
    await advanceScenarioProgress(db, 'c2', 'assess', STEPS)

    await deleteProfile(db, 'c1')

    expect(await getScenarioProgress(db, 'c1')).toHaveLength(0)
    expect(await getScenarioProgress(db, 'c2')).toHaveLength(1)
  })

  it('stores sequence values on the profile itself', async () => {
    await upsertProfile(db, {
      profileId: 'c1',
      endpointScenarios: { assess: STEPS, notify: 'default' },
    })
    const p = (await getProfile(db, 'c1'))!
    expect(p.endpointScenarios).toEqual({ assess: STEPS, notify: 'default' })
  })
})

describe('global mock scenario store', () => {
  it('creates and resolves a global scenario selection', async () => {
    await upsertGlobalMockScenario(db, {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'real',
    })

    const selection = await getGlobalMockScenario(db, 'hello-system', 'oauth_token')
    expect(selection).toMatchObject({
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'real',
    })
    expect(selection!.createdAt).toBeInstanceOf(Date)
    expect(selection!.modifiedAt).toBeInstanceOf(Date)
    expect('_id' in selection!).toBe(false)
  })

  it('updates an existing global scenario selection', async () => {
    await upsertGlobalMockScenario(db, {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'real',
    })
    const before = (await getGlobalMockScenario(db, 'hello-system', 'oauth_token'))!
    await sleep(10)

    await upsertGlobalMockScenario(db, {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'default',
    })

    const after = (await getGlobalMockScenario(db, 'hello-system', 'oauth_token'))!
    expect(after.scenario).toBe('default')
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())
    expect(after.modifiedAt.getTime()).toBeGreaterThan(before.modifiedAt.getTime())
  })

  it('clears a global scenario selection', async () => {
    await upsertGlobalMockScenario(db, {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'real',
    })
    await clearGlobalMockScenario(db, 'hello-system', 'oauth_token')
    await expect(getGlobalMockScenario(db, 'hello-system', 'oauth_token')).resolves.toBeNull()
  })

  it('clearing a global selection also drops its global dynamic history', async () => {
    await upsertGlobalMockScenario(db, {
      system: 'hello-system',
      endpoint: 'oauth_token',
      scenario: 'dynamic',
    })
    await appendDynamicHistory(db, 'global', 'hello-system', 'oauth_token', 'expired', 10)

    await clearGlobalMockScenario(db, 'hello-system', 'oauth_token')

    expect(await getDynamicHistory(db, 'global', 'hello-system', 'oauth_token')).toEqual([])
  })

  it('clearing one global selection leaves another endpoint\'s dynamic history intact', async () => {
    await appendDynamicHistory(db, 'global', 'hello-system', 'oauth_token', 'expired', 10)
    await appendDynamicHistory(db, 'global', 'hello-system', 'other_endpoint', 'ok', 10)

    await clearGlobalMockScenario(db, 'hello-system', 'oauth_token')

    expect(await getDynamicHistory(db, 'global', 'hello-system', 'other_endpoint')).toEqual(['ok'])
  })

  it('lists global scenario selections sorted by modifiedAt descending', async () => {
    await upsertGlobalMockScenario(db, {
      system: 'hello-system',
      endpoint: 'old_endpoint',
      scenario: 'real',
    })
    await sleep(10)
    await upsertGlobalMockScenario(db, {
      system: 'hello-system',
      endpoint: 'new_endpoint',
      scenario: 'default',
    })

    const selections = await listGlobalMockScenarios(db)
    expect(selections.map((s) => s.endpoint)).toEqual(['new_endpoint', 'old_endpoint'])
  })
})
