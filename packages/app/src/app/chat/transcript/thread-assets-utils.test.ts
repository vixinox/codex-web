import { describe, expect, it } from 'vitest'
import type { ChatTurnPresentation } from '../model/types'
import { hasAssistantText, visibleTurnContent } from './thread-assets-utils'

function turn(overrides: Partial<ChatTurnPresentation>): ChatTurnPresentation {
  return { id: 'turn-1', status: 'inProgress', blocks: [], ...overrides }
}

describe('visibleTurnContent', () => {
  it('recognizes assistant output independently from visible Markdown blocks', () => {
    expect(hasAssistantText(turn({ blocks: [] }))).toBe(false)
    expect(
      hasAssistantText(
        turn({ blocks: [{ id: 'assistant-1', type: 'assistant', text: '**open' }] }),
      ),
    ).toBe(true)
  })

  it('keeps an incomplete assistant block out of visible content while streaming', () => {
    const result = visibleTurnContent(
      turn({ blocks: [{ id: 'assistant-1', type: 'assistant', text: 'hello' }] }),
      undefined,
      undefined,
    )
    expect(result.hasContent).toBe(false)
    expect(result.trailingAssistantId).toBeUndefined()
  })

  it('shows committed assistant blocks while the next block is streaming', () => {
    const result = visibleTurnContent(
      turn({
        blocks: [{ id: 'assistant-1', type: 'assistant', text: 'hello\n\n**unfinished' }],
      }),
      undefined,
      undefined,
    )
    expect(result.hasContent).toBe(true)
    expect(result.trailingAssistantId).toBe('assistant-1')
  })

  it('keeps incomplete Markdown tails hidden while streaming', () => {
    const result = visibleTurnContent(
      turn({ blocks: [{ id: 'assistant-1', type: 'assistant', text: '**unfinished' }] }),
      undefined,
      undefined,
    )
    expect(result.hasContent).toBe(false)
    expect(result.trailingAssistantId).toBeUndefined()
  })

  it('flushes a plain single-line answer only after the turn is complete', () => {
    const completed = visibleTurnContent(
      turn({
        status: 'completed',
        blocks: [{ id: 'assistant-1', type: 'assistant', text: 'hello' }],
      }),
      undefined,
      undefined,
    )
    expect(completed.trailingAssistantId).toBe('assistant-1')
    expect(completed.hasContent).toBe(true)
  })
})
