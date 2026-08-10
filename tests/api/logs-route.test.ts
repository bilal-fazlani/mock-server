import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry, LogSummary } from '../../src/lib/logs/store'

const listLogSummariesMock = vi.fn()
const listLogEntriesMock = vi.fn()
const getLogEntryMock = vi.fn()

vi.mock('../../src/lib/logs/store', async () => {
  // `parseValidationFilter` is a real pure export the route also calls on
  // every request; keep it live rather than re-faking its rules here.
  const actual =
    await vi.importActual<typeof import('../../src/lib/logs/store')>('../../src/lib/logs/store')
  return {
    ...actual,
    listLogSummaries: (...a: unknown[]) => listLogSummariesMock(...a),
    listLogEntries: (...a: unknown[]) => listLogEntriesMock(...a),
    getLogEntry: (...a: unknown[]) => getLogEntryMock(...a),
  }
})
vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
}))

// The wait itself is exercised against real Mongo in tests/logs/long-poll.test.ts;
// here only its wiring into the route matters, so the loop is stubbed out and
// `parseLogWait` — a pure function the route calls on every request — stays live.
const awaitLogCountMock = vi.fn()
vi.mock('../../src/lib/logs/long-poll', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/lib/logs/long-poll')>(
      '../../src/lib/logs/long-poll',
    )
  return { ...actual, awaitLogCount: (...a: unknown[]) => awaitLogCountMock(...a) }
})

const listRoute = await import('../../src/app/ui/api/logs/route')
const entryRoute = await import('../../src/app/ui/api/logs/[logId]/route')

const TS = new Date('2026-07-07T09:00:00.000Z')

function summary(overrides: Partial<LogSummary> = {}): LogSummary {
  return {
    logId: 'lg_1',
    ts: TS,
    kind: 'request',
    outcome: 'fixture',
    trace: { scenario: 'default' },
    response: { status: 200 },
    ...overrides,
  }
}

function fullEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    logId: 'lg_1',
    ts: TS,
    kind: 'request',
    outcome: 'fixture',
    trace: { scenario: 'default' },
    request: { headers: { 'content-type': 'application/json' }, body: { amount: 10 }, truncated: false },
    response: { status: 200, headers: {}, body: { ok: true }, truncated: false },
    ...overrides,
  }
}

const params = (logId: string) => ({ params: Promise.resolve({ logId }) })

beforeEach(() => {
  listLogSummariesMock.mockReset().mockResolvedValue([summary()])
  listLogEntriesMock.mockReset().mockResolvedValue([fullEntry()])
  getLogEntryMock.mockReset()
  awaitLogCountMock.mockReset().mockResolvedValue(true)
})

describe('GET /ui/api/logs', () => {
  it('defaults to the summary projection', async () => {
    const res = await listRoute.GET(new Request('http://x/ui/api/logs'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(listLogSummariesMock).toHaveBeenCalledTimes(1)
    expect(listLogEntriesMock).not.toHaveBeenCalled()
    expect(body.entries).toEqual([{ ...summary(), ts: TS.toISOString() }])
    expect('request' in body.entries[0]).toBe(false)
  })

  it('returns summaries mapped to their view shape', async () => {
    listLogSummariesMock.mockResolvedValue([
      { logId: 'lg_2', ts: TS, kind: 'request', outcome: 'fixture', trace: {} },
    ])
    const res = await listRoute.GET(new Request('http://x/ui/api/logs'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      entries: [{ logId: 'lg_2', ts: TS.toISOString(), kind: 'request', outcome: 'fixture', trace: {} }],
    })
  })

  it('carries full request/response payloads when include=full', async () => {
    const res = await listRoute.GET(new Request('http://x/ui/api/logs?include=full'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(listLogEntriesMock).toHaveBeenCalledTimes(1)
    expect(listLogSummariesMock).not.toHaveBeenCalled()
    expect(Array.isArray(body.entries)).toBe(true)
    expect(body.entries).toEqual([{ ...fullEntry(), ts: TS.toISOString() }])
    expect(body.entries[0].request).toEqual({
      headers: { 'content-type': 'application/json' },
      body: { amount: 10 },
      truncated: false,
    })
    expect(body.entries[0].response).toEqual({
      status: 200,
      headers: {},
      body: { ok: true },
      truncated: false,
    })
  })

  it('ignores an unrecognised include value and keeps the summary projection', async () => {
    const res = await listRoute.GET(new Request('http://x/ui/api/logs?include=everything'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(listLogSummariesMock).toHaveBeenCalledTimes(1)
    expect(listLogEntriesMock).not.toHaveBeenCalled()
    expect('request' in body.entries[0]).toBe(false)
  })

  it('passes traceId through as an exact-match option', async () => {
    await listRoute.GET(new Request('http://x/ui/api/logs?traceId=0af7651916cd43dd8448eb211c80319c'))

    expect(listLogSummariesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ traceId: '0af7651916cd43dd8448eb211c80319c' }),
    )
  })

  it('wires traceId through on the include=full path too', async () => {
    await listRoute.GET(
      new Request(
        'http://x/ui/api/logs?include=full&traceId=0af7651916cd43dd8448eb211c80319c',
      ),
    )

    expect(listLogEntriesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ traceId: '0af7651916cd43dd8448eb211c80319c' }),
    )
  })
})

describe('GET /ui/api/logs long-poll', () => {
  it('does not wait, and reports no `matched`, on an ordinary listing', async () => {
    const res = await listRoute.GET(new Request('http://x/ui/api/logs?profile=c1'))

    expect(awaitLogCountMock).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ entries: [{ ...summary(), ts: TS.toISOString() }] })
  })

  it('waits for the threshold and reports that it was reached', async () => {
    const res = await listRoute.GET(
      new Request('http://x/ui/api/logs?endpoint=charge&minCount=3&waitMs=5000'),
    )
    const body = await res.json()

    expect(awaitLogCountMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ endpoint: 'charge' }),
      { minCount: 3, waitMs: 5000 },
      expect.anything(),
    )
    expect(body.matched).toBe(true)
    expect(body.entries).toHaveLength(1)
  })

  it('reports matched=false when the window ran out, still returning what matched', async () => {
    awaitLogCountMock.mockResolvedValue(false)
    const res = await listRoute.GET(new Request('http://x/ui/api/logs?minCount=9&waitMs=50'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.matched).toBe(false)
    expect(body.entries).toEqual([{ ...summary(), ts: TS.toISOString() }])
  })

  it('treats waitMs alone as a long-poll for a single new entry', async () => {
    await listRoute.GET(new Request('http://x/ui/api/logs?since=lg_1&waitMs=2500'))

    expect(awaitLogCountMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sinceId: 'lg_1' }),
      { minCount: 1, waitMs: 2500 },
      expect.anything(),
    )
  })

  it('waits before listing, so the page reflects the entries it waited for', async () => {
    const order: string[] = []
    awaitLogCountMock.mockImplementation(async () => {
      order.push('wait')
      return true
    })
    listLogSummariesMock.mockImplementation(async () => {
      order.push('list')
      return [summary()]
    })

    await listRoute.GET(new Request('http://x/ui/api/logs?minCount=2'))

    expect(order).toEqual(['wait', 'list'])
  })

  it('waits on the include=full path too', async () => {
    const res = await listRoute.GET(new Request('http://x/ui/api/logs?include=full&minCount=2'))

    expect(awaitLogCountMock).toHaveBeenCalledTimes(1)
    expect(listLogEntriesMock).toHaveBeenCalledTimes(1)
    expect((await res.json()).matched).toBe(true)
  })
})

describe('GET /ui/api/logs/{logId}', () => {
  it('returns the entry', async () => {
    getLogEntryMock.mockResolvedValue(fullEntry())
    const res = await entryRoute.GET(new Request('http://x'), params('lg_1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entry).toEqual({ ...fullEntry(), ts: TS.toISOString() })
  })

  // The detail route had no test coverage at all before this change added
  // the `code` field to its 404.
  it('404s with a stable code when no entry has that ID', async () => {
    getLogEntryMock.mockResolvedValue(null)
    const res = await entryRoute.GET(new Request('http://x'), params('lg_ghost'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found', code: 'log_not_found' })
  })
})
