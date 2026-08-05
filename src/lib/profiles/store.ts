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
  /**
   * Set only on mappings captured for a profile ID with no profile document (an
   * unmocked caller under UNMOCKED_USERS=DEFAULT_MOCK/REAL). A TTL index reaps
   * the row at this instant; mappings owned by a real profile omit the field
   * entirely and never expire.
   */
  expiresAt?: Date
}

export interface ProfileKeyMappingCaptureInput {
  namespace: string
  key: string
  profileId: string
  capturedBy: {
    system: string
    endpoint: string
  }
  /**
   * Owner-lifecycle signal, mirroring `appendDynamicHistory`. A number means the
   * profile does not exist, so the row gets a sliding `expiresAt`. `null` means
   * the owner is real, and any `expiresAt` left from before the profile existed
   * is cleared so the mapping becomes permanent.
   */
  ephemeralTtlSeconds?: number | null
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

// Pinned to globalThis for the same reason as the embedded mongod's URI memo
// (see mongo/embedded.ts): a module-level `let` is one value per *bundle*, not
// per process, so the UI's server components and the route handlers would each
// open their own client. Memoized as a promise so concurrent first callers
// await one connect() instead of racing to build two clients.
const globalScope = globalThis as typeof globalThis & {
  __mockServerMongoClient?: Promise<MongoClient> | null
}

export async function getDb(): Promise<Db> {
  if (!globalScope.__mockServerMongoClient) {
    globalScope.__mockServerMongoClient = connectClient().catch((err) => {
      // A failed connect must not poison the singleton — clear it so the next
      // call retries rather than returning the dead rejection.
      globalScope.__mockServerMongoClient = null
      throw err
    })
  }
  return (await globalScope.__mockServerMongoClient).db(dbName())
}

async function connectClient(): Promise<MongoClient> {
  const uri = await resolveMongoUri()
  const connected = new MongoClient(uri)
  await connected.connect()
  await ensureIndexes(connected.db(dbName()))
  await pruneOrphanedHistoryOnce(connected.db(dbName()))
  return connected
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
  // Mappings captured for a profile ID that has no profile document carry an
  // `expiresAt` and are reaped at that instant; mappings owned by a real profile
  // omit the field and are never touched. As with dynamicHistory the window lives
  // in the document, not the index, so expireAfterSeconds is a constant 0 and a
  // changed PROFILE_KEY_TTL_DURATION needs no index migration.
  await db.collection('profileKeyMappings').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
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
  // Compound with `ts` like every other filter index here, so a future trace-ID
  // filter stays index-ordered under the { ts: -1, logId: -1 } sort instead of
  // falling into a blocking in-memory sort. Sparse because untraced requests
  // write no `traceId` at all, so the index skips them rather than carrying a
  // null per row.
  await db.collection('requestLogs').createIndex({ traceId: 1, ts: -1 }, { sparse: true })
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
  // The profile now exists, so any mapping captured for this ID while it did not
  // must stop being ephemeral. Clearing the expiry here rather than waiting for
  // the next capture to do it means a mapping captured before the profile was
  // created cannot expire out from under it — a gap dynamicHistory still has.
  await db
    .collection<ProfileKeyMapping>('profileKeyMappings')
    .updateMany(
      { profileId: input.profileId, expiresAt: { $exists: true } },
      { $unset: { expiresAt: '' } },
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

// A row past its `expiresAt` is treated as already gone. Mongo's TTL monitor only
// sweeps about once a minute, so without this an orphan keeps winning conflicts —
// and blocking its key for a real profile — for up to a minute after it expired,
// which is the exact failure this TTL exists to end.
function mappingExpired(doc: ProfileKeyMapping, now: Date): boolean {
  return doc.expiresAt !== undefined && doc.expiresAt.getTime() <= now.getTime()
}

export async function captureProfileKeyMapping(
  db: Db,
  input: ProfileKeyMappingCaptureInput,
): Promise<void> {
  const collection = db.collection<ProfileKeyMapping>('profileKeyMappings')
  const now = new Date()
  const filter = { namespace: input.namespace, key: input.key }
  const ttlSeconds = input.ephemeralTtlSeconds ?? null
  // An owner-less capture slides its expiry forward on every touch; a capture
  // whose profile exists clears any `expiresAt` left from before it existed, so
  // the mapping stops being ephemeral the moment it acquires a real owner.
  const expiry =
    ttlSeconds === null
      ? { $unset: { expiresAt: '' as const } }
      : { $set: { expiresAt: new Date(now.getTime() + ttlSeconds * 1000) } }

  const claim = async (previousProfileId: string | undefined): Promise<void> => {
    await collection.updateOne(filter, {
      $set: {
        profileId: input.profileId,
        capturedBy: input.capturedBy,
        modifiedAt: now,
        // Taking over an expired row from a different profile mints a new
        // mapping, so its lifetime starts now rather than inheriting the
        // orphan's createdAt.
        ...(previousProfileId === input.profileId ? {} : { createdAt: now }),
        ...('$set' in expiry ? expiry.$set : {}),
      },
      ...('$unset' in expiry ? { $unset: expiry.$unset } : {}),
    })
  }

  // Rejects only a *live* mapping held by someone else; an expired one is
  // claimable, exactly as if the TTL monitor had already removed it.
  const rejectIfHeld = (doc: ProfileKeyMapping): void => {
    if (doc.profileId !== input.profileId && !mappingExpired(doc, now)) {
      throw new ProfileKeyMappingConflictError(
        input.namespace,
        input.key,
        doc.profileId,
        input.profileId,
      )
    }
  }

  const existing = await collection.findOne(filter, { projection: { _id: 0 } })
  if (existing) {
    rejectIfHeld(existing)
    await claim(existing.profileId)
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
      ...(ttlSeconds === null ? {} : { expiresAt: new Date(now.getTime() + ttlSeconds * 1000) }),
    })
  } catch (err) {
    if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
    const raced = await collection.findOne(filter, { projection: { _id: 0 } })
    if (!raced) throw err
    rejectIfHeld(raced)
    await claim(raced.profileId)
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
