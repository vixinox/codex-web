import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyChange,
  createConversationSnapshot,
  createConversationState,
  type ActivityId,
  type AgentId,
  type ConversationChange,
  type ConversationCommand,
  type ConversationId,
  type ConversationSnapshot,
  type InteractionId,
  type MessageId,
  type MessagePartId,
  type RuntimeRequestId,
  type SourceEventId,
  type SourceId,
  type TurnId,
} from './index.js'

type Signal =
  | ['caption', string]
  | ['fragment', string, string]
  | ['check', number]
  | ['checked', number]
  | ['gate', number, number]
  | ['delegated', string, string, string]
  | ['decision', number, boolean]

function syntheticAdapter(room: string, batch: number) {
  const conversationId = `room:${room}` as ConversationId
  const turnId = `batch:${batch}` as TurnId
  const messageId = (label: string) => `caption:${label}` as MessageId
  const partId = (label: string) => `text:${label}` as MessagePartId
  const activityId = (ticket: number) => `check:${ticket}` as ActivityId
  const interactionId = (token: number) => `gate:${token}` as InteractionId
  const tokens = new Map<InteractionId, number>()

  return {
    open(offset: number): ConversationSnapshot {
      return {
        ...createConversationSnapshot(conversationId, offset),
        status: 'active',
        turns: { [turnId]: { id: turnId, status: 'inProgress', messageIds: [], activityIds: [] } },
      }
    },
    receive(offset: number, signal: Signal): ConversationChange {
      const identity = {
        sourceId: 'synthetic-batch-runtime' as SourceId,
        sourceEventId: `${room}:${offset}` as SourceEventId,
        applicationSequence: offset,
        receivedAt: '2026-01-01T00:00:00.000Z',
      }
      switch (signal[0]) {
        case 'caption': {
          const [, label] = signal
          return {
            type: 'message.upserted',
            identity,
            message: {
              id: messageId(label),
              turnId,
              role: 'assistant',
              status: 'inProgress',
              parts: [{ id: partId(label), type: 'text', text: '' }],
            },
          }
        }
        case 'fragment': {
          const [, label, fragment] = signal
          return {
            type: 'message.textDelta',
            identity,
            messageId: messageId(label),
            partId: partId(label),
            delta: fragment,
          }
        }
        case 'check':
          return {
            type: 'activity.upserted',
            identity,
            activity: { id: activityId(signal[1]), turnId, kind: 'other', status: 'pending' },
          }
        case 'checked':
          return {
            type: 'activity.statusChanged',
            identity,
            activityId: activityId(signal[1]),
            status: 'completed',
          }
        case 'gate': {
          const [, token, ticket] = signal
          const id = interactionId(token)
          tokens.set(id, token)
          return {
            type: 'interaction.opened',
            identity,
            interaction: {
              id,
              turnId,
              activityId: activityId(ticket),
              kind: 'approval',
              status: 'pending',
              requestCorrelation: token as RuntimeRequestId,
            },
          }
        }
        case 'delegated': {
          const [, worker, childRoom, assignment] = signal
          return {
            type: 'agentLink.upserted',
            identity,
            link: {
              id: `link:${worker}`,
              parentAgentId: 'agent:coordinator' as AgentId,
              childAgentId: `agent:${worker}` as AgentId,
              parentConversationId: conversationId,
              childConversationId: `room:${childRoom}` as ConversationId,
              turnId,
              task: assignment,
              status: 'running',
            },
          }
        }
        case 'decision': {
          const [, token, allow] = signal
          return {
            type: 'interaction.resolved',
            identity,
            interactionId: interactionId(token),
            outcome: { kind: allow ? 'approved' : 'rejected' },
          }
        }
      }
    },
    send(command: ConversationCommand) {
      assert.equal(command.conversationId, conversationId)
      switch (command.type) {
        case 'turn.start':
          return ['enqueue', room, command.input] as const
        case 'turn.cancel':
          assert.equal(command.turnId, turnId)
          return ['halt', batch] as const
        case 'interaction.respond': {
          const token = tokens.get(command.interactionId)
          assert.ok(token !== undefined)
          assert.ok(command.outcome.kind === 'approved' || command.outcome.kind === 'rejected')
          return ['unlock', token, command.outcome.kind === 'approved'] as const
        }
        case 'conversation.archive':
          return ['shelve', room] as const
        default: {
          const unhandled: never = command
          throw new Error(`Unhandled synthetic command: ${String(unhandled)}`)
        }
      }
    },
  }
}

test('synthetic adapter snapshot and events use the shared reducer', () => {
  const adapter = syntheticAdapter('desk', 7)
  const snapshot = adapter.open(20)
  const state = [
    adapter.receive(21, ['caption', 'summary']),
    adapter.receive(22, ['fragment', 'summary', 'Sample ']),
    adapter.receive(23, ['fragment', 'summary', 'ready']),
    adapter.receive(23, ['fragment', 'summary', 'ready']),
    adapter.receive(24, ['check', 3]),
    adapter.receive(25, ['gate', 41, 3]),
    adapter.receive(26, ['delegated', 'reviewer', 'annex', 'Review sample']),
    adapter.receive(27, ['checked', 3]),
  ].reduce(applyChange, createConversationState(snapshot))

  assert.equal(snapshot.watermark, 20)
  assert.equal(state.watermark, 27)
  assert.deepEqual(state.turns['batch:7'], {
    id: 'batch:7',
    status: 'inProgress',
    messageIds: ['caption:summary'],
    activityIds: ['check:3'],
  })
  assert.deepEqual(state.messages['caption:summary'], {
    id: 'caption:summary',
    turnId: 'batch:7',
    role: 'assistant',
    status: 'inProgress',
    parts: [{ id: 'text:summary', type: 'text', text: 'Sample ready' }],
  })
  assert.deepEqual(state.activities['check:3'], {
    id: 'check:3',
    turnId: 'batch:7',
    kind: 'other',
    status: 'completed',
  })
  assert.deepEqual(state.interactions['gate:41'], {
    id: 'gate:41',
    turnId: 'batch:7',
    activityId: 'check:3',
    kind: 'approval',
    status: 'pending',
    requestCorrelation: 41,
  })
  assert.deepEqual(state.agentLinks['link:reviewer'], {
    id: 'link:reviewer',
    parentAgentId: 'agent:coordinator',
    childAgentId: 'agent:reviewer',
    parentConversationId: 'room:desk',
    childConversationId: 'room:annex',
    turnId: 'batch:7',
    task: 'Review sample',
    status: 'running',
  })
})

test('synthetic adapter accepts domain commands and correlates the reply with the pending interaction', () => {
  const adapter = syntheticAdapter('desk', 7)
  const snapshot = adapter.open(20)
  const conversationId = snapshot.id
  const turn = snapshot.turns['batch:7']
  assert.ok(turn)

  const input = [
    { id: 'input-text' as MessagePartId, type: 'text' as const, text: 'Review sample' },
  ]
  assert.deepEqual(adapter.send({ type: 'turn.start', conversationId, input }), [
    'enqueue',
    'desk',
    input,
  ])
  assert.deepEqual(adapter.send({ type: 'turn.cancel', conversationId, turnId: turn.id }), [
    'halt',
    7,
  ])
  assert.deepEqual(adapter.send({ type: 'conversation.archive', conversationId }), [
    'shelve',
    'desk',
  ])

  const pending = [adapter.receive(21, ['check', 3]), adapter.receive(22, ['gate', 42, 3])].reduce(
    applyChange,
    createConversationState(snapshot),
  )
  const interaction = pending.interactions['gate:42']
  assert.ok(interaction)
  const reply = adapter.send({
    type: 'interaction.respond',
    conversationId,
    interactionId: interaction.id,
    outcome: { kind: 'rejected' },
  })
  assert.deepEqual(reply, ['unlock', 42, false])
  assert.ok(reply[0] === 'unlock')
  const [, token, allow] = reply
  const resolved = applyChange(pending, adapter.receive(23, ['decision', token, allow]))
  assert.equal(pending.interactions[interaction.id]?.status, 'pending')
  assert.deepEqual(resolved.interactions[interaction.id], {
    ...interaction,
    status: 'resolved',
    outcome: { kind: 'rejected' },
  })
})
