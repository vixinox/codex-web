import { describe, expect, it } from 'vitest'
import {
  optimisticThread,
  pendingMatchesTarget,
  reconcilePendingThread,
} from './thread-pending-reconciliation'
import type { ChatPendingTurn, ChatThreadPresentation } from '@/app/chat/model/types'

const pending: ChatPendingTurn = {
  clientTurnId: 'client-1',
  optimisticThreadId: 'optimistic-thread-1',
  projectId: null,
  text: 'First message',
  startedAt: 10_000,
}

function thread(turns: ChatThreadPresentation['turns'] = []): ChatThreadPresentation {
  return { id: 'thread-1', projectId: null, title: '', turns, isBusy: true }
}

describe('pending turn reconciliation', () => {
  it('keeps the optimistic user message before the native request is accepted', () => {
    expect(optimisticThread(pending).turns[0]).toMatchObject({
      id: 'client-1',
      presentationId: 'client-1',
      startedAt: 10_000,
      blocks: [{ type: 'user', content: [{ type: 'text', text: 'First message' }] }],
    })
  })

  it('keeps selected skill references in an optimistic user message', () => {
    const selected = {
      ...pending,
      content: [
        { type: 'reference' as const, kind: 'skill' as const, label: 'PDF' },
        { type: 'text' as const, text: 'First message' },
      ],
    }

    expect(optimisticThread(selected).turns[0]?.blocks[0]).toMatchObject({
      content: [
        { type: 'reference', kind: 'skill', label: 'PDF' },
        { type: 'text', text: 'First message' },
      ],
    })
  })

  it('keeps the same presentation identity while the accepted native turn is absent', () => {
    const accepted = { ...pending, nativeThreadId: 'thread-1', nativeTurnId: 'turn-1' }
    const result = reconcilePendingThread(thread(), accepted)

    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]).toMatchObject({ id: 'client-1', presentationId: 'client-1' })
  })

  it('merges native activity without dropping an optimistic user block', () => {
    const accepted = { ...pending, nativeThreadId: 'thread-1', nativeTurnId: 'turn-1' }
    const result = reconcilePendingThread(
      thread([
        {
          id: 'turn-1',
          status: 'inProgress',
          startedAt: 1_000,
          blocks: [{ id: 'activity-1', type: 'activity', kind: 'command', activities: [] }],
        },
      ]),
      accepted,
    )

    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]).toMatchObject({
      id: 'turn-1',
      presentationId: 'client-1',
      startedAt: 10_000,
    })
    expect(result.turns[0].blocks.map((block) => block.type)).toEqual(['user', 'activity'])
  })

  it('uses the native user block without duplication and preserves the stable React identity', () => {
    const accepted = { ...pending, nativeThreadId: 'thread-1', nativeTurnId: 'turn-1' }
    const result = reconcilePendingThread(
      thread([
        {
          id: 'turn-1',
          status: 'inProgress',
          blocks: [
            {
              id: 'native-user',
              type: 'user',
              content: [{ type: 'text', text: 'First message' }],
            },
            { id: 'assistant-1', type: 'assistant', text: 'Response' },
          ],
        },
      ]),
      accepted,
    )

    expect(result.turns[0].presentationId).toBe('client-1')
    expect(result.turns[0].blocks.filter((block) => block.type === 'user')).toHaveLength(1)
    expect(result.turns[0].blocks.map((block) => block.type)).toEqual(['user', 'assistant'])
  })

  it('matches an opaque accepted Guest job to its native transcript turn by user content', () => {
    const accepted = { ...pending, nativeThreadId: 'thread-1' }
    const result = reconcilePendingThread(
      thread([
        {
          id: 'native-turn-1',
          status: 'completed',
          blocks: [
            {
              id: 'native-user',
              type: 'user',
              content: [{ type: 'text', text: 'First message' }],
            },
            { id: 'answer', type: 'assistant', text: 'Done', final: true },
          ],
        },
      ]),
      accepted,
    )

    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]).toMatchObject({
      id: 'native-turn-1',
      presentationId: 'client-1',
      status: 'completed',
    })
  })

  it('scopes an accepted pending turn to its exact project and Thread', () => {
    const accepted = { ...pending, nativeThreadId: 'thread-1', nativeTurnId: 'turn-1' }

    expect(pendingMatchesTarget(accepted, null, 'thread-1')).toBe(true)
    expect(pendingMatchesTarget(accepted, null, 'thread-2')).toBe(false)
    expect(pendingMatchesTarget(accepted, 'project-1', 'thread-1')).toBe(false)
  })
})
