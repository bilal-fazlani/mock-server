import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { writeAdminLog } from '../../src/lib/logs/admin-log'
import { listLogSummaries } from '../../src/lib/logs/store'
import { ensureIndexes } from '../../src/lib/profiles/store'

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
  await db.collection('requestLogs').deleteMany({})
})

describe('writeAdminLog', () => {
  it('writes an admin log entry with the action and endpoint', async () => {
    await writeAdminLog(db, 'p1', 'progress_reset', 'hello_world')
    const entries = await listLogSummaries(db, {})
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('admin')
    expect(entries[0].profileId).toBe('p1')
    expect(entries[0].trace.adminAction).toBe('progress_reset')
    expect(entries[0].trace.adminEndpoint).toBe('hello_world')
  })

  it('omits adminEndpoint when not provided', async () => {
    await writeAdminLog(db, 'p2', 'profile_saved')
    const entries = await listLogSummaries(db, {})
    expect(entries[0].trace.adminEndpoint).toBeUndefined()
  })

  it('never throws when the db write fails', async () => {
    await expect(
      writeAdminLog({} as unknown as Db, 'p3', 'profile_saved'),
    ).resolves.toBeUndefined()
  })
})
