import { expect, it } from 'vitest'
import Color from 'colorjs.io'
import { allThemes } from './all-themes'
import { validateThemeInputs } from './theme-input'
import { THEME_REGISTRY, THEME_IDS_BY_VARIANT } from './registry'
import { resolveTheme, THEME_VARIABLE_NAMES } from './theme'

it('preserves valid catalog identities and rejects malformed seeds', () => {
  validateThemeInputs(allThemes)
  expect(THEME_REGISTRY).toHaveLength(42)
  expect(THEME_IDS_BY_VARIANT.light).toHaveLength(15)
  expect(THEME_IDS_BY_VARIANT.dark).toHaveLength(27)
  expect(() => validateThemeInputs([allThemes[0], allThemes[0]])).toThrow()
  expect(() => validateThemeInputs([{ ...allThemes[0], accent: 'red' }])).toThrow()
})
it.each(THEME_REGISTRY)('$id has complete readable static roles', (theme) => {
  const { cssVariables: vars } = resolveTheme(theme)
  const color = (name: (typeof THEME_VARIABLE_NAMES)[number]) => vars[`--app-${name}`]
  const ratio = (a: string, b: string) => new Color(a).contrastWCAG21(new Color(b))
  expect(Object.keys(vars)).toHaveLength(THEME_VARIABLE_NAMES.length)
  expect(color('surface')).toBe(allThemes.find((input) => input.id === theme.id)?.surface)
  for (const value of Object.values(vars)) expect(() => new Color(value)).not.toThrow()
  const surfaces = [
    'canvas',
    'surface',
    'surface-subtle',
    'surface-raised',
    'surface-overlay',
    'hover',
    'pressed',
    'selected',
  ] as const
  for (const surface of surfaces) {
    for (const fg of [
      'text',
      'text-muted',
      'action-text',
      'success',
      'destructive',
      'warning',
      'diff-added',
      'diff-removed',
      'skill',
    ] as const)
      expect(ratio(color(fg), color(surface))).toBeGreaterThanOrEqual(4.5)
    for (const fg of ['focus-ring', 'input'] as const)
      expect(ratio(color(fg), color(surface))).toBeGreaterThanOrEqual(3)
  }
  const layers = ['surface', 'surface-subtle', 'surface-raised', 'surface-overlay'] as const
  for (let i = 1; i < layers.length; i++) {
    const previous = new Color(color(layers[i - 1])).luminance
    const next = new Color(color(layers[i])).luminance
    expect(theme.variant === 'dark' ? next > previous : next < previous).toBe(true)
  }
  for (const bg of ['action', 'action-hover', 'action-pressed'] as const)
    expect(ratio(color('text-on-accent'), color(bg))).toBeGreaterThanOrEqual(4.5)
  for (const role of [
    'success',
    'destructive',
    'warning',
    'diff-added',
    'diff-removed',
    'skill',
  ] as const) {
    expect(ratio(color(role), color(`${role}-subtle`))).toBeGreaterThanOrEqual(4.5)
    expect(ratio(color(`${role}-foreground`), color(`${role}-solid`))).toBeGreaterThanOrEqual(4.5)
  }
})
