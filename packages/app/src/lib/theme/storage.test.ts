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
      legacyStoredValue: null,
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
    expect(
      parseStoredThemeSelection({ ...defaults, storedValue, legacyStoredValue: null }),
    ).toEqual({ lightThemeId: 'xcode-light', darkThemeId: 'xcode-dark', mode: 'system' })
  })

  it.each([
    ['missing', null, null],
    ['damaged JSON', '{', null],
    ['unknown theme', '{"lightThemeId":"codex-web","darkThemeId":"codex-dark"}', null],
    ['mismatched variants', '{"lightThemeId":"codex-dark","darkThemeId":"codex-light"}', null],
  ])('uses the current default for %s storage', (_, storedValue) => {
    expect(
      parseStoredThemeSelection({ ...defaults, storedValue, legacyStoredValue: null }),
    ).toEqual(defaults.defaultSelection)
  })

  it.each([
    [
      'light',
      '{"themeId":"xcode-light"}',
      { lightThemeId: 'xcode-light', darkThemeId: 'codex-dark', mode: 'system' },
    ],
    [
      'dark',
      '{"themeId":"xcode-dark"}',
      { lightThemeId: 'codex-light', darkThemeId: 'xcode-dark', mode: 'system' },
    ],
  ])('migrates a legacy %s selection', (_, legacyStoredValue, expected) => {
    expect(
      parseStoredThemeSelection({ ...defaults, storedValue: null, legacyStoredValue }),
    ).toEqual(expected)
  })
})
