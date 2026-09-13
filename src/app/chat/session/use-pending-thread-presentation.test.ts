import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ChatPendingTurn, ChatThreadPresentation } from '@/app/chat/model/types'
import { usePendingThreadPresentation } from './use-pending-thread-presentation'

const pending: ChatPendingTurn = {
  clientTurnId: 'client-1',
  optimisticThreadId: 'optimistic-1',
  nativeThreadId: 'thread-1',
  projectId: null,
  text: 'Build it',
  startedAt: 1,
}

describe('shared pending Thread presentation', () => {
  it('keeps pending state scoped to the current Thread', () => {
    const { result, rerender } = renderHook(
      ({ threadId }) =>
        usePendingThreadPresentation({
          userId: 'user-1',
          target: { projectId: null, threadId },
        }),
      { initialProps: { threadId: 'thread-1' } },
    )

    act(() => result.current.onPendingChange(pending, 'user:user-1\0thread:<root>\0thread-1'))
    expect(result.current.pending).toEqual(pending)
    expect(result.current.working).toBe(true)
    expect(result.current.optimisticThread?.turns[0]).toMatchObject({ id: 'client-1' })

    rerender({ threadId: 'thread-2' })
    expect(result.current.pending).toBeNull()
  })

  it('bridges an accepted New Chat turn until the URL reaches its Thread', () => {
    const { result, rerender } = renderHook(
      ({ threadId }) =>
        usePendingThreadPresentation({
          userId: 'user-1',
          target: { projectId: null, threadId },
        }),
      { initialProps: { threadId: null as string | null } },
    )

    act(() => result.current.onPendingChange(pending, 'user:user-1\0thread:<root>\0thread-1'))
    expect(result.current.pending).toEqual(pending)

    rerender({ threadId: 'thread-1' })
    expect(result.current.pending).toEqual(pending)

    rerender({ threadId: 'thread-2' })
    expect(result.current.pending).toBeNull()
  })

  it('does not revive an old Thread turn when opening New Chat manually', () => {
    const { result, rerender } = renderHook(
      ({ threadId }) =>
        usePendingThreadPresentation({
          userId: 'user-1',
          target: { projectId: null, threadId },
        }),
      { initialProps: { threadId: 'thread-1' } },
    )

    act(() => result.current.onPendingChange(pending, 'user:user-1\0thread:<root>\0thread-1'))
    rerender({ threadId: null })
    expect(result.current.pending).toBeNull()
    // A later render must not resurrect the old Thread's optimistic turn.
    rerender({ threadId: null })
    expect(result.current.pending).toBeNull()
  })

  it('reconciles an opaque Guest job with the native completed transcript', () => {
    const thread: ChatThreadPresentation = {
      id: 'thread-1',
      projectId: null,
      title: 'Thread',
      isBusy: false,
      turns: [
        {
          id: 'native-turn',
          status: 'completed',
          blocks: [
            {
              id: 'user',
              type: 'user',
              content: [{ type: 'text', text: 'Build it' }],
            },
          ],
        },
      ],
    }
    const { result } = renderHook(() =>
      usePendingThreadPresentation({
        userId: 'user-1',
        target: { projectId: null, threadId: 'thread-1' },
        thread,
      }),
    )

    act(() => result.current.onPendingChange(pending, 'user:user-1\0thread:<root>\0thread-1'))
    expect(result.current.thread?.turns).toHaveLength(1)
    expect(result.current.thread?.turns[0]).toMatchObject({
      id: 'native-turn',
      status: 'completed',
    })
  })

  it('clears a matched pending turn after the native transcript completes', async () => {
    const thread: ChatThreadPresentation = {
      id: 'thread-1',
      projectId: null,
      title: 'Thread',
      isBusy: false,
      turns: [
        {
          id: 'native-turn',
          status: 'completed',
          blocks: [
            {
              id: 'user',
              type: 'user',
              content: [{ type: 'text', text: 'Build it' }],
            },
            { id: 'answer', type: 'assistant', text: 'Done', final: true },
          ],
        },
      ],
    }
    const { result } = renderHook(() =>
      usePendingThreadPresentation({
        userId: 'user-1',
        target: { projectId: null, threadId: 'thread-1' },
        thread,
      }),
    )

    act(() => result.current.onPendingChange(pending, 'user:user-1\0thread:<root>\0thread-1'))

    await waitFor(() => expect(result.current.pending).toBeNull())
    expect(result.current.working).toBe(false)
  })
})
