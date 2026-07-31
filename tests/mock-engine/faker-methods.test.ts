import { describe, expect, it } from 'vitest'
import { Faker, en } from '@faker-js/faker'
import { EXPOSED_FAKER_MODULES, resolveFakerMethod } from '../../src/lib/mock-engine/faker-methods'

const fn = () => new Faker({ locale: [en] })

describe('resolveFakerMethod (#15)', () => {
  it('resolves a zero-arg data method', () => {
    const f = fn()
    f.seed(1)
    const m = resolveFakerMethod(f, 'person.firstName')
    expect(m).not.toBeNull()
    expect(typeof m!([])).toBe('string')
  })

  it('maps number.int positional args onto the options object', () => {
    const f = fn()
    f.seed(1)
    const m = resolveFakerMethod(f, 'number.int')
    expect(m).not.toBeNull()
    const v = m!([1, 100]) as number
    expect(v).toBeGreaterThanOrEqual(1)
    expect(v).toBeLessThanOrEqual(100)
  })

  it('maps number.float positional args onto the options object', () => {
    const f = fn()
    f.seed(1)
    const m = resolveFakerMethod(f, 'number.float')
    expect(m).not.toBeNull()
    const v = m!([1, 2]) as number
    expect(v).toBeGreaterThanOrEqual(1)
    expect(v).toBeLessThanOrEqual(2)
  })

  it('maps string.alphanumeric/alpha/numeric a length arg', () => {
    const f = fn()
    f.seed(1)
    const alnum = resolveFakerMethod(f, 'string.alphanumeric')!([5]) as string
    expect(alnum).toHaveLength(5)
    const alpha = resolveFakerMethod(f, 'string.alpha')!([4]) as string
    expect(alpha).toHaveLength(4)
    const numeric = resolveFakerMethod(f, 'string.numeric')!([6]) as string
    expect(numeric).toHaveLength(6)
  })

  it('maps lorem.words/sentences a count arg', () => {
    const f = fn()
    f.seed(1)
    const words = resolveFakerMethod(f, 'lorem.words')!([3]) as string
    expect(words.split(' ')).toHaveLength(3)
  })

  it('rejects a helpers/utility method (not a data module)', () => {
    expect(resolveFakerMethod(fn(), 'helpers.arrayElement')).toBeNull()
  })

  it('rejects the image module (not in the allowlist)', () => {
    expect(resolveFakerMethod(fn(), 'image.avatar')).toBeNull()
  })

  it('rejects an unknown module', () => {
    expect(resolveFakerMethod(fn(), 'bogus.thing')).toBeNull()
  })

  it('rejects an unknown method on a known module', () => {
    expect(resolveFakerMethod(fn(), 'person.noSuchThing')).toBeNull()
  })

  it('rejects a path with no dot', () => {
    expect(resolveFakerMethod(fn(), 'person')).toBeNull()
  })

  it('EXPOSED_FAKER_MODULES excludes helpers and image', () => {
    expect(EXPOSED_FAKER_MODULES.has('helpers')).toBe(false)
    expect(EXPOSED_FAKER_MODULES.has('image')).toBe(false)
    expect(EXPOSED_FAKER_MODULES.has('person')).toBe(true)
  })

  it('rejects an inherited Object.prototype member masquerading as a method (toString)', () => {
    expect(resolveFakerMethod(fn(), 'person.toString')).toBeNull()
  })

  it('rejects an inherited Object.prototype member masquerading as a method (constructor)', () => {
    expect(resolveFakerMethod(fn(), 'person.constructor')).toBeNull()
  })
})
