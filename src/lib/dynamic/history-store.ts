import { Db } from 'mongodb'

export type DynamicOwnerType = 'profile' | 'global'

interface DynamicHistoryDoc {
  ownerType: DynamicOwnerType
  ownerKey: string
  endpointName: string
  /** The resolver-backed scenario slug this window belongs to. */
  scenario: string
  history: string[]
  createdAt: Date
  modifiedAt: Date
}

const COLLECTION = 'dynamicHistory'

export async function getDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName: string,
  scenario: string,
): Promise<string[]> {
  const doc = await db
    .collection<DynamicHistoryDoc>(COLLECTION)
    .findOne({ ownerType, ownerKey, endpointName, scenario }, { projection: { _id: 0, history: 1 } })
  return doc?.history ?? []
}

export async function appendDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName: string,
  scenario: string,
  slug: string,
  limit: number,
): Promise<void> {
  const now = new Date()
  await db.collection<DynamicHistoryDoc>(COLLECTION).updateOne(
    { ownerType, ownerKey, endpointName, scenario },
    {
      $push: { history: { $each: [slug], $slice: -Math.max(1, limit) } },
      $set: { modifiedAt: now },
      $setOnInsert: { ownerType, ownerKey, endpointName, scenario, createdAt: now },
    },
    { upsert: true },
  )
}

// Reset clears every scenario's window for the owner (+endpoint): the UI
// exposes one reset button per endpoint, and pre-rename rows (no `scenario`
// field) simply never match get/append again — clean break, no migration.
export async function resetDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName?: string,
): Promise<void> {
  await db
    .collection<DynamicHistoryDoc>(COLLECTION)
    .deleteMany(
      endpointName === undefined
        ? { ownerType, ownerKey }
        : { ownerType, ownerKey, endpointName },
    )
}
