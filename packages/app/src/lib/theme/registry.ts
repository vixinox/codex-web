import { allThemes } from '@/lib/theme/all-themes'

import { type RegisteredTheme, type ThemeVariant } from './theme'

export const DEFAULT_THEME_SELECTION = {
  lightThemeId: 'codex-light',
  darkThemeId: 'codex-dark',
  mode: 'system',
} as const

export const THEME_REGISTRY: readonly RegisteredTheme[] = allThemes.map(
  ({ id, name, variant }) => ({
    id,
    name,
    variant,
  }),
)

export const THEME_IDS_BY_VARIANT: Record<ThemeVariant, readonly string[]> = {
  light: THEME_REGISTRY.filter((theme) => theme.variant === 'light').map((theme) => theme.id),
  dark: THEME_REGISTRY.filter((theme) => theme.variant === 'dark').map((theme) => theme.id),
}

export const THEME_VARIANTS_BY_ID: Readonly<Record<string, ThemeVariant>> = Object.fromEntries(
  THEME_REGISTRY.map((theme) => [theme.id, theme.variant]),
)

export function getRegisteredTheme(themeId: string) {
  return THEME_REGISTRY.find((theme) => theme.id === themeId)
}
