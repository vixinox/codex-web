import { describe, expect, it } from 'vitest'

import {
  GUEST_FIXTURE_CAPACITY,
  GUEST_FIXTURE_SKILLS,
  freshGuestFixtureThreads,
} from './guest-fixtures'

describe('guest fixtures', () => {
  it('starts with no guest threads for every workspace mount', () => {
    expect(freshGuestFixtureThreads()).toEqual([])
    expect(freshGuestFixtureThreads()).not.toBe(freshGuestFixtureThreads())
  })

  it('exposes only deterministic fixture skills and capacity values', () => {
    expect(GUEST_FIXTURE_SKILLS).toHaveLength(3)
    expect(GUEST_FIXTURE_SKILLS.every((skill) => skill.handle.startsWith('guest-fixture:'))).toBe(
      true,
    )
    expect(GUEST_FIXTURE_CAPACITY.globalDailyTokenUsed).toBeLessThan(
      GUEST_FIXTURE_CAPACITY.globalDailyTokenLimit,
    )
    expect(GUEST_FIXTURE_CAPACITY.perGuestDailyTokenUsed).toBeLessThan(
      GUEST_FIXTURE_CAPACITY.perGuestDailyTokenLimit,
    )
  })
})
