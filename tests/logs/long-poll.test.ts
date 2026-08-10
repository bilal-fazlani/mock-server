import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  awaitLogCount,
  DEFAULT_WAIT_MS,
  MAX_WAIT_MS,
  parseLogWait,
} from '../../src/lib/logs/long-poll'
import { insertLogEntry, type LogEntry } from '../../src/lib/logs/store'
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

let seq = 0
function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  seq += 1
  return {
    logId: `lg_wait_${seq}`,
    ts: new Date(Date.now() + seq * 1000),
    kind: 'request',
    profileId: 'c1',
    endpoint: 'hello_world',
    outcome: 'fixture',
    trace: {},
    ...overrides,
  }
}

describe('parseLogWait', () => {
  it('is undefined when neither parameter was sent', () => {
    expect(parseLogWait(null, null)).toBeUndefined()
    expect(parseLogWait('', '')).toBeUndefined()
  })

  it('defaults minCount to one new entry when only waitMs is sent', () => {
    expect(parseLogWait(null, '2500')).toEqual({ minCount: 1, waitMs: 2500 })
  })

  it('defaults waitMs to the standard window when only minCount is sent', () => {
    expect(parseLogWait('3', null)).toEqual({ minCount: 3, waitMs: DEFAULT_WAIT_MS })
  })

  it('clamps waitMs to the ceiling and minCount to at least one', () => {
    expect(parseLogWait('0', String(MAX_WAIT_MS * 10))).toEqual({
      minCount: 1,
      waitMs: MAX_WAIT_MS,
    })
    expect(parseLogWait('-5', '-1')).toEqual({ minCount: 1, waitMs: 0 })
  })

  it('falls back to the defaults on unparseable values rather than failing', () => {
    expect(parseLogWait('soon', 'forever')).toEqual({ minCount: 1, waitMs: DEFAULT_WAIT_MS })
  })

  it('keeps waitMs=0 as an explicit no-wait rather than reading it as absent', () => {
    expect(parseLogWait(null, '0')).toEqual({ minCount: 1, waitMs: 0 })
  })
})

describe('awaitLogCount', () => {
  it('returns immediately when the threshold already holds', async () => {
    await insertLogEntry(db, entry())
    await insertLogEntry(db, entry())

    const started = Date.now()
    // A long window that is never actually waited out: the first check settles it.
    expect(await awaitLogCount(db, {}, { minCount: 2, waitMs: 5_000 })).toBe(true)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('resolves once entries arrive during the wait', async () => {
    const write = setTimeout(() => void insertLogEntry(db, entry()), 120)

    try {
      expect(await awaitLogCount(db, {}, { minCount: 1, waitMs: 5_000 })).toBe(true)
    } finally {
      clearTimeout(write)
    }
  })

  it('gives up with false when the window runs out short of the threshold', async () => {
    await insertLogEntry(db, entry())

    const started = Date.now()
    expect(await awaitLogCount(db, {}, { minCount: 2, waitMs: 200 })).toBe(false)
    expect(Date.now() - started).toBeGreaterThanOrEqual(180)
  })

  it('counts only entries matching the filters', async () => {
    await insertLogEntry(db, entry({ profileId: 'c1' }))
    await insertLogEntry(db, entry({ profileId: 'c2' }))

    expect(await awaitLogCount(db, { profileId: 'c2' }, { minCount: 1, waitMs: 0 })).toBe(true)
    expect(await awaitLogCount(db, { profileId: 'c3' }, { minCount: 1, waitMs: 0 })).toBe(false)
  })

  it('counts only entries past a since cursor', async () => {
    const first = entry()
    await insertLogEntry(db, first)
    await insertLogEntry(db, entry())

    expect(await awaitLogCount(db, { sinceId: first.logId }, { minCount: 1, waitMs: 0 })).toBe(true)
    expect(await awaitLogCount(db, { sinceId: first.logId }, { minCount: 2, waitMs: 200 })).toBe(
      false,
    )
  })

  it('does not wait on a before page, whose match count cannot grow', async () => {
    const oldest = entry()
    await insertLogEntry(db, oldest)

    const started = Date.now()
    // A long window that must be ignored outright: nothing older will ever appear.
    expect(await awaitLogCount(db, { beforeId: oldest.logId }, { minCount: 1, waitMs: 30_000 })).toBe(
      false,
    )
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('stops waiting when the client disconnects', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 60)

    const started = Date.now()
    expect(await awaitLogCount(db, {}, { minCount: 1, waitMs: 30_000 }, controller.signal)).toBe(
      false,
    )
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
