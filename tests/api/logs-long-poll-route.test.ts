import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertLogEntry, type LogEntry } from '../../src/lib/logs/store'
import { ensureIndexes } from '../../src/lib/profiles/store'

// The rest of the logs-route suite stubs the store to assert wiring in isolation;
// this file deliberately does the opposite — real query parsing, real filters,
// real Mongo — because the feature's whole promise is that a request held open
// answers when a matching entry actually lands.
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

vi.mock('../../src/lib/profiles/store', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/lib/profiles/store')>(
      '../../src/lib/profiles/store',
    )
  return { ...actual, getDb: async () => db }
})

const route = await import('../../src/app/ui/api/logs/route')

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
    logId: `lg_e2e_${seq}`,
    ts: new Date(Date.now() + seq * 1000),
    kind: 'request',
    profileId: 'customer-123',
    endpoint: 'charge',
    outcome: 'fixture',
    trace: {},
    ...overrides,
  }
}

const get = (query: string): Promise<Response> =>
  route.GET(new Request(`http://x/ui/api/logs${query}`))

describe('GET /ui/api/logs long-poll, end to end', () => {
  it('answers when the awaited call lands mid-request', async () => {
    const write = setTimeout(() => void insertLogEntry(db, entry()), 120)

    try {
      const body = await (
        await get('?profile=customer-123&endpoint=charge&minCount=1&waitMs=5000')
      ).json()

      expect(body.matched).toBe(true)
      expect(body.entries).toHaveLength(1)
      expect(body.entries[0].endpoint).toBe('charge')
    } finally {
      clearTimeout(write)
    }
  })

  it('counts only entries the filters keep, not every logged call', async () => {
    await insertLogEntry(db, entry({ endpoint: 'refund' }))

    const body = await (await get('?endpoint=charge&minCount=1&waitMs=150')).json()

    expect(body.matched).toBe(false)
    expect(body.entries).toEqual([])
  })

  it('times out with the partial page rather than an error', async () => {
    await insertLogEntry(db, entry())
    await insertLogEntry(db, entry())

    const res = await get('?profile=customer-123&minCount=5&waitMs=150')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.matched).toBe(false)
    expect(body.entries).toHaveLength(2)
  })

  it('reports matched even when the threshold exceeds the page limit', async () => {
    for (let i = 0; i < 3; i += 1) await insertLogEntry(db, entry())

    // `limit=1` caps the page at one row, so only `matched` can answer whether
    // three calls actually landed — this is why the flag exists.
    const body = await (await get('?profile=customer-123&minCount=3&waitMs=1000&limit=1')).json()

    expect(body.matched).toBe(true)
    expect(body.entries).toHaveLength(1)
  })

  it('waits only for entries newer than a since cursor', async () => {
    const first = entry()
    await insertLogEntry(db, first)
    const write = setTimeout(() => void insertLogEntry(db, entry()), 120)

    try {
      const body = await (await get(`?since=${first.logId}&waitMs=5000`)).json()

      expect(body.matched).toBe(true)
      expect(body.entries.map((e: LogEntry) => e.logId)).not.toContain(first.logId)
    } finally {
      clearTimeout(write)
    }
  })

  it('leaves an ordinary listing untouched — no wait, no matched flag', async () => {
    await insertLogEntry(db, entry())

    const body = await (await get('?profile=customer-123')).json()

    expect(body).not.toHaveProperty('matched')
    expect(body.entries).toHaveLength(1)
  })
})
