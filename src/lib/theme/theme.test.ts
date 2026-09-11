import { describe, expect, it } from 'vitest'

import { allThemes } from '@/lib/theme/all-themes'
import {
  DEFAULT_THEME_SELECTION,
  getRegisteredTheme,
  THEME_IDS_BY_VARIANT,
  THEME_REGISTRY,
  THEME_VARIANTS_BY_ID,
} from './registry'
import { parseCodexThemeV1, resolveTheme, THEME_VARIABLE_NAMES } from './theme'

describe('codex-theme-v1', () => {
  it('registers every supplied App export without changing its payload', () => {
    const exportedThemes = allThemes.map(parseCodexThemeV1)

    expect(THEME_REGISTRY.map((theme) => theme.source)).toEqual(exportedThemes)
    expect(new Set(THEME_REGISTRY.map((theme) => theme.id)).size).toBe(THEME_REGISTRY.length)
    expect(THEME_REGISTRY).toHaveLength(42)
    expect(THEME_IDS_BY_VARIANT.light).toHaveLength(15)
    expect(THEME_IDS_BY_VARIANT.dark).toHaveLength(27)
    expect(THEME_VARIANTS_BY_ID[DEFAULT_THEME_SELECTION.lightThemeId]).toBe('light')
    expect(THEME_VARIANTS_BY_ID[DEFAULT_THEME_SELECTION.darkThemeId]).toBe('dark')
  })

  it('parses nullable fonts and preserves non-UI metadata', () => {
    const theme = parseCodexThemeV1(
      'codex-theme-v1:{"codeThemeId":"notion","theme":{"accent":"#0e0eff","accentSource":"custom","contrast":45,"fonts":{"code":null,"ui":null},"ink":"#000000","opaqueWindows":true,"semanticColors":{"diffAdded":"#00a240","diffRemoved":"#c41a16","skill":"#0e0eff"},"surface":"#ffffff"},"variant":"light"}',
    )

    expect(theme.theme.fonts.ui).toBeNull()
    expect(theme.theme.fonts.code).toBeNull()
    expect(theme.codeThemeId).toBe('notion')
    expect(theme.theme.opaqueWindows).toBe(true)
  })

  it.each([
    ['missing prefix', '{}'],
    ['invalid JSON', 'codex-theme-v1:{'],
    ['invalid variant', validExport().replace('"light"', '"system"')],
    ['invalid color', validExport().replace('#ffffff', 'white')],
    ['invalid contrast', validExport().replace('"contrast":45', '"contrast":101')],
  ])('rejects %s', (_, value) => {
    expect(() => parseCodexThemeV1(value)).toThrow()
  })
})

describe('theme resolver', () => {
  it('resolves every registered theme to the complete variable set', () => {
    for (const theme of THEME_REGISTRY) {
      const resolved = resolveTheme(theme)
      expect(resolved.id).toBe(theme.id)
      expect(resolved.variant).toBe(theme.source.variant)
      expect(Object.keys(resolved.cssVariables).sort()).toEqual(
        THEME_VARIABLE_NAMES.map((name) => `--app-${name}`).sort(),
      )
    }
  })

  it('does not expose per-theme transient action colors', () => {
    expect(THEME_VARIABLE_NAMES).not.toContain('action-hover')
    expect(THEME_VARIABLE_NAMES).not.toContain('action-pressed')
    expect(THEME_VARIABLE_NAMES).not.toContain('selection')
  })

  it('uses exported semantic colors without exposing font variables', () => {
    const light = resolveTheme(getRegisteredTheme('xcode-light')!)
    const dark = resolveTheme(getRegisteredTheme('xcode-dark')!)

    expect(light.cssVariables['--app-success']).toBe('#00a240')
    expect(light.cssVariables['--app-destructive']).toBe('#c41a16')
    expect(THEME_VARIABLE_NAMES).not.toContain('font-ui')
    expect(THEME_VARIABLE_NAMES).not.toContain('font-code')
    expect(dark.cssVariables['--app-surface']).toBe('#1f1f24')
    expect(dark.cssVariables['--app-canvas']).toBe('color-mix(in srgb, #1f1f24 87%, #000000 13%)')
    expect(dark.cssVariables['--app-surface-subtle']).toBe(
      'oklch(from #1f1f24 calc(l + (0.1285578107 + l * 0.571071 - l) * 1) calc(c * (1 - 0.025 * 1)) h)',
    )
    expect(dark.cssVariables['--app-surface-raised']).toBe(
      'oklch(from #1f1f24 calc(l + (0.1822036798 + l * 0.53205 - l) * 1) calc(c * (1 - 0.25 * 1)) h)',
    )
    expect(dark.cssVariables['--app-access-mode']).toBe('#ff8549')
    expect(dark.cssVariables['--app-send']).toBe('#ffffff')
    expect(dark.cssVariables['--app-send-foreground']).toBe('#383838')
    expect(dark.cssVariables['--app-text-on-accent']).toBe('#000000')
  })

  it('prefers white text when its contrast is close to black text', () => {
    const solarizedLight = resolveTheme(getRegisteredTheme('solarized-light')!)
    const codexDark = resolveTheme(getRegisteredTheme('codex-dark')!)
    const vscodePlusLight = resolveTheme(getRegisteredTheme('vscode-plus-light')!)
    const vercelDark = resolveTheme(getRegisteredTheme('vercel-dark')!)

    expect(solarizedLight.cssVariables['--app-text-on-accent']).toBe('#000000')
    expect(codexDark.cssVariables['--app-text-on-accent']).toBe('#ffffff')
    expect(vscodePlusLight.cssVariables['--app-text-on-accent']).toBe('#ffffff')
    expect(vercelDark.cssVariables['--app-text-on-accent']).toBe('#ffffff')
  })

  it('resolves every registered accent foreground to a black or white candidate', () => {
    for (const theme of THEME_REGISTRY) {
      const resolved = resolveTheme(theme)
      const foreground = resolved.cssVariables['--app-text-on-accent']
      expect(['#000000', '#ffffff']).toContain(foreground)

      const blackContrast = contrastRatio(theme.source.theme.accent, '#000000')
      const whiteContrast = contrastRatio(theme.source.theme.accent, '#ffffff')
      const selectedContrast = contrastRatio(theme.source.theme.accent, foreground)

      expect(selectedContrast).toBeGreaterThanOrEqual(4.5)
      expect(selectedContrast).toBeGreaterThanOrEqual(Math.min(blackContrast, whiteContrast))
    }
  })
})

function contrastRatio(firstColor: string, secondColor: string) {
  const firstLuminance = relativeLuminance(firstColor)
  const secondLuminance = relativeLuminance(secondColor)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(hexColor: string) {
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hexColor.slice(offset + 1, offset + 3), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function validExport() {
  return 'codex-theme-v1:{"codeThemeId":"xcode","theme":{"accent":"#0e0eff","accentSource":"custom","contrast":45,"fonts":{"code":"SF Mono","ui":null},"ink":"#000000","opaqueWindows":true,"semanticColors":{"diffAdded":"#00a240","diffRemoved":"#c41a16","skill":"#0e0eff"},"surface":"#ffffff"},"variant":"light"}'
}
