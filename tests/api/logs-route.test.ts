import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogEntry, LogSummary } from '../../src/lib/logs/store'

const listLogSummariesMock = vi.fn()
const listLogEntriesMock = vi.fn()

vi.mock('../../src/lib/logs/store', async () => {
  // `parseValidationFilter` is a real pure export the route also calls on
  // every request; keep it live rather than re-faking its rules here.
  const actual =
    await vi.importActual<typeof import('../../src/lib/logs/store')>('../../src/lib/logs/store')
  return {
    ...actual,
    listLogSummaries: (...a: unknown[]) => listLogSummariesMock(...a),
    listLogEntries: (...a: unknown[]) => listLogEntriesMock(...a),
  }
})
vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
}))

const { GET } = await import('../../src/app/ui/api/logs/route')

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

beforeEach(() => {
  listLogSummariesMock.mockReset().mockResolvedValue([summary()])
  listLogEntriesMock.mockReset().mockResolvedValue([fullEntry()])
})

describe('GET /ui/api/logs', () => {
  it('defaults to the summary projection', async () => {
    const res = await GET(new Request('http://x/ui/api/logs'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(listLogSummariesMock).toHaveBeenCalledTimes(1)
    expect(listLogEntriesMock).not.toHaveBeenCalled()
    expect(body.entries).toEqual([{ ...summary(), ts: TS.toISOString() }])
    expect('request' in body.entries[0]).toBe(false)
  })

  it('carries full request/response payloads when include=full', async () => {
    const res = await GET(new Request('http://x/ui/api/logs?include=full'))
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
    const res = await GET(new Request('http://x/ui/api/logs?include=everything'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(listLogSummariesMock).toHaveBeenCalledTimes(1)
    expect(listLogEntriesMock).not.toHaveBeenCalled()
    expect('request' in body.entries[0]).toBe(false)
  })

  it('passes traceId through as an exact-match option', async () => {
    await GET(new Request('http://x/ui/api/logs?traceId=0af7651916cd43dd8448eb211c80319c'))

    expect(listLogSummariesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ traceId: '0af7651916cd43dd8448eb211c80319c' }),
    )
  })

  it('wires traceId through on the include=full path too', async () => {
    await GET(
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
