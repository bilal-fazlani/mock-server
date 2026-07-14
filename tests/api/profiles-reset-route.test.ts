import { beforeEach, describe, expect, it, vi } from 'vitest'

const resetScenarioProgressMock = vi.fn()
const resetDynamicHistoryMock = vi.fn()
const writeAdminLogMock = vi.fn()

vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({})),
  resetScenarioProgress: (...a: unknown[]) => resetScenarioProgressMock(...a),
}))
vi.mock('../../src/lib/dynamic/history-store', () => ({
  resetDynamicHistory: (...a: unknown[]) => resetDynamicHistoryMock(...a),
}))
vi.mock('../../src/lib/logs/admin-log', () => ({
  writeAdminLog: (...a: unknown[]) => writeAdminLogMock(...a),
}))

const route = await import('../../src/app/ui/api/profiles/[profileId]/reset/route')
const params = (profileId: string) => ({ params: Promise.resolve({ profileId }) })

beforeEach(() => {
  resetScenarioProgressMock.mockReset()
  resetDynamicHistoryMock.mockReset()
  writeAdminLogMock.mockReset()
})

describe('POST /ui/api/profiles/{id}/reset', () => {
  it('resets a single endpoint when given one', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ endpoint: 'hello_world' }) })
    const res = await route.POST(req, params('c1'))
    expect(res.status).toBe(204)
    expect(resetScenarioProgressMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'hello_world')
    expect(resetDynamicHistoryMock).toHaveBeenCalledWith(expect.anything(), 'profile', 'c1', 'hello_world')
    expect(writeAdminLogMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'progress_reset', 'hello_world')
  })

  it('resets the whole profile when no endpoint and no body', async () => {
    const res = await route.POST(new Request('http://x', { method: 'POST' }), params('c1'))
    expect(res.status).toBe(204)
    expect(resetScenarioProgressMock).toHaveBeenCalledWith(expect.anything(), 'c1', undefined)
    expect(resetDynamicHistoryMock).toHaveBeenCalledWith(expect.anything(), 'profile', 'c1', undefined)
    expect(writeAdminLogMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'progress_reset', undefined)
  })

  it('treats malformed JSON as a whole-profile reset', async () => {
    const res = await route.POST(new Request('http://x', { method: 'POST', body: '{bad' }), params('c1'))
    expect(res.status).toBe(204)
    expect(resetScenarioProgressMock).toHaveBeenCalledWith(expect.anything(), 'c1', undefined)
  })
})
