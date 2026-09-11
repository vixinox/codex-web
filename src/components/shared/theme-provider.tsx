/* eslint-disable react-refresh/only-export-components */
import * as React from 'react'

import {
  applyResolvedTheme,
  resolveTheme,
  type ThemeMode,
  type ThemeVariant,
} from '@/lib/theme/theme'
import {
  DEFAULT_THEME_SELECTION,
  getRegisteredTheme,
  THEME_REGISTRY,
  THEME_VARIANTS_BY_ID,
} from '@/lib/theme/registry'
import {
  LEGACY_THEME_STORAGE_KEY,
  parseStoredThemeSelection,
  serializeThemeSelection,
  THEME_STORAGE_KEY,
  type ThemeSelection,
} from '@/lib/theme/storage'

type ThemeProviderProps = {
  children: React.ReactNode
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  themeId: string
  mode: ThemeMode
  resolvedVariant: ThemeVariant
  lightThemeId: string
  darkThemeId: string
  themes: typeof THEME_REGISTRY
  setMode: (mode: ThemeMode) => void
  setThemeForVariant: (variant: ThemeVariant, themeId: string) => void
}

const AVAILABLE_THEME_IDS = THEME_REGISTRY.map((theme) => theme.id)
const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined)
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

function readSelection(): ThemeSelection {
  return parseStoredThemeSelection({
    storedValue: localStorage.getItem(THEME_STORAGE_KEY),
    legacyStoredValue: localStorage.getItem(LEGACY_THEME_STORAGE_KEY),
    availableThemeIds: AVAILABLE_THEME_IDS,
    themeVariantsById: THEME_VARIANTS_BY_ID,
    defaultSelection: DEFAULT_THEME_SELECTION,
  })
}

function getSystemVariant(): ThemeVariant {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light'
}

function disableTransitionsTemporarily() {
  const style = document.createElement('style')
  style.appendChild(
    document.createTextNode(
      '*,*::before,*::after{-webkit-transition:none!important;transition:none!important}',
    ),
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => style.remove())
    })
  }
}

export function ThemeProvider({
  children,
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [selection, setSelection] = React.useState<ThemeSelection>(readSelection)
  const [systemVariant, setSystemVariant] = React.useState<ThemeVariant>(getSystemVariant)
  const resolvedVariant = selection.mode === 'system' ? systemVariant : selection.mode
  const selectedThemeId =
    resolvedVariant === 'light' ? selection.lightThemeId : selection.darkThemeId
  const selectedTheme =
    getRegisteredTheme(selectedThemeId) ??
    getRegisteredTheme(
      resolvedVariant === 'light'
        ? DEFAULT_THEME_SELECTION.lightThemeId
        : DEFAULT_THEME_SELECTION.darkThemeId,
    )!

  const setThemeForVariant = React.useCallback((variant: ThemeVariant, themeId: string) => {
    const nextTheme = getRegisteredTheme(themeId)
    if (!nextTheme || nextTheme.source.variant !== variant) return

    setSelection((current) => ({
      ...current,
      [variant === 'light' ? 'lightThemeId' : 'darkThemeId']: nextTheme.id,
    }))
  }, [])

  const setMode = React.useCallback((mode: ThemeMode) => {
    setSelection((current) => ({ ...current, mode }))
  }, [])

  React.useLayoutEffect(() => {
    const restoreTransitions = disableTransitionOnChange ? disableTransitionsTemporarily() : null
    applyResolvedTheme(document.documentElement, resolveTheme(selectedTheme))
    restoreTransitions?.()
  }, [selectedTheme, disableTransitionOnChange])

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => setSystemVariant(getSystemVariant())

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  React.useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, serializeThemeSelection(selection))
    } catch {
      // Storage can be unavailable; applying a theme must still work.
    }
  }, [selection])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== THEME_STORAGE_KEY) return
      setSelection(readSelection())
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [])

  const value = React.useMemo(
    () => ({
      themeId: selectedTheme.id,
      mode: selection.mode,
      resolvedVariant: selectedTheme.source.variant,
      lightThemeId: selection.lightThemeId,
      darkThemeId: selection.darkThemeId,
      themes: THEME_REGISTRY,
      setMode,
      setThemeForVariant,
    }),
    [selectedTheme, selection, setMode, setThemeForVariant],
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeProviderContext)
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}
