import { describe, expect, it } from 'vitest'
import { splitCompleteMarkdownBlocks } from './streaming-assistant'

describe('streaming Markdown blocks', () => {
  it('commits only complete paragraph boundaries', () => {
    expect(splitCompleteMarkdownBlocks('**bold**\n\n# Heading\n\n- item')).toEqual({
      blocks: [
        { id: 'markdown-0', text: '**bold**' },
        { id: 'markdown-1', text: '# Heading' },
      ],
      pending: '- item',
    })
  })

  it('keeps incomplete inline Markdown out of the rendered blocks', () => {
    expect(splitCompleteMarkdownBlocks('[read this](https://example.com')).toEqual({
      blocks: [],
      pending: '[read this](https://example.com',
    })
    expect(splitCompleteMarkdownBlocks('**unfinished')).toEqual({
      blocks: [],
      pending: '**unfinished',
    })
    expect(splitCompleteMarkdownBlocks('*unfinished')).toEqual({
      blocks: [],
      pending: '*unfinished',
    })
  })

  it('waits for a closing fence and flushes an interrupted fence at turn end', () => {
    const source = '```ts\nconst answer = 42\n'
    expect(splitCompleteMarkdownBlocks(source)).toEqual({ blocks: [], pending: source })
    expect(splitCompleteMarkdownBlocks(source, true)).toEqual({
      blocks: [{ id: 'markdown-0', text: '```ts\nconst answer = 42\n```' }],
      pending: '',
    })
  })

  it('rebuilds from the latest text instead of appending stale deltas', () => {
    const first = splitCompleteMarkdownBlocks('First\n\nSecond')
    const replacement = splitCompleteMarkdownBlocks('Replacement')
    expect(first.blocks).toEqual([{ id: 'markdown-0', text: 'First' }])
    expect(replacement).toEqual({
      blocks: [],
      pending: 'Replacement',
    })
  })

  it('keeps a plain single-line tail pending while streaming', () => {
    expect(splitCompleteMarkdownBlocks('hello')).toEqual({
      blocks: [],
      pending: 'hello',
    })
  })

  it('commits a complete paragraph while the next Markdown block is pending', () => {
    expect(splitCompleteMarkdownBlocks('hello\n\n**unfinished')).toEqual({
      blocks: [{ id: 'markdown-0', text: 'hello' }],
      pending: '**unfinished',
    })
  })

  it('does not preview a plain single-line tail with a trailing newline', () => {
    expect(splitCompleteMarkdownBlocks('hello\n')).toEqual({
      blocks: [],
      pending: 'hello\n',
    })
  })

  it('does not preview incomplete Markdown syntax', () => {
    expect(splitCompleteMarkdownBlocks('**unfinished')).toEqual({
      blocks: [],
      pending: '**unfinished',
    })
    expect(splitCompleteMarkdownBlocks('[unfinished](https://example.com')).toEqual({
      blocks: [],
      pending: '[unfinished](https://example.com',
    })
    expect(splitCompleteMarkdownBlocks('```ts\nconst value = 1')).toEqual({
      blocks: [],
      pending: '```ts\nconst value = 1',
    })
  })
})
