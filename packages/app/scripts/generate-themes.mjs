import { readFile, writeFile } from 'node:fs/promises'
import { createScale } from '@adobe/leonardo-contrast-colors'
import Color from 'colorjs.io'
import { allThemes } from '../src/lib/theme/all-themes.ts'
import { validateThemeInputs } from '../src/lib/theme/theme-input.ts'

validateThemeInputs(allThemes)
const parsed = new Map()
const parse = value => { if (!parsed.has(value)) parsed.set(value, new Color(value)); return parsed.get(value) }
const contrast = (a, b) => parse(a).contrastWCAG21(parse(b))
const luminance = color => parse(color).luminance
const cache = new Map()
function scale(keys) {
  const id = keys.join(',')
  if (!cache.has(id)) {
    cache.set(id, createScale({ colorKeys: keys, colorSpace: 'LCH', swatches: 1024, fullScale: true }))
  }
  return cache.get(id)
}

const result = {}
for (const input of allThemes) {
  const dark = input.variant === 'dark'
  const colors = {}
  const checks = []
  const neutral = scale([input.surface, input.ink])
  function layer(background, ratio, palette = neutral) {
    const candidates = palette.filter(value => dark ? luminance(value) > luminance(background) : luminance(value) < luminance(background))
    const value = candidates.sort((a, b) => Math.abs(contrast(a, background) - ratio) - Math.abs(contrast(b, background) - ratio))[0]
    if (!value) throw new Error(`${input.id}: no layer at ${ratio}`)
    return value
  }
  colors.canvas = input.surface
  colors.surface = input.surface
  colors['surface-subtle'] = layer(input.surface, 1.08)
  colors['surface-raised'] = layer(input.surface, 1.16)
  colors['surface-overlay'] = layer(input.surface, 1.24)
  colors.hover = layer(colors['surface-overlay'], 1.08)
  colors.pressed = layer(colors['surface-overlay'], 1.16)
  colors.selected = layer(colors['surface-overlay'], 1.24)
  const surfaces = ['canvas', 'surface', 'surface-subtle', 'surface-raised', 'surface-overlay', 'hover', 'pressed', 'selected']
  function foreground(seed, backgrounds, minimum, keys = [seed]) {
    const candidates = [seed, ...scale(keys)].filter(value => backgrounds.every(bg => contrast(value, bg) >= minimum))
    candidates.sort((a, b) => parse(seed).deltaEOK(parse(a)) - parse(seed).deltaEOK(parse(b)))
    if (!candidates[0]) throw new Error(`${input.id}: no foreground for ${seed} at ${minimum}`)
    return candidates[0]
  }
  const backgrounds = surfaces.map(name => colors[name])
  colors.text = foreground(input.ink, backgrounds, 4.55)
  colors['text-muted'] = foreground(layer(input.surface, 4.6), backgrounds, 4.55, [input.surface, input.ink])
  colors['text-disabled'] = layer(input.surface, 2)
  colors.border = layer(input.surface, 1.5)
  colors['border-strong'] = foreground(layer(input.surface, 3.1), backgrounds, 3.05, [input.surface, input.ink])
  colors.input = colors['border-strong']
  colors['interaction-foreground'] = colors.text
  colors['action-text'] = foreground(input.accent, backgrounds, 4.55)
  colors['focus-ring'] = foreground(input.accent, backgrounds, 3.05)
  colors.action = input.accent
  const on = bg => contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#000000' : '#ffffff'
  colors['text-on-accent'] = on(colors.action)
  // Keep a single foreground valid across all solid action states.
  colors['action-hover'] = foreground(layer(input.accent, 1.08, scale([input.accent])), [colors['text-on-accent']], 4.55)
  colors['action-pressed'] = foreground(layer(input.accent, 1.16, scale([input.accent])), [colors['text-on-accent']], 4.55)
  colors.send = colors.action
  colors['send-foreground'] = colors['text-on-accent']
  const seeds = { success: '#30a46c', destructive: '#e5484d', warning: '#f5a524', 'diff-added': input.diffAdded, 'diff-removed': input.diffRemoved, skill: input.skill }
  for (const [role, seed] of Object.entries(seeds)) {
    const palette = scale([seed])
    colors[`${role}-subtle`] = layer(input.surface, 1.16, palette)
    colors[role] = foreground(seed, [...backgrounds, colors[`${role}-subtle`]], 4.55)
    colors[`${role}-border`] = foreground(seed, [...backgrounds, colors[`${role}-subtle`]], 3.05)
    colors[`${role}-solid`] = seed
    colors[`${role}-foreground`] = on(seed)
    checks.push([`${role}-foreground`, `${role}-solid`, 4.5], [role, `${role}-subtle`, 4.5], [`${role}-border`, `${role}-subtle`, 3])
    for (const surface of surfaces) checks.push([role, surface, 4.5])
  }
  colors['access-mode'] = colors.warning
  colors.shadow = dark ? '#00000073' : '#0000002e'
  colors.scrim = dark ? '#0000008c' : '#00000052'
  for (const surface of surfaces) {
    for (const fg of ['text', 'text-muted', 'action-text']) checks.push([fg, surface, 4.5])
    for (const fg of ['border-strong', 'focus-ring']) checks.push([fg, surface, 3])
  }
  for (const bg of ['action', 'action-hover', 'action-pressed']) checks.push(['text-on-accent', bg, 4.5])
  const layerTargets = [['surface-subtle',1.08],['surface-raised',1.16],['surface-overlay',1.24]]
  for (const [role, target] of layerTargets) {
    if (Math.abs(contrast(colors[role], input.surface) - target) > 0.04) throw new Error(`${input.id}: unreachable ${role} target`)
  }
  for (const [fg, bg, minimum] of checks) {
    const actual = contrast(colors[fg], colors[bg])
    if (actual < minimum) throw new Error(`${input.id}: ${fg}/${bg} ${actual} < ${minimum}`)
  }
  result[input.id] = colors
}

const output = new URL('../src/lib/theme/generated-themes.json', import.meta.url)
const serialized = JSON.stringify(result, null, 2) + '\n'
const check = process.argv.includes('--check')

if (check) {
  if (await readFile(output, 'utf8') !== serialized) {
    throw new Error(`Stale generated artifact: ${output.pathname}`)
  }
} else {
  await writeFile(output, serialized)
}

console.log(`${check ? 'Verified' : 'Generated'} ${allThemes.length} themes; all contrast constraints passed.`)
