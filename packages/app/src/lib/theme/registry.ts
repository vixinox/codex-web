import { allThemes } from '@/lib/theme/all-themes'

import { parseCodexThemeV1, type RegisteredTheme, type ThemeVariant } from './theme'

const THEME_NAME_OVERRIDES: Record<string, string> = {
  codex: 'Codex',
  xcode: 'Xcode',
  'vscode-plus': 'VS Code Plus',
}

export const DEFAULT_THEME_SELECTION = {
  lightThemeId: 'codex-light',
  darkThemeId: 'codex-dark',
  mode: 'system',
} as const

export const THEME_REGISTRY: readonly RegisteredTheme[] = allThemes
  .map(parseCodexThemeV1)
  .map((source) => ({
    id: `${source.codeThemeId}-${source.variant}`,
    name: formatThemeName(source.codeThemeId),
    source,
  }))

export const THEME_IDS_BY_VARIANT: Record<ThemeVariant, readonly string[]> = {
  light: THEME_REGISTRY.filter((theme) => theme.source.variant === 'light').map(
    (theme) => theme.id,
  ),
  dark: THEME_REGISTRY.filter((theme) => theme.source.variant === 'dark').map((theme) => theme.id),
}

export const THEME_VARIANTS_BY_ID: Readonly<Record<string, ThemeVariant>> = Object.fromEntries(
  THEME_REGISTRY.map((theme) => [theme.id, theme.source.variant]),
)

export function getRegisteredTheme(themeId: string) {
  return THEME_REGISTRY.find((theme) => theme.id === themeId)
}

function formatThemeName(themeId: string) {
  return (
    THEME_NAME_OVERRIDES[themeId] ??
    themeId.replace(
      /(^|-)([a-z])/g,
      (_, separator: string, letter: string) =>
        `${separator === '-' ? ' ' : ''}${letter.toUpperCase()}`,
    )
  )
}
