import { Db, MongoClient, MongoServerError } from 'mongodb'
import { parseRequestLogTtlSeconds } from '../config'
import { pruneOrphanedHistoryOnce } from '../dynamic/prune'
import { resolveMongoUri } from '../mongo/embedded'

/**
 * A profile's scenario selection for one endpoint: a single scenario key, or
 * an ordered sequence of scenario keys served call-by-call (sticking on the
 * last step once the sequence is exhausted).
 */
export type ScenarioSelection = string | string[]

export interface MockProfile {
  profileId: string
  displayName?: string
  endpointScenarios: Record<string, ScenarioSelection>
  createdAt: Date
  modifiedAt: Date
}

export interface ScenarioProgress {
  profileId: string
  endpointName: string
  steps: string[]
  served: number
  createdAt: Date
  modifiedAt: Date
}

export interface ProfileKeyMapping {
  namespace: string
  key: string
  profileId: string
  capturedBy: {
    system: string
    endpoint: string
  }
  createdAt: Date
  modifiedAt: Date
}

export interface ProfileKeyMappingCaptureInput {
  namespace: string
  key: string
  profileId: string
  capturedBy: {
    system: string
    endpoint: string
  }
}

export interface GlobalMockScenario {
  system: string
  endpoint: string
  scenario: string
  createdAt: Date
  modifiedAt: Date
}

export interface GlobalMockScenarioInput {
  system: string
  endpoint: string
  scenario: string
}

export class ProfileKeyMappingConflictError extends Error {
  constructor(
    readonly namespace: string,
    readonly key: string,
    readonly existingProfileId: string,
    readonly newProfileId: string,
  ) {
    super(
      `profile key mapping conflict for ${namespace}/${key}: ` +
        `${existingProfileId} already exists, got ${newProfileId}`,
    )
  }
}

let client: MongoClient | null = null

export async function getDb(): Promise<Db> {
  if (!client) {
    const uri = await resolveMongoUri()
    client = new MongoClient(uri)
    await client.connect()
    await ensureIndexes(client.db(dbName()))
    await pruneOrphanedHistoryOnce(client.db(dbName()))
  }
  return client.db(dbName())
}

function dbName(): string {
  return process.env.MONGODB_DB ?? 'mockDB'
}

export async function ensureIndexes(
  db: Db,
  requestLogTtlSeconds = parseRequestLogTtlSeconds(process.env.REQUEST_LOG_TTL_DURATION),
): Promise<void> {
  // Deliberately no TTL index: profiles are curated and never expire.
  await db.collection('mockProfiles').createIndex({ profileId: 1 }, { unique: true })
  await db.collection('profileKeyMappings').createIndex({ namespace: 1, key: 1 }, { unique: true })
  await db.collection('profileKeyMappings').createIndex({ profileId: 1 })
  await db.collection('globalMockScenarios').createIndex({ system: 1, endpoint: 1 }, { unique: true })
  await db
    .collection('scenarioProgress')
    .createIndex({ profileId: 1, endpointName: 1 }, { unique: true })
  await ensureDynamicHistoryIndex(db)
  // Request logs expire via a TTL index whose window is configurable with
  // REQUEST_LOG_TTL_DURATION (default 1d); see src/lib/logs/store.ts.
  await ensureRequestLogTtlIndex(db, requestLogTtlSeconds)
  await db.collection('requestLogs').createIndex({ logId: 1 }, { unique: true })
  await db.collection('requestLogs').createIndex({ profileId: 1, ts: -1 })
  await db.collection('requestLogs').createIndex({ endpoint: 1, ts: -1 })
  // Serves the unfiltered first-page/live list, which sorts by { ts: -1, logId: -1 }.
  // Without it that query COLLSCANs the whole collection into a blocking in-memory
  // sort (slow first load); with it the sort is index-ordered and stops at `limit`.
  // It also backs the keyset (ts, logId) `$or` bounds used by before/since paging.
  await db.collection('requestLogs').createIndex({ ts: -1, logId: -1 })
}

// Reconcile the requestLogs { ts: 1 } TTL index to `ttlSeconds`. MongoDB rejects
// a createIndex that only changes expireAfterSeconds on an existing index, so we
// introspect first and migrate in place with collMod when the retention window
// changed — no drop, no data loss. A stray non-TTL ts_1 index (never created by
// this app, but possible on a hand-modified DB) can't be converted with collMod,
// so it's dropped and recreated.
async function ensureRequestLogTtlIndex(db: Db, ttlSeconds: number): Promise<void> {
  const collection = db.collection('requestLogs')
  // indexes() throws NamespaceNotFound (26) before the collection exists — on a
  // fresh DB there's no index to reconcile, so treat that as "none".
  const indexes = await collection.indexes().catch((err: unknown) => {
    if (err instanceof MongoServerError && err.code === 26) return []
    throw err
  })
  const existing = indexes.find(
    (index) => JSON.stringify(index.key) === JSON.stringify({ ts: 1 }),
  )

  if (!existing) {
    await collection.createIndex({ ts: 1 }, { expireAfterSeconds: ttlSeconds })
    return
  }
  if (existing.expireAfterSeconds === ttlSeconds) return

  if (typeof existing.expireAfterSeconds === 'number') {
    await db.command({
      collMod: 'requestLogs',
      index: { keyPattern: { ts: 1 }, expireAfterSeconds: ttlSeconds },
    })
    return
  }

  // Non-TTL ts_1 index: convert by dropping and recreating with the TTL.
  await collection.dropIndex(existing.name as string)
  await collection.createIndex({ ts: 1 }, { expireAfterSeconds: ttlSeconds })
}

// Reconcile the dynamicHistory unique index. Per-scenario history windows key on
// { ownerType, ownerKey, endpointName, scenario }, but pre-feature deployments
// (the collection predates this feature under the old _dynamic.ts machinery)
// carry a unique index on the 3-field key without `scenario`. That old index is
// the STRICTER constraint: left in place it keeps rejecting a second scenario's
// window for the same endpoint with E11000, breaking the feature. A plain
// createIndex with the new key pattern would add a parallel index, not replace
// it — so introspect and drop the stale one first, then create the 4-field index
// with an explicit name so a future key-shape change fails loudly with
// IndexOptionsConflict instead of silently accumulating another parallel index.
async function ensureDynamicHistoryIndex(db: Db): Promise<void> {
  const collection = db.collection('dynamicHistory')
  // indexes() throws NamespaceNotFound (26) before the collection exists — on a
  // fresh DB there's no stale index to reconcile, so treat that as "none".
  const indexes = await collection.indexes().catch((err: unknown) => {
    if (err instanceof MongoServerError && err.code === 26) return []
    throw err
  })
  const stale = indexes.find(
    (index) =>
      JSON.stringify(index.key) ===
      JSON.stringify({ ownerType: 1, ownerKey: 1, endpointName: 1 }),
  )
  if (stale) await collection.dropIndex(stale.name as string)
  await collection.createIndex(
    { ownerType: 1, ownerKey: 1, endpointName: 1, scenario: 1 },
    { unique: true, name: 'dynamicHistory_owner_endpoint_scenario_unique' },
  )
  // Owner-less windows (an unmocked caller's profile ID) carry an `expiresAt`
  // and are reaped at that instant; rows for a real owner omit the field and
  // are never touched by a TTL index. Unlike the requestLogs TTL, the retention
  // window lives in the document rather than the index, so expireAfterSeconds
  // is a constant 0 and a changed RESOLVER_HISTORY_TTL_DURATION needs no index
  // migration — it just moves the next append's `expiresAt`.
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export async function getProfile(db: Db, profileId: string): Promise<MockProfile | null> {
  return db
    .collection<MockProfile>('mockProfiles')
    .findOne({ profileId }, { projection: { _id: 0 } })
}

export async function upsertProfile(
  db: Db,
  input: {
    profileId: string
    displayName?: string
    endpointScenarios: Record<string, ScenarioSelection>
  },
): Promise<void> {
  const now = new Date()
  const set: Record<string, unknown> = {
    endpointScenarios: input.endpointScenarios,
    modifiedAt: now,
  }
  if (input.displayName !== undefined) set.displayName = input.displayName
  await db.collection<MockProfile>('mockProfiles').updateOne(
    { profileId: input.profileId },
    {
      $set: set,
      $setOnInsert: { profileId: input.profileId, createdAt: now },
    },
    { upsert: true },
  )
}

export async function listProfiles(db: Db, limit = 20): Promise<MockProfile[]> {
  return db
    .collection<MockProfile>('mockProfiles')
    .find({}, { projection: { _id: 0 } })
    .sort({ modifiedAt: -1 })
    .limit(limit)
    .toArray()
}

export async function deleteProfile(db: Db, profileId: string): Promise<void> {
  await db.collection<MockProfile>('mockProfiles').deleteOne({ profileId })
  await db.collection<ProfileKeyMapping>('profileKeyMappings').deleteMany({ profileId })
  await db.collection<ScenarioProgress>('scenarioProgress').deleteMany({ profileId })
  await db.collection('requestLogs').deleteMany({ profileId })
  await db.collection('dynamicHistory').deleteMany({ ownerType: 'profile', ownerKey: profileId })
}

/**
 * Atomically records one served call against a scenario sequence and returns
 * the 1-based call number. Progress is keyed to the exact steps array: when
 * the saved sequence changes, the counter restarts at 1 without an explicit
 * reset.
 */
export async function advanceScenarioProgress(
  db: Db,
  profileId: string,
  endpointName: string,
  steps: string[],
): Promise<number> {
  try {
    return await advanceScenarioProgressOnce(db, profileId, endpointName, steps)
  } catch (err) {
    // Two concurrent first calls can both take the upsert-insert path; the
    // loser lands here and retries as a plain update against the winner's doc.
    if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
    return advanceScenarioProgressOnce(db, profileId, endpointName, steps)
  }
}

async function advanceScenarioProgressOnce(
  db: Db,
  profileId: string,
  endpointName: string,
  steps: string[],
): Promise<number> {
  const now = new Date()
  const doc = await db.collection<ScenarioProgress>('scenarioProgress').findOneAndUpdate(
    { profileId, endpointName },
    [
      {
        $set: {
          served: {
            $cond: [
              { $eq: ['$steps', { $literal: steps }] },
              { $add: [{ $ifNull: ['$served', 0] }, 1] },
              1,
            ],
          },
          steps: { $literal: steps },
          createdAt: { $ifNull: ['$createdAt', now] },
          modifiedAt: now,
        },
      },
    ],
    { upsert: true, returnDocument: 'after' },
  )
  if (!doc) throw new Error('scenario progress upsert returned no document')
  return doc.served
}

export async function getScenarioProgress(db: Db, profileId: string): Promise<ScenarioProgress[]> {
  return db
    .collection<ScenarioProgress>('scenarioProgress')
    .find({ profileId }, { projection: { _id: 0 } })
    .toArray()
}

export async function resetScenarioProgress(
  db: Db,
  profileId: string,
  endpointName?: string,
): Promise<void> {
  await db
    .collection<ScenarioProgress>('scenarioProgress')
    .deleteMany(endpointName === undefined ? { profileId } : { profileId, endpointName })
}

export async function getProfileKeyMapping(
  db: Db,
  namespace: string,
  key: string,
): Promise<ProfileKeyMapping | null> {
  return db
    .collection<ProfileKeyMapping>('profileKeyMappings')
    .findOne({ namespace, key }, { projection: { _id: 0 } })
}

export async function captureProfileKeyMapping(
  db: Db,
  input: ProfileKeyMappingCaptureInput,
): Promise<void> {
  const collection = db.collection<ProfileKeyMapping>('profileKeyMappings')
  const now = new Date()
  const existing = await collection.findOne(
    { namespace: input.namespace, key: input.key },
    { projection: { _id: 0 } },
  )
  if (existing) {
    if (existing.profileId !== input.profileId) {
      throw new ProfileKeyMappingConflictError(
        input.namespace,
        input.key,
        existing.profileId,
        input.profileId,
      )
    }
    await collection.updateOne(
      { namespace: input.namespace, key: input.key, profileId: input.profileId },
      { $set: { capturedBy: input.capturedBy, modifiedAt: now } },
    )
    return
  }

  try {
    await collection.insertOne({
      namespace: input.namespace,
      key: input.key,
      profileId: input.profileId,
      capturedBy: input.capturedBy,
      createdAt: now,
      modifiedAt: now,
    })
  } catch (err) {
    if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
    const raced = await collection.findOne(
      { namespace: input.namespace, key: input.key },
      { projection: { _id: 0 } },
    )
    if (!raced) throw err
    if (raced.profileId !== input.profileId) {
      throw new ProfileKeyMappingConflictError(
        input.namespace,
        input.key,
        raced.profileId,
        input.profileId,
      )
    }
    await collection.updateOne(
      { namespace: input.namespace, key: input.key, profileId: input.profileId },
      { $set: { capturedBy: input.capturedBy, modifiedAt: now } },
    )
  }
}

export async function getGlobalMockScenario(
  db: Db,
  system: string,
  endpoint: string,
): Promise<GlobalMockScenario | null> {
  return db
    .collection<GlobalMockScenario>('globalMockScenarios')
    .findOne({ system, endpoint }, { projection: { _id: 0 } })
}

export async function listGlobalMockScenarios(db: Db): Promise<GlobalMockScenario[]> {
  return db
    .collection<GlobalMockScenario>('globalMockScenarios')
    .find({}, { projection: { _id: 0 } })
    .sort({ modifiedAt: -1 })
    .toArray()
}

export async function upsertGlobalMockScenario(
  db: Db,
  input: GlobalMockScenarioInput,
): Promise<void> {
  const now = new Date()
  await db.collection<GlobalMockScenario>('globalMockScenarios').updateOne(
    { system: input.system, endpoint: input.endpoint },
    {
      $set: { scenario: input.scenario, modifiedAt: now },
      $setOnInsert: {
        system: input.system,
        endpoint: input.endpoint,
        createdAt: now,
      },
    },
    { upsert: true },
  )
}

export async function clearGlobalMockScenario(
  db: Db,
  system: string,
  endpoint: string,
): Promise<void> {
  await db.collection<GlobalMockScenario>('globalMockScenarios').deleteOne({ system, endpoint })
  // Mirror deleteProfile's cleanup: clearing a global selection is the
  // deletion-equivalent, so drop the endpoint's orphaned dynamic history.
  await db
    .collection('dynamicHistory')
    .deleteMany({ ownerType: 'global', ownerKey: system, endpointName: endpoint })
}
