import { describe, expect, it } from 'vitest'
import { codexTimestampSecondsToMs } from './thread-presentation'

describe('Thread presentation timestamps', () => {
  it('converts Codex Unix seconds to browser milliseconds', () => {
    expect(codexTimestampSecondsToMs(1_780_000_000)).toBe(1_780_000_000_000)
  })
})
