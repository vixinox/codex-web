import { describe, expect, it } from 'vitest'
import { snapshot } from 'valtio'

import {
  applyCodexNotification,
  createCodexThreadState,
  reduceCodexNotification,
} from '@/app/chat/native/codex-thread'
import { ThreadSessionRegistry } from './thread-session-store'

describe('Thread session store', () => {
  it('keeps a stable session and Turn proxy while syncing a streamed delta', () => {
    const registry = new ThreadSessionRegistry()
    const session = registry.get('project-1', 'thread-1')
    expect(registry.get('project-1', 'thread-1')).toBe(session)
    session.hydrate(
      {
        id: 'thread-1',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            items: [{ id: 'old', type: 'agentMessage', text: 'Old' }],
          },
          { id: 'turn-2', status: 'inProgress', items: [] },
        ],
      },
      4,
    )
    const completedTurn = session.state.turnsById['turn-1']
    const activeTurn = session.state.turnsById['turn-2']

    session.applyEvent(
      {
        method: 'item/agentMessage/delta',
        params: { turnId: 'turn-2', itemId: 'message-1', delta: 'Streaming' },
      },
      '5',
    )

    expect(session.state.turnsById['turn-1']).toBe(completedTurn)
    expect(session.state.turnsById['turn-2']).toBe(activeTurn)
    expect(snapshot(session.state).turnsById['turn-2']?.blocks).toContainEqual({
      id: 'message-1',
      type: 'assistant',
      text: 'Streaming',
    })
    registry.dispose()
  })

  it('replays a sparse active Turn from the beginning while preserving a completed snapshot cursor', () => {
    const registry = new ThreadSessionRegistry()
    const session = registry.get(null, 'thread-1')
    const sparse = session.hydrate(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      9,
    )
    expect(sparse.replayAfterId).toBe(0)
    expect(sparse.sparseTurnIds).toEqual(new Set(['turn-1']))

    const complete = session.hydrate(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'completed', items: [] }] },
      10,
    )
    expect(complete.replayAfterId).toBe(10)
    registry.dispose()
  })

  it('keeps mutable and immutable native reductions equivalent', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const notification = {
      method: 'item/agentMessage/delta',
      params: { turnId: 'turn-1', itemId: 'message-1', delta: 'Hello' },
    }
    const immutable = reduceCodexNotification(state, notification, '1')
    const mutable = structuredClone(state)
    applyCodexNotification(mutable, notification, '1')

    expect(mutable).toEqual(immutable)
  })

  it('releases inactive sessions after the registry cache limit', () => {
    const registry = new ThreadSessionRegistry()
    const first = registry.get(null, 'thread-0')
    for (let index = 1; index <= 20; index += 1) registry.get(null, `thread-${index}`)
    registry.release(null, 'thread-0')
    expect(first.hydrate({ id: 'thread-0', turns: [] }, 1)).toEqual({
      replayAfterId: 1,
      sparseTurnIds: new Set(),
    })
    registry.dispose()
  })

  it('bounds accumulated streamed assistant output without repeating the marker', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    const large = 'x'.repeat(210_000)
    const first = reduceCodexNotification(state, {
      method: 'item/agentMessage/delta',
      params: { turnId: 'turn-1', itemId: 'message-1', delta: large },
    })
    const second = reduceCodexNotification(first, {
      method: 'item/agentMessage/delta',
      params: { turnId: 'turn-1', itemId: 'message-1', delta: 'more' },
    })
    const turns = second.thread.turns as Array<{ items?: Array<{ text?: string }> }>
    const text = turns[0]?.items?.[0]?.text
    expect(text?.length).toBeLessThanOrEqual(200_000)
    expect(text?.match(/\[Content truncated\]/g)).toHaveLength(1)
  })

  it('bounds seen event ids while preserving recent duplicate detection', () => {
    const state = createCodexThreadState(
      { id: 'thread-1', turns: [{ id: 'turn-1', status: 'inProgress', items: [] }] },
      null,
    )
    for (let id = 1; id <= 2_010; id += 1) {
      applyCodexNotification(
        state,
        {
          method: 'item/agentMessage/delta',
          params: { turnId: 'turn-1', itemId: 'message-1', delta: '.' },
        },
        String(id),
      )
    }
    const text = (state.thread.turns as Array<{ items?: Array<{ text?: string }> }>)[0]?.items?.[0]
      ?.text
    expect(state.seenEventIds.size).toBe(2_000)
    expect(text).toHaveLength(2_010)
    applyCodexNotification(
      state,
      {
        method: 'item/agentMessage/delta',
        params: { turnId: 'turn-1', itemId: 'message-1', delta: 'duplicate' },
      },
      '2010',
    )
    expect(text).toHaveLength(2_010)
  })
})
