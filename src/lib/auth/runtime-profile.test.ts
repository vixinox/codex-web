import { describe, expect, it } from 'vitest'

import { requiresProfileReset } from './runtime-profile'

describe('runtime profile session reset', () => {
  it.each([
    ['owner', 'guest', undefined, true],
    ['guest', 'owner', undefined, true],
    [null, 'guest', 'owner', true],
    [null, 'owner', 'guest', true],
    ['owner', 'owner', 'owner', false],
    ['guest', 'guest', 'guest', false],
    ['guest', 'guest', 'admin', false],
    [null, 'owner', undefined, false],
  ] as const)('handles %s -> %s with user %s', (previous, current, kind, expected) => {
    expect(requiresProfileReset(previous, current, kind)).toBe(expected)
  })
})
