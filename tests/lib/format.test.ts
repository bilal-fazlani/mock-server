import { describe, expect, it } from 'vitest'
import { formatUtc } from '../../src/lib/format'

describe('formatUtc', () => {
  it('formats as YYYY-MM-DD HH:mm UTC', () => {
    expect(formatUtc(new Date('2026-07-03T14:05:33.123Z'))).toBe('2026-07-03 14:05 UTC')
  })
})
