import { describe, expect, it } from 'vitest'
import { parseCodeFenceInfo, remarkCodeFenceInfo } from './code-fence-info'

describe('code fence info', () => {
  it('keeps an unknown fence value as the visible title', () => {
    expect(parseCodeFenceInfo('src/example.ts')).toEqual({
      label: 'src/example.ts',
      language: 'src/example.ts',
    })
  })

  it('uses the first token as the highlighting language', () => {
    expect(parseCodeFenceInfo('tsx src/example.tsx')).toEqual({
      label: 'tsx src/example.tsx',
      language: 'tsx',
    })
  })

  it('preserves markdown code metadata on the rendered node', () => {
    const node = { type: 'code', lang: 'tsx', meta: 'src/example.tsx' }
    remarkCodeFenceInfo()(node)
    expect(node).toMatchObject({
      data: { hProperties: { 'data-code-title': 'tsx src/example.tsx' } },
    })
  })
})
