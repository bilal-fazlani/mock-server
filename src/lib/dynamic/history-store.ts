import { Db } from 'mongodb'

export type DynamicOwnerType = 'profile' | 'global'

interface DynamicHistoryDoc {
  ownerType: DynamicOwnerType
  ownerKey: string
  endpointName: string
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
): Promise<string[]> {
  const doc = await db
    .collection<DynamicHistoryDoc>(COLLECTION)
    .findOne({ ownerType, ownerKey, endpointName }, { projection: { _id: 0, history: 1 } })
  return doc?.history ?? []
}

export async function appendDynamicHistory(
  db: Db,
  ownerType: DynamicOwnerType,
  ownerKey: string,
  endpointName: string,
  slug: string,
  limit: number,
): Promise<void> {
  const now = new Date()
  await db.collection<DynamicHistoryDoc>(COLLECTION).updateOne(
    { ownerType, ownerKey, endpointName },
    {
      $push: { history: { $each: [slug], $slice: -Math.max(1, limit) } },
      $set: { modifiedAt: now },
      $setOnInsert: { ownerType, ownerKey, endpointName, createdAt: now },
    },
    { upsert: true },
  )
}

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
