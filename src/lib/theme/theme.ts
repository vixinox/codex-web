export type ThemeVariant = 'light' | 'dark'
export type ThemeMode = ThemeVariant | 'system'

export type CodexThemeV1 = {
  codeThemeId: string
  theme: {
    accent: string
    accentSource: string
    contrast: number
    fonts: {
      code: string | null
      ui: string | null
    }
    ink: string
    opaqueWindows: boolean
    semanticColors: {
      diffAdded: string
      diffRemoved: string
      skill: string
    }
    surface: string
  }
  variant: ThemeVariant
}

export type RegisteredTheme = {
  id: string
  name: string
  source: CodexThemeV1
}

export const THEME_VARIABLE_NAMES = [
  'canvas',
  'surface',
  'surface-subtle',
  'surface-raised',
  'surface-overlay',
  'access-mode',
  'send',
  'send-foreground',
  'text',
  'text-muted',
  'text-subtle',
  'text-on-accent',
  'border',
  'border-strong',
  'input',
  'focus-ring',
  'action',
  'destructive',
  'warning',
  'success',
  'diff-added',
  'diff-removed',
  'skill',
  'shadow',
  'scrim',
] as const

export type ThemeVariableName = (typeof THEME_VARIABLE_NAMES)[number]
export type ThemeCssVariableName = `--app-${ThemeVariableName}`

export type ResolvedTheme = {
  id: string
  variant: ThemeVariant
  cssVariables: Record<ThemeCssVariableName, string>
}

const CODEX_THEME_PREFIX = 'codex-theme-v1:'
const ACCESS_MODE_COLOR = '#ff8549'
const SEND_COLOR = '#ffffff'
const SEND_FOREGROUND_COLOR = '#383838'
const BLACK = '#000000'
const WHITE = '#ffffff'
const WHITE_PREFERENCE_MARGIN = 0.25
const HEX_COLOR = /^#[\da-f]{6}$/i

export function parseCodexThemeV1(value: string): CodexThemeV1 {
  if (!value.startsWith(CODEX_THEME_PREFIX)) {
    throw new Error('Theme must start with codex-theme-v1:')
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(value.slice(CODEX_THEME_PREFIX.length))
  } catch {
    throw new Error('Theme payload must be valid JSON')
  }

  if (!isCodexThemeV1(candidate)) {
    throw new Error('Theme payload does not match codex-theme-v1')
  }

  return candidate
}

function isCodexThemeV1(value: unknown): value is CodexThemeV1 {
  if (!isRecord(value) || (value.variant !== 'light' && value.variant !== 'dark')) return false
  if (typeof value.codeThemeId !== 'string' || !isRecord(value.theme)) return false

  const theme = value.theme
  if (
    !isHexColor(theme.accent) ||
    typeof theme.accentSource !== 'string' ||
    typeof theme.contrast !== 'number' ||
    !Number.isFinite(theme.contrast) ||
    theme.contrast < 0 ||
    theme.contrast > 100 ||
    !isHexColor(theme.ink) ||
    typeof theme.opaqueWindows !== 'boolean' ||
    !isHexColor(theme.surface) ||
    !isRecord(theme.fonts) ||
    (theme.fonts.code !== null && typeof theme.fonts.code !== 'string') ||
    (theme.fonts.ui !== null && typeof theme.fonts.ui !== 'string') ||
    !isRecord(theme.semanticColors)
  ) {
    return false
  }

  return (
    isHexColor(theme.semanticColors.diffAdded) &&
    isHexColor(theme.semanticColors.diffRemoved) &&
    isHexColor(theme.semanticColors.skill)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

function relativeLuminance(hexColor: string) {
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hexColor.slice(offset + 1, offset + 3), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(firstColor: string, secondColor: string) {
  const firstLuminance = relativeLuminance(firstColor)
  const secondLuminance = relativeLuminance(secondColor)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

function textOnAccent(accent: string) {
  const blackContrast = contrastRatio(accent, BLACK)
  const whiteContrast = contrastRatio(accent, WHITE)

  return blackContrast - whiteContrast > WHITE_PREFERENCE_MARGIN ? BLACK : WHITE
}

function clampContrast(contrast: number) {
  return Math.min(100, Math.max(0, contrast))
}

function percent(value: number) {
  return Number(value.toFixed(2))
}

function mix(primary: string, secondary: string, secondaryPercent: number) {
  const amount = percent(secondaryPercent)
  return `color-mix(in oklch, ${primary} ${percent(100 - amount)}%, ${secondary} ${amount}%)`
}

function mixSrgb(primary: string, secondary: string, secondaryPercent: number) {
  const amount = percent(secondaryPercent)
  return `color-mix(in srgb, ${primary} ${percent(100 - amount)}%, ${secondary} ${amount}%)`
}

function alpha(color: string, amount: number) {
  return `color-mix(in oklch, ${color} ${percent(amount)}%, transparent)`
}

function deriveDarkSurface(surface: string, layer: 'subtle' | 'raised', contrast: number) {
  const params =
    layer === 'subtle'
      ? { intercept: 0.1285578107, slope: 0.571071, chromaReduction: 0.025 }
      : { intercept: 0.1822036798, slope: 0.53205, chromaReduction: 0.25 }
  const contrastFactor = percent(contrast / 50)
  return `oklch(from ${surface} calc(l + (${params.intercept} + l * ${params.slope} - l) * ${contrastFactor}) calc(c * (1 - ${params.chromaReduction} * ${contrastFactor})) h)`
}

export function resolveTheme(registeredTheme: RegisteredTheme): ResolvedTheme {
  const { source } = registeredTheme
  const recipe = source.theme
  const contrast = clampContrast(recipe.contrast)
  const subtleAmount = 1 + contrast * 0.04
  const raisedAmount = 4 + contrast * 0.08
  const overlayAmount = 6 + contrast * 0.12
  const borderAmount = 10 + contrast * 0.1
  const strongBorderAmount = 18 + contrast * 0.12
  const mutedAmount = 62 + contrast * 0.12
  const subtleTextAmount = 45 + contrast * 0.1
  const canvasDarkenAmount = 8 + contrast * 0.1
  const colors = recipe.semanticColors
  const surfaceSubtle =
    source.variant === 'dark'
      ? deriveDarkSurface(recipe.surface, 'subtle', contrast)
      : mix(recipe.surface, recipe.ink, subtleAmount)
  const surfaceRaised =
    source.variant === 'dark'
      ? deriveDarkSurface(recipe.surface, 'raised', contrast)
      : mix(recipe.surface, recipe.ink, raisedAmount)

  return {
    id: registeredTheme.id,
    variant: source.variant,
    cssVariables: {
      '--app-canvas': mixSrgb(recipe.surface, '#000000', canvasDarkenAmount),
      '--app-surface': recipe.surface,
      '--app-surface-subtle': surfaceSubtle,
      '--app-surface-raised': surfaceRaised,
      '--app-surface-overlay': mix(recipe.surface, recipe.ink, overlayAmount),
      '--app-access-mode': ACCESS_MODE_COLOR,
      '--app-send': SEND_COLOR,
      '--app-send-foreground': SEND_FOREGROUND_COLOR,
      '--app-text': recipe.ink,
      '--app-text-muted': mix(recipe.surface, recipe.ink, mutedAmount),
      '--app-text-subtle': mix(recipe.surface, recipe.ink, subtleTextAmount),
      '--app-text-on-accent': textOnAccent(recipe.accent),
      '--app-border': alpha(recipe.ink, borderAmount),
      '--app-border-strong': alpha(recipe.ink, strongBorderAmount),
      '--app-input': alpha(recipe.ink, strongBorderAmount),
      '--app-focus-ring': recipe.accent,
      '--app-action': recipe.accent,
      '--app-destructive': colors.diffRemoved,
      '--app-warning': recipe.accent,
      '--app-success': colors.diffAdded,
      '--app-diff-added': colors.diffAdded,
      '--app-diff-removed': colors.diffRemoved,
      '--app-skill': colors.skill,
      '--app-shadow': alpha('#000000', source.variant === 'dark' ? 45 : 18),
      '--app-scrim': alpha('#000000', source.variant === 'dark' ? 55 : 32),
    },
  }
}

export function applyResolvedTheme(root: HTMLElement, theme: ResolvedTheme) {
  root.classList.remove('light', 'dark')
  root.classList.add(theme.variant)
  root.dataset.themeId = theme.id
  root.style.colorScheme = theme.variant

  for (const [name, value] of Object.entries(theme.cssVariables)) {
    root.style.setProperty(name, value)
  }
}
