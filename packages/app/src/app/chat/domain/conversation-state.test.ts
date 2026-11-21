import {
  createConversationSnapshot,
  createConversationState,
  type ConversationChange,
  type ConversationId,
  type EventIdentity,
  type Interaction,
  type InteractionId,
  type TurnId,
} from '@codex-web/conversation'
import { describe, expect, it } from 'vitest'
import { applyConversationDelivery } from './conversation-state'

const conversationId = 'conversation' as ConversationId
const turnId = 'turn' as TurnId
const interactionId = 'questionnaire' as InteractionId

function identity(sequence: number, sourceEventId = `event-${sequence}`): EventIdentity {
  return {
    sourceId: 'test-adapter' as EventIdentity['sourceId'],
    sourceEventId: sourceEventId as EventIdentity['sourceEventId'],
    applicationSequence: sequence,
    receivedAt: '2026-01-01T00:00:00Z',
  }
}

function rename(sequence: number, title: string, sourceEventId?: string): ConversationChange {
  return {
    type: 'conversation.updated',
    identity: identity(sequence, sourceEventId),
    conversationId,
    title,
  }
}

describe('conversation delivery', () => {
  it('uses the open snapshot watermark and drops replayed changes on resume', () => {
    const snapshot = { ...createConversationSnapshot(conversationId, 4), title: 'Snapshot' }
    const opened = createConversationState(snapshot)
    expect(applyConversationDelivery(opened, rename(4, 'Covered'))).toBe(opened)
    const live = applyConversationDelivery(opened, rename(5, 'Live'))
    expect(live).toMatchObject({ title: 'Live', watermark: 5 })
    expect(applyConversationDelivery(live, rename(5, 'Replay'))).toBe(live)
    expect(applyConversationDelivery(live, rename(6, 'Duplicate', 'event-5'))).toBe(live)
    expect(snapshot.title).toBe('Snapshot')
  })

  it('replaces old history and source identities when the client supplies a reset snapshot', () => {
    const opened = createConversationState(createConversationSnapshot(conversationId, 10))
    const previous = applyConversationDelivery(opened, rename(11, 'Old', 'same-event'))
    const replacement = createConversationState(createConversationSnapshot(conversationId, 1))
    const resumed = applyConversationDelivery(replacement, rename(2, 'New', 'same-event'))
    expect(previous.title).toBe('Old')
    expect(resumed).toMatchObject({ title: 'New', watermark: 2 })
  })

  it.each(['resolved', 'cancelled', 'expired'] as const)(
    'retains a %s interaction and child link',
    (status) => {
      const interaction: Interaction = {
        id: interactionId,
        turnId,
        kind: 'userInput',
        status: 'pending',
      }
      const opened = createConversationState(createConversationSnapshot(conversationId))
      const pending = applyConversationDelivery(opened, {
        type: 'interaction.opened',
        identity: identity(1),
        interaction,
      })
      expect(pending.interactions[interactionId]?.status).toBe('pending')
      const childConversationId = 'child' as ConversationId
      const linked = applyConversationDelivery(pending, {
        type: 'agentLink.upserted',
        identity: identity(2),
        link: {
          id: 'link',
          turnId,
          parentConversationId: conversationId,
          childConversationId,
          status: 'running',
        },
      })
      const finished = applyConversationDelivery(
        linked,
        status === 'resolved'
          ? {
              type: 'interaction.resolved',
              identity: identity(3),
              interactionId,
              outcome: { kind: 'answers', answers: { question: ['yes'] } },
            }
          : { type: 'interaction.cancelled', identity: identity(3), interactionId, status },
      )
      expect(finished.interactions[interactionId]?.status).toBe(status)
      expect(finished.agentLinks.link).toMatchObject({
        parentConversationId: conversationId,
        childConversationId,
        turnId,
      })
    },
  )
})
