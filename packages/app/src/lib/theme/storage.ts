import type { ThemeMode, ThemeVariant } from './theme'

export const THEME_STORAGE_KEY = 'codex-web-theme-selection'

export type ThemeSelection = {
  lightThemeId: string
  darkThemeId: string
  mode: ThemeMode
}

export function parseStoredThemeSelection({
  storedValue,
  availableThemeIds,
  themeVariantsById,
  defaultSelection,
}: {
  storedValue: string | null
  availableThemeIds: readonly string[]
  themeVariantsById: Readonly<Record<string, ThemeVariant>>
  defaultSelection: ThemeSelection
}): ThemeSelection {
  const currentSelection = parseCurrentSelection(storedValue, availableThemeIds, themeVariantsById)
  if (currentSelection) return currentSelection

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
