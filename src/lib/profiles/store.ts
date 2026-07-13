import { Db, MongoClient, MongoServerError } from 'mongodb'

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
    const uri = process.env.MONGODB_CONNECTION_STRING
    if (!uri) throw new Error('MONGODB_CONNECTION_STRING is not set')
    client = new MongoClient(uri)
    await client.connect()
    await ensureIndexes(client.db(dbName()))
  }
  return client.db(dbName())
}

function dbName(): string {
  return process.env.MONGODB_DB ?? 'mockDB'
}

export async function ensureIndexes(db: Db): Promise<void> {
  // Deliberately no TTL index: profiles are curated and never expire.
  await db.collection('mockProfiles').createIndex({ profileId: 1 }, { unique: true })
  await db.collection('profileKeyMappings').createIndex({ namespace: 1, key: 1 }, { unique: true })
  await db.collection('profileKeyMappings').createIndex({ profileId: 1 })
  await db.collection('globalMockScenarios').createIndex({ system: 1, endpoint: 1 }, { unique: true })
  await db
    .collection('scenarioProgress')
    .createIndex({ profileId: 1, endpointName: 1 }, { unique: true })
  // Request logs expire after 24 hours; see src/lib/logs/store.ts.
  await db.collection('requestLogs').createIndex({ ts: 1 }, { expireAfterSeconds: 86400 })
  await db.collection('requestLogs').createIndex({ logId: 1 }, { unique: true })
  await db.collection('requestLogs').createIndex({ profileId: 1, ts: -1 })
  await db.collection('requestLogs').createIndex({ endpoint: 1, ts: -1 })
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
}
