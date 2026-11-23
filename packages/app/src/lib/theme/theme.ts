import generatedThemes from './generated-themes.json'
import type { ThemeVariant } from './theme-input'
export type { ThemeVariant } from './theme-input'
export type ThemeMode = ThemeVariant | 'system'

export const THEME_VARIABLE_NAMES = [
  'canvas',
  'surface',
  'surface-subtle',
  'surface-raised',
  'surface-overlay',
  'text',
  'text-muted',
  'text-disabled',
  'border',
  'border-strong',
  'input',
  'focus-ring',
  'action',
  'text-on-accent',
  'action-hover',
  'action-pressed',
  'action-text',
  'hover',
  'pressed',
  'selected',
  'interaction-foreground',
  'access-mode',
  'send',
  'send-foreground',
  'shadow',
  'scrim',
  'success',
  'success-subtle',
  'success-border',
  'success-solid',
  'success-foreground',
  'destructive',
  'destructive-subtle',
  'destructive-border',
  'destructive-solid',
  'destructive-foreground',
  'warning',
  'warning-subtle',
  'warning-border',
  'warning-solid',
  'warning-foreground',
  'diff-added',
  'diff-added-subtle',
  'diff-added-border',
  'diff-added-solid',
  'diff-added-foreground',
  'diff-removed',
  'diff-removed-subtle',
  'diff-removed-border',
  'diff-removed-solid',
  'diff-removed-foreground',
  'skill',
  'skill-subtle',
  'skill-border',
  'skill-solid',
  'skill-foreground',
] as const
export type ThemeVariableName = (typeof THEME_VARIABLE_NAMES)[number]
export type ThemeCssVariableName = `--app-${ThemeVariableName}`
export type RegisteredTheme = {
  id: string
  name: string
  variant: ThemeVariant
}
export type ResolvedTheme = {
  id: string
  variant: ThemeVariant
  cssVariables: Record<string, string>
}

export function resolveTheme(theme: RegisteredTheme): ResolvedTheme {
  const catalog: Record<string, Record<ThemeVariableName, string>> = generatedThemes
  const colors = catalog[theme.id]
  if (!colors) throw new Error(`Missing generated theme: ${theme.id}`)
  return {
    id: theme.id,
    variant: theme.variant,
    cssVariables: Object.fromEntries(
      THEME_VARIABLE_NAMES.map((name) => [`--app-${name}`, colors[name]]),
    ),
  }
}

export function applyResolvedTheme(root: HTMLElement, theme: ResolvedTheme) {
  root.classList.remove('light', 'dark')
  root.classList.add(theme.variant)
  root.dataset.themeId = theme.id
  root.style.colorScheme = theme.variant
  for (const [name, value] of Object.entries(theme.cssVariables))
    root.style.setProperty(name, value)
}
