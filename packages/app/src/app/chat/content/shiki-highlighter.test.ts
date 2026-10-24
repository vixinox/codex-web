import { describe, expect, it } from 'vitest'

import { highlightCode, normalizeLanguage } from './shiki-highlighter'

describe('Shiki highlighter', () => {
  it.each([
    ['light', 'vscode2026Light'],
    ['dark', 'vscode2026Dark'],
  ] as const)(
    'uses the VS Code %s token theme without a fixed root color',
    async (variant, theme) => {
      const html = await highlightCode('const answer = 42', 'typescript', variant)

      expect(html).toContain(`class="shiki ${theme}"`)
      expect(html).toContain('color:#')
      expect(html).not.toContain('background-color:')
      expect(html).not.toMatch(/<pre[^>]*\sstyle=/)
    },
  )

  it('keeps language fallback and length limits', async () => {
    expect(normalizeLanguage('TS')).toBe('typescript')
    expect(normalizeLanguage('unknown')).toBe('text')
    expect(await highlightCode('plain text', 'text', 'light')).toBeUndefined()
    expect(await highlightCode('x'.repeat(100_001), 'typescript', 'dark')).toBeUndefined()
  })
})
