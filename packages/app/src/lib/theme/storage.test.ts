import { describe, expect, it } from 'vitest'

import { parseStoredThemeSelection, serializeThemeSelection } from './storage'

const defaults = {
  availableThemeIds: ['codex-light', 'codex-dark', 'xcode-light', 'xcode-dark'],
  themeVariantsById: {
    'codex-light': 'light',
    'codex-dark': 'dark',
    'xcode-light': 'light',
    'xcode-dark': 'dark',
  } as const,
  defaultSelection: { lightThemeId: 'codex-light', darkThemeId: 'codex-dark', mode: 'system' },
}

describe('theme selection storage', () => {
  it('reads and serializes two registered themes', () => {
    const selection = parseStoredThemeSelection({
      ...defaults,
      storedValue: '{"lightThemeId":"xcode-light","darkThemeId":"xcode-dark","mode":"dark"}',
    })

    expect(selection).toEqual({
      lightThemeId: 'xcode-light',
      darkThemeId: 'xcode-dark',
      mode: 'dark',
    })
    expect(serializeThemeSelection(selection)).toBe(
      '{"lightThemeId":"xcode-light","darkThemeId":"xcode-dark","mode":"dark"}',
    )
  })

  it.each([
    ['missing mode', '{"lightThemeId":"xcode-light","darkThemeId":"xcode-dark"}'],
    ['invalid mode', '{"lightThemeId":"xcode-light","darkThemeId":"xcode-dark","mode":"sepia"}'],
  ])('defaults to system for %s', (_, storedValue) => {
    expect(parseStoredThemeSelection({ ...defaults, storedValue })).toEqual({
      lightThemeId: 'xcode-light',
      darkThemeId: 'xcode-dark',
      mode: 'system',
    })
  })

  it.each([
    ['missing', null],
    ['damaged JSON', '{'],
    ['single-theme format', '{"themeId":"xcode-dark"}'],
    ['unknown theme', '{"lightThemeId":"codex-web","darkThemeId":"codex-dark"}'],
    ['mismatched variants', '{"lightThemeId":"codex-dark","darkThemeId":"codex-light"}'],
  ])('uses the current default for %s storage', (_, storedValue) => {
    expect(parseStoredThemeSelection({ ...defaults, storedValue })).toEqual(
      defaults.defaultSelection,
    )
  })
})
