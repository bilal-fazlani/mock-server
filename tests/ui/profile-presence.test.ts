import { describe, expect, it } from 'vitest'
import { profileWasMissing } from '../../src/app/ui/logs/profile-presence'

describe('profileWasMissing', () => {
  it('flags a profile the unmocked-user policy stood in for', () => {
    // UNMOCKED_USERS=DEFAULT_MOCK / REAL: served anyway, source records why.
    expect(
      profileWasMissing({ profileId: 'test1', trace: { scenarioSource: 'unmocked_policy' } }),
    ).toBe(true)
  })

  it('flags a request the ERROR policy rejected outright', () => {
    expect(
      profileWasMissing({
        profileId: 'test1',
        trace: {},
        error: { code: 'profile_not_found', message: 'profile "test1" not found' },
      }),
    ).toBe(true)
  })

  it('leaves a profile that resolved normally alone', () => {
    for (const scenarioSource of ['pin', 'sequence', 'implicit', 'global'] as const) {
      expect(profileWasMissing({ profileId: 'test', trace: { scenarioSource } })).toBe(false)
    }
  })

  it('does not flag an unrelated error', () => {
    expect(
      profileWasMissing({
        profileId: 'test',
        trace: {},
        error: { code: 'no_match', message: 'no endpoint matched' },
      }),
    ).toBe(false)
  })

  it('is false when the entry names no profile at all', () => {
    // Global endpoints and unmatched requests never resolve one.
    expect(profileWasMissing({ trace: { scenarioSource: 'unmocked_policy' } })).toBe(false)
    expect(profileWasMissing({ trace: {} })).toBe(false)
  })

  it('leaves admin entries linked — a profile save proves the profile exists', () => {
    expect(profileWasMissing({ profileId: 'test', trace: { adminAction: 'profile_saved' } })).toBe(
      false,
    )
  })
})
