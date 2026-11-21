import { describe, expect, it, vi } from 'vitest'
import {
  createConversationSnapshot,
  type ConversationId,
  type TurnId,
} from '@codex-web/conversation'

import { ThreadSessionRegistry } from './state/thread-session-store'

describe('Thread session store', () => {
  it('replaces old turns with the authoritative reset snapshot', () => {
    const registry = new ThreadSessionRegistry()
    const conversationId = 'thread-1' as ConversationId
    const turnId = 'turn-1' as TurnId
    const session = registry.get(null, conversationId)
    session.replaceConversation({
      ...createConversationSnapshot(conversationId, 9),
      turns: { [turnId]: { id: turnId, status: 'inProgress', messageIds: [], activityIds: [] } },
    })
    expect(registry.get(null, conversationId)).toBe(session)
    expect(session.state.turnOrder).toEqual([turnId])
    expect(session.state.isBusy).toBe(true)
    session.replaceConversation(createConversationSnapshot(conversationId, 1))
    expect(session.state.turnOrder).toEqual([])
    expect(session.state.turnsById[turnId]).toBeUndefined()
    expect(session.state.isBusy).toBe(false)
    registry.dispose()
  })

  it('releases inactive sessions after the registry cache limit', () => {
    const registry = new ThreadSessionRegistry()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
    try {
      const oldest = registry.retain(null, 'thread-0')
      registry.release(null, 'thread-0')
      clock.mockReturnValue(1)
      for (let index = 1; index <= 19; index += 1) registry.get(null, `thread-${index}`)
      const newest = registry.retain(null, 'thread-20')
      registry.release(null, 'thread-20')

      expect(registry.get(null, 'thread-20')).toBe(newest)
      expect(registry.get(null, 'thread-0')).not.toBe(oldest)
      oldest.replaceConversation(createConversationSnapshot('thread-0' as ConversationId, 1))
      expect(oldest.state.status).toBe('idle')
    } finally {
      clock.mockRestore()
      registry.dispose()
    }
  })
})
