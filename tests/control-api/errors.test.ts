import { describe, expect, it } from 'vitest'
import { errorResponse } from '../../src/lib/control-api/errors'

describe('errorResponse', () => {
  it('builds the { error, code } envelope with the given status', async () => {
    const res = errorResponse('scenario "foo" is not declared', 'scenario_not_declared', 400)
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({
      error: 'scenario "foo" is not declared',
      code: 'scenario_not_declared',
    })
  })

  it('carries the status through unchanged for a 404', async () => {
    const res = errorResponse('unknown endpoint a/b', 'unknown_endpoint', 404)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown endpoint a/b', code: 'unknown_endpoint' })
  })
})
