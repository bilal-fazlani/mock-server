import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearLogs,
  getLogEntry,
  insertLogEntry,
  listLogEntries,
  listLogSummaries,
  type LogEntry,
} from '../../src/lib/logs/store'
import { deleteProfile, ensureIndexes, upsertProfile } from '../../src/lib/profiles/store'

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
  await db.collection('mockProfiles').deleteMany({})
})

let seq = 0
function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  seq += 1
  return {
    logId: `lg_test_${seq}`,
    ts: new Date(Date.now() + seq * 1000),
    kind: 'request',
    profileId: 'c1',
    system: 'hello-system',
    endpoint: 'hello_world',
    method: 'POST',
    path: '/hello/world',
    query: '',
    outcome: 'fixture',
    trace: { scenario: 'default', scenarioSource: 'implicit' },
    ...overrides,
  }
}

describe('log store', () => {
  it('inserts and lists entries newest first without _id', async () => {
    const first = entry()
    const second = entry()
    await insertLogEntry(db, first)
    await insertLogEntry(db, second)

    const listed = await listLogEntries(db, {})
    expect(listed.map((e) => e.logId)).toEqual([second.logId, first.logId])
    expect(listed.every((e) => !('_id' in e))).toBe(true)
  })

  it('filters by profile, endpoint, errors, and log id prefix', async () => {
    await insertLogEntry(db, entry({ profileId: 'c1', endpoint: 'ep_a', logId: 'lg_aaa111' }))
    await insertLogEntry(db, entry({ profileId: 'c2', endpoint: 'ep_b', logId: 'lg_bbb222' }))
    await insertLogEntry(
      db,
      entry({ profileId: 'c2', endpoint: 'ep_b', logId: 'lg_bbb333', outcome: 'error', error: { code: 'no_match', message: 'x' } }),
    )

    expect(await listLogEntries(db, { profileId: 'c1' })).toHaveLength(1)
    expect(await listLogEntries(db, { endpoint: 'ep_b' })).toHaveLength(2)
    expect(await listLogEntries(db, { errorsOnly: true })).toHaveLength(1)
    expect(await listLogEntries(db, { logIdQuery: 'lg_bbb' })).toHaveLength(2)
    expect(await listLogEntries(db, { logIdQuery: 'LG_BBB333' })).toHaveLength(1)
    expect(await listLogEntries(db, { logIdQuery: 'bbb' })).toHaveLength(0)
  })

  it('returns only entries newer than the since cursor', async () => {
    const a = entry()
    const b = entry()
    const c = entry()
    for (const e of [a, b, c]) await insertLogEntry(db, e)

    const newer = await listLogEntries(db, { sinceId: a.logId })
    expect(newer.map((e) => e.logId)).toEqual([c.logId, b.logId])
    expect(await listLogEntries(db, { sinceId: c.logId })).toHaveLength(0)
  })

  it('falls back to the newest page when the since cursor has expired', async () => {
    await insertLogEntry(db, entry())
    const listed = await listLogEntries(db, { sinceId: 'lg_gone', limit: 5 })
    expect(listed).toHaveLength(1)
  })

  it('caps results at the limit', async () => {
    for (let i = 0; i < 5; i++) await insertLogEntry(db, entry())
    expect(await listLogEntries(db, { limit: 3 })).toHaveLength(3)
  })

  it('clears all logs or a single profile’s logs', async () => {
    await insertLogEntry(db, entry({ profileId: 'c1' }))
    await insertLogEntry(db, entry({ profileId: 'c2' }))

    await clearLogs(db, 'c1')
    expect(await listLogEntries(db, {})).toHaveLength(1)

    await clearLogs(db)
    expect(await listLogEntries(db, {})).toHaveLength(0)
  })

  it('deletes a profile’s logs with the profile', async () => {
    await upsertProfile(db, { profileId: 'c1', endpointScenarios: {} })
    await insertLogEntry(db, entry({ profileId: 'c1' }))
    await insertLogEntry(db, entry({ profileId: 'c2' }))

    await deleteProfile(db, 'c1')

    const remaining = await listLogEntries(db, {})
    expect(remaining).toHaveLength(1)
    expect(remaining[0].profileId).toBe('c2')
  })

  it('creates a 24h TTL index on ts and a unique logId index', async () => {
    const indexes = await db.collection('requestLogs').indexes()
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { ts: 1 }, expireAfterSeconds: 86400 }),
        expect.objectContaining({ key: { logId: 1 }, unique: true }),
        expect.objectContaining({ key: { profileId: 1, ts: -1 } }),
        expect.objectContaining({ key: { endpoint: 1, ts: -1 } }),
      ]),
    )
  })

  it('sinceId keyset does not skip entries sharing the newest millisecond', async () => {
    const ts = new Date('2026-07-07T09:00:00.000Z')
    await insertLogEntry(db, entry({ ts, logId: 'lg_k1' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_k2' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_k3' }))

    // Cursor at the lexicographically-middle id must still return the newer one.
    const newer = await listLogEntries(db, { sinceId: 'lg_k2' })
    expect(newer.map((e) => e.logId)).toEqual(['lg_k3'])
  })

  it('beforeId returns strictly-older entries, newest first', async () => {
    const a = entry({ ts: new Date('2026-07-07T09:00:01.000Z'), logId: 'lg_o1' })
    const b = entry({ ts: new Date('2026-07-07T09:00:02.000Z'), logId: 'lg_o2' })
    const c = entry({ ts: new Date('2026-07-07T09:00:03.000Z'), logId: 'lg_o3' })
    for (const e of [a, b, c]) await insertLogEntry(db, e)

    const older = await listLogEntries(db, { beforeId: 'lg_o3' })
    expect(older.map((e) => e.logId)).toEqual(['lg_o2', 'lg_o1'])
    expect(await listLogEntries(db, { beforeId: 'lg_o1' })).toHaveLength(0)
  })

  it('beforeId breaks same-millisecond ties by logId', async () => {
    const ts = new Date('2026-07-07T09:00:00.000Z')
    await insertLogEntry(db, entry({ ts, logId: 'lg_t1' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_t2' }))
    await insertLogEntry(db, entry({ ts, logId: 'lg_t3' }))

    const older = await listLogEntries(db, { beforeId: 'lg_t3' })
    expect(older.map((e) => e.logId)).toEqual(['lg_t2', 'lg_t1'])
  })

  it('unknown beforeId yields no older results', async () => {
    await insertLogEntry(db, entry())
    expect(await listLogEntries(db, { beforeId: 'lg_gone' })).toHaveLength(0)
  })

  it('unknown beforeId with a logId filter still yields no rows and does not throw', async () => {
    await insertLogEntry(db, entry({ logId: 'lg_srch_1' }))
    const rows = await listLogEntries(db, { beforeId: 'lg_gone', logIdQuery: 'lg_srch' })
    expect(rows).toHaveLength(0)
  })

  it('listLogSummaries omits payload bodies but keeps status and trace', async () => {
    await insertLogEntry(
      db,
      entry({
        request: { headers: { 'content-type': 'application/json' }, body: { big: 'x' }, truncated: false },
        response: { status: 201, headers: { 'x-a': 'b' }, body: { ok: true }, truncated: false },
        trace: { scenario: 'default', scenarioSource: 'implicit' },
      }),
    )

    const [summary] = await listLogSummaries(db, {})
    // `request` is projected out; assert absence with `in` (the type omits it).
    expect('request' in summary).toBe(false)
    expect(summary.response).toEqual({ status: 201 })
    expect(summary.trace).toEqual({ scenario: 'default', scenarioSource: 'implicit' })
    expect('_id' in summary).toBe(false)
  })

  it('getLogEntry returns the full entry or null', async () => {
    await insertLogEntry(db, entry({ logId: 'lg_full', response: { status: 200, headers: {}, body: { ok: 1 }, truncated: false } }))
    const full = await getLogEntry(db, 'lg_full')
    expect(full?.response?.body).toEqual({ ok: 1 })
    expect(await getLogEntry(db, 'lg_missing')).toBeNull()
  })
})
