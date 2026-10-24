import type { ThemeMode, ThemeVariant } from './theme'

export const THEME_STORAGE_KEY = 'codex-web-theme-selection-v2'
export const LEGACY_THEME_STORAGE_KEY = 'codex-web-theme-selection-v1'

export type ThemeSelection = {
  lightThemeId: string
  darkThemeId: string
  mode: ThemeMode
}

export function parseStoredThemeSelection({
  storedValue,
  legacyStoredValue,
  availableThemeIds,
  themeVariantsById,
  defaultSelection,
}: {
  storedValue: string | null
  legacyStoredValue: string | null
  availableThemeIds: readonly string[]
  themeVariantsById: Readonly<Record<string, ThemeVariant>>
  defaultSelection: ThemeSelection
}): ThemeSelection {
  const currentSelection = parseCurrentSelection(storedValue, availableThemeIds, themeVariantsById)
  if (currentSelection) return currentSelection

  const legacyThemeId = parseLegacyThemeId(legacyStoredValue, availableThemeIds)
  if (legacyThemeId) {
    const variant = themeVariantsById[legacyThemeId]
    if (variant === 'light')
      return { ...defaultSelection, lightThemeId: legacyThemeId, mode: 'system' }
    if (variant === 'dark')
      return { ...defaultSelection, darkThemeId: legacyThemeId, mode: 'system' }
  }

  return { ...defaultSelection }
}

export function serializeThemeSelection(selection: ThemeSelection) {
  return JSON.stringify(selection)
}

function parseCurrentSelection(
  storedValue: string | null,
  availableThemeIds: readonly string[],
  themeVariantsById: Readonly<Record<string, ThemeVariant>>,
) {
  if (storedValue === null) return undefined

  try {
    const candidate = JSON.parse(storedValue) as Record<string, unknown>
    if (
      typeof candidate.lightThemeId === 'string' &&
      typeof candidate.darkThemeId === 'string' &&
      availableThemeIds.includes(candidate.lightThemeId) &&
      availableThemeIds.includes(candidate.darkThemeId) &&
      themeVariantsById[candidate.lightThemeId] === 'light' &&
      themeVariantsById[candidate.darkThemeId] === 'dark'
    ) {
      return {
        lightThemeId: candidate.lightThemeId,
        darkThemeId: candidate.darkThemeId,
        mode: isThemeMode(candidate.mode) ? candidate.mode : 'system',
      }
    }
  } catch {
    // Invalid local data uses the current default theme.
  }

  return undefined
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function parseLegacyThemeId(storedValue: string | null, availableThemeIds: readonly string[]) {
  if (storedValue === null) return undefined

  try {
    const candidate = JSON.parse(storedValue) as Record<string, unknown>
    if (typeof candidate.themeId === 'string' && availableThemeIds.includes(candidate.themeId)) {
      return candidate.themeId
    }
  } catch {
    // Invalid legacy local data uses the current default theme.
  }

  return undefined
}
