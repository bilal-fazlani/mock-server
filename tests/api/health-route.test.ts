import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRuntimeMock = vi.fn()
const pingMock = vi.fn()

vi.mock('../../src/lib/runtime', () => ({ getRuntime: () => getRuntimeMock() }))
vi.mock('../../src/lib/profiles/store', () => ({
  getDb: vi.fn(async () => ({ command: pingMock })),
}))

const { GET } = await import('../../src/app/ui/api/health/route')

beforeEach(() => {
  getRuntimeMock.mockReset().mockReturnValue({})
  pingMock.mockReset().mockResolvedValue({ ok: 1 })
})

describe('GET /ui/api/health', () => {
  it('returns 200 when the runtime is built and MongoDB answers', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', mongo: 'up' })
  })

  it('returns 503 with mongo "down" when MongoDB does not answer', async () => {
    pingMock.mockRejectedValue(new Error('no servers'))
    const res = await GET()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ status: 'error', mongo: 'down', error: 'no servers' })
  })

  it('returns 503 with mongo "unchecked" when the runtime failed to build', async () => {
    getRuntimeMock.mockImplementation(() => {
      throw new Error('catalog directory not found: /app/catalog')
    })
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toMatchObject({
      status: 'error',
      mongo: 'unchecked',
      error: 'catalog directory not found: /app/catalog',
    })
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('sha')
    expect(pingMock).not.toHaveBeenCalled()
  })
})
