import { Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  clearLogs,
  getLogEntry,
  insertLogEntry,
  listLogEntries,
  listLogSummaries,
  parseValidationFilter,
  VALIDATION_FILTERS,
  type LogEntry,
  type ListLogsOptions,
  type ValidationFilter,
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

  describe('traceId filter', () => {
    const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
    const idsFor = async (traceId: string): Promise<string[]> =>
      (await listLogEntries(db, { traceId })).map((e) => e.logId)

    it('matches only the entry carrying that exact traceId', async () => {
      await insertLogEntry(db, entry({ logId: 'lg_tr1', traceId: TRACE_ID }))
      await insertLogEntry(db, entry({ logId: 'lg_tr2', traceId: 'req-42' }))
      await insertLogEntry(db, entry({ logId: 'lg_tr3' })) // no trace header on this one

      expect(await idsFor(TRACE_ID)).toEqual(['lg_tr1'])
      expect(await idsFor('req-42')).toEqual(['lg_tr2'])
    })

    it('matches nothing for a traceId no entry carries', async () => {
      await insertLogEntry(db, entry({ traceId: TRACE_ID }))
      expect(await idsFor('does-not-exist')).toHaveLength(0)
    })

    it('is an exact match, not a prefix — unlike logIdQuery', async () => {
      await insertLogEntry(db, entry({ traceId: TRACE_ID }))
      expect(await idsFor('0af765')).toHaveLength(0)
    })

    it('composes with the profile filter as an AND, not either alone', async () => {
      // Three rows so neither filter alone would land on the same answer as
      // the pair: (A) matches both, (B) shares A's profile but not its trace,
      // (C) shares A's trace but not its profile.
      await insertLogEntry(
        db,
        entry({ logId: 'lg_trc_a', profileId: 'c1', traceId: 'shared-trace' }),
      )
      await insertLogEntry(
        db,
        entry({ logId: 'lg_trc_b', profileId: 'c1', traceId: 'other-trace' }),
      )
      await insertLogEntry(
        db,
        entry({ logId: 'lg_trc_c', profileId: 'c2', traceId: 'shared-trace' }),
      )

      const ids = async (options: ListLogsOptions): Promise<string[]> =>
        (await listLogEntries(db, options)).map((e) => e.logId).sort()

      // Either filter alone pulls in the row the other would have excluded —
      // proving the composed query is narrower than each half, not just
      // reproducing whichever filter happens to be more selective.
      expect(await ids({ profileId: 'c1' })).toEqual(['lg_trc_a', 'lg_trc_b'])
      expect(await ids({ traceId: 'shared-trace' })).toEqual(['lg_trc_a', 'lg_trc_c'])
      expect(await ids({ profileId: 'c1', traceId: 'shared-trace' })).toEqual(['lg_trc_a'])
    })
  })

  describe('validation filter', () => {
    // One entry per distinguishable validation state, so every filter can be
    // asserted against the same fixed set.
    async function seedValidationStates(): Promise<void> {
      const states: Array<[string, LogEntry['trace']['validation']]> = [
        ['lg_v_reqfail', { request: 'failed', issues: { request: { list: [{ path: '/amount', message: 'must be number' }], total: 1 } } }],
        ['lg_v_resfail', { response: 'failed' }],
        ['lg_v_reqdrift', { request: 'drift_warning' }],
        ['lg_v_resdrift', { request: 'ok', response: 'drift_warning' }],
        ['lg_v_ok', { request: 'ok', response: 'ok' }],
        ['lg_v_reqok', { request: 'ok' }],
        ['lg_v_none', undefined],
      ]
      for (const [logId, validation] of states) {
        await insertLogEntry(
          db,
          entry({ logId, trace: { scenario: 'default', ...(validation && { validation }) } }),
        )
      }
    }

    const ids = async (validation: ValidationFilter): Promise<string[]> =>
      (await listLogEntries(db, { validation })).map((e) => e.logId).sort()

    it('narrows to failures, drift, both, passes, and never-checked', async () => {
      await seedValidationStates()

      expect(await ids('failed')).toEqual(['lg_v_reqfail', 'lg_v_resfail'])
      expect(await ids('drift')).toEqual(['lg_v_reqdrift', 'lg_v_resdrift'])
      expect(await ids('issues')).toEqual([
        'lg_v_reqdrift',
        'lg_v_reqfail',
        'lg_v_resdrift',
        'lg_v_resfail',
      ])
      // `lg_v_resdrift` has request: 'ok' but a drifting response — a problem
      // anywhere disqualifies it from "ok".
      expect(await ids('ok')).toEqual(['lg_v_ok', 'lg_v_reqok'])
      expect(await ids('unchecked')).toEqual(['lg_v_none'])
    })

    it('composes with the other filters and with a keyset cursor', async () => {
      await insertLogEntry(
        db,
        entry({ logId: 'lg_c1', profileId: 'c1', trace: { validation: { request: 'failed' } } }),
      )
      await insertLogEntry(
        db,
        entry({ logId: 'lg_c2', profileId: 'c2', trace: { validation: { request: 'failed' } } }),
      )
      await insertLogEntry(
        db,
        entry({ logId: 'lg_c3', profileId: 'c1', trace: { validation: { request: 'failed' } } }),
      )

      expect(
        (await listLogEntries(db, { validation: 'failed', profileId: 'c1' })).map((e) => e.logId),
      ).toEqual(['lg_c3', 'lg_c1'])
      // Both the validation clause and the cursor carry an `$or`; neither may
      // clobber the other.
      expect(
        (await listLogEntries(db, { validation: 'failed', beforeId: 'lg_c3' })).map((e) => e.logId),
      ).toEqual(['lg_c2', 'lg_c1'])
    })

    it('parses only the known filter names, ignoring anything else', () => {
      for (const name of VALIDATION_FILTERS) expect(parseValidationFilter(name)).toBe(name)
      expect(parseValidationFilter('drift_warning')).toBeUndefined()
      expect(parseValidationFilter('')).toBeUndefined()
      expect(parseValidationFilter(null)).toBeUndefined()
    })

    it('drops the issue lists from summaries but keeps the totals', async () => {
      await seedValidationStates()
      const [summary] = await listLogSummaries(db, { validation: 'failed', logIdQuery: 'lg_v_reqfail' })
      expect(summary.trace.validation?.request).toBe('failed')
      expect(summary.trace.validation?.issues?.request).toEqual({ total: 1 })

      const full = await getLogEntry(db, 'lg_v_reqfail')
      expect(full?.trace.validation?.issues?.request?.list).toEqual([
        { path: '/amount', message: 'must be number' },
      ])
    })
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

  // Regression: the unfiltered first-page/live list sorts by { ts: -1, logId: -1 }.
  // Without a matching compound index Mongo COLLSCANs the whole collection into a
  // blocking in-memory SORT — cheap on a tiny test set but ~13s against a real 24h
  // collection. Assert the plan is index-ordered (IXSCAN, no SORT stage) so the
  // supporting index is never dropped.
  it('serves the unfiltered first page from an index without a blocking sort', async () => {
    for (let i = 0; i < 50; i++) await insertLogEntry(db, entry())

    const plan = await db
      .collection('requestLogs')
      .find({}, { projection: { _id: 0, request: 0 } })
      .sort({ ts: -1, logId: -1 })
      .limit(100)
      .explain('executionStats')

    const stages: string[] = []
    for (let s = plan.queryPlanner.winningPlan; s; s = s.inputStage) {
      if (s.stage) stages.push(s.stage)
    }
    expect(stages).toContain('IXSCAN')
    expect(stages).not.toContain('SORT')
    expect(stages).not.toContain('COLLSCAN')
    // An index-ordered plan fetches only up to `limit` docs, not the whole set.
    expect(plan.executionStats.totalDocsExamined).toBeLessThanOrEqual(100)
  })
})
