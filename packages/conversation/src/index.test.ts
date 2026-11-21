import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyChange,
  createConversationSnapshot,
  createConversationState,
  type Activity,
  type ConversationChange,
  type ConversationId,
  type Interaction,
  type Message,
  type SourceId,
  type Turn,
} from './index.js'

const conversationId = 'conversation-1' as ConversationId
const sourceId = 'fixture-adapter' as SourceId
const turn: Turn = {
  id: 'turn-1' as Turn['id'],
  status: 'inProgress',
  messageIds: [],
  activityIds: [],
}
const message: Message = {
  id: 'message-1' as Message['id'],
  turnId: turn.id,
  role: 'assistant',
  status: 'inProgress',
  parts: [{ id: 'part-1' as Message['parts'][number]['id'], type: 'text', text: '' }],
}
const activity: Activity = {
  id: 'activity-1' as Activity['id'],
  turnId: turn.id,
  kind: 'commandExecution',
  status: 'inProgress',
}
const interaction: Interaction = {
  id: 'interaction-1' as Interaction['id'],
  turnId: turn.id,
  kind: 'approval',
  status: 'pending',
  requestCorrelation: 42 as Interaction['requestCorrelation'],
}

function change<T extends ConversationChange['type']>(
  type: T,
  event: Omit<Extract<ConversationChange, { type: T }>, 'type' | 'identity'>,
  sourceEventId: string,
  applicationSequence: number,
): Extract<ConversationChange, { type: T }> {
  return {
    type,
    ...event,
    identity: {
      sourceId,
      sourceEventId: sourceEventId as ConversationChange['identity']['sourceEventId'],
      receivedAt: '2026-01-01T00:00:00.000Z',
      applicationSequence,
    },
  } as Extract<ConversationChange, { type: T }>
}

function initialState() {
  return createConversationState(createConversationSnapshot(conversationId))
}

test('applies assistant text deltas by stable part identity and deduplicates source events', () => {
  let state = applyChange(initialState(), change('turn.upserted', { turn }, 'turn', 1))
  state = applyChange(state, change('message.upserted', { message }, 'message', 2))
  const delta = change(
    'message.textDelta',
    { messageId: message.id, partId: message.parts[0]!.id, delta: 'Hello' },
    'delta-1',
    3,
  )
  state = applyChange(state, delta)
  const textPart = state.messages[message.id]?.parts[0]
  assert.equal(textPart?.type, 'text')
  if (textPart?.type === 'text') assert.equal(textPart.text, 'Hello')
  assert.equal(applyChange(state, delta), state)
  assert.equal(state.watermark, 3)
})

test('terminal turn, message, and activity lifecycle cannot be regressed', () => {
  let state = applyChange(initialState(), change('turn.upserted', { turn }, 'turn', 1))
  state = applyChange(state, change('message.upserted', { message }, 'message', 2))
  state = applyChange(state, change('activity.upserted', { activity }, 'activity', 3))
  state = applyChange(
    state,
    change('turn.statusChanged', { turnId: turn.id, status: 'completed' }, 'turn-done', 4),
  )
  state = applyChange(
    state,
    change(
      'message.statusChanged',
      { messageId: message.id, status: 'completed' },
      'message-done',
      5,
    ),
  )
  state = applyChange(
    state,
    change(
      'activity.statusChanged',
      { activityId: activity.id, status: 'completed' },
      'activity-done',
      6,
    ),
  )
  state = applyChange(
    state,
    change('turn.statusChanged', { turnId: turn.id, status: 'inProgress' }, 'turn-late', 7),
  )
  state = applyChange(
    state,
    change(
      'message.textDelta',
      { messageId: message.id, partId: message.parts[0]!.id, delta: 'late' },
      'message-late',
      8,
    ),
  )
  state = applyChange(
    state,
    change('activity.outputDelta', { activityId: activity.id, delta: 'late' }, 'activity-late', 9),
  )
  assert.equal(state.turns[turn.id]?.status, 'completed')
  const textPart = state.messages[message.id]?.parts[0]
  assert.equal(textPart?.type, 'text')
  if (textPart?.type === 'text') assert.equal(textPart.text, '')
  assert.equal(state.activities[activity.id]?.output, undefined)
})

test('interaction outcome and child-agent relation are retained as domain facts', () => {
  let state = applyChange(
    initialState(),
    change('interaction.opened', { interaction }, 'request', 1),
  )
  state = applyChange(
    state,
    change(
      'interaction.resolved',
      {
        interactionId: interaction.id,
        outcome: { kind: 'approved' },
      },
      'answer',
      2,
    ),
  )
  state = applyChange(
    state,
    change(
      'agentLink.upserted',
      {
        link: {
          id: 'link-1',
          parentConversationId: conversationId,
          childConversationId: 'child-conversation' as ConversationId,
          turnId: turn.id,
          task: 'Inspect files',
          status: 'running',
        },
      },
      'agent-link',
      3,
    ),
  )
  assert.deepEqual(state.interactions[interaction.id]?.outcome, { kind: 'approved' })
  assert.equal(state.interactions[interaction.id]?.status, 'resolved')
  assert.equal(state.agentLinks['link-1']?.childConversationId, 'child-conversation')
})

test('independent adapters conform to the same reducer without runtime-specific branches', () => {
  const codexFixtureAdapter = (input: { itemId: string; text: string }): ConversationChange[] => [
    change('message.upserted', { message }, input.itemId, 1),
    change(
      'message.textDelta',
      { messageId: message.id, partId: message.parts[0]!.id, delta: input.text },
      'stream-delta',
      2,
    ),
  ]
  const alternateFixtureAdapter = (input: {
    messageKey: string
    chunk: string
  }): ConversationChange[] => [
    change('message.upserted', { message }, input.messageKey, 1),
    change(
      'message.textDelta',
      { messageId: message.id, partId: message.parts[0]!.id, delta: input.chunk },
      'stream-delta',
      2,
    ),
  ]
  const reduceFixture = (changes: ConversationChange[]) =>
    changes.reduce(applyChange, initialState())
  assert.deepEqual(
    reduceFixture(codexFixtureAdapter({ itemId: 'shared-message', text: 'from fixture' })),
    reduceFixture(alternateFixtureAdapter({ messageKey: 'shared-message', chunk: 'from fixture' })),
  )
})

test('adapter diagnostics contain bounded summaries, not arbitrary extension payloads', () => {
  const diagnostic = {
    code: 'unsupported-change',
    sourceId,
    summary: 'Unsupported event shape',
    identity: {
      sourceId,
      sourceEventId: 'unknown-1' as ConversationChange['identity']['sourceEventId'],
      receivedAt: '2026-01-01T00:00:00.000Z',
    },
  }
  const state = applyChange(initialState(), change('diagnostic', { diagnostic }, 'diagnostic', 1))
  assert.deepEqual(state.diagnostics, [diagnostic])
  assert.equal('payload' in diagnostic, false)
})

test('completion without a body retains message and activity deltas in the shared model', () => {
  let state = applyChange(initialState(), change('message.upserted', { message }, 'm-start', 1))
  state = applyChange(
    state,
    change(
      'message.textDelta',
      {
        messageId: message.id,
        partId: message.parts[0]!.id,
        delta: 'token=synthetic C:/workspace',
      },
      'm-delta',
      2,
    ),
  )
  state = applyChange(
    state,
    change('message.upserted', { message: { ...message, status: 'completed' } }, 'm-done', 3),
  )
  assert.deepEqual(state.messages[message.id]?.parts, [
    { ...message.parts[0], text: 'token=synthetic C:/workspace' },
  ])
  state = applyChange(state, change('activity.upserted', { activity }, 'a-start', 4))
  state = applyChange(
    state,
    change(
      'activity.outputDelta',
      { activityId: activity.id, delta: '/synthetic/path' },
      'a-delta',
      5,
    ),
  )
  state = applyChange(
    state,
    change(
      'activity.upserted',
      { activity: { ...activity, status: 'completed', output: '' } },
      'a-done',
      6,
    ),
  )
  assert.equal(state.activities[activity.id]?.output, '/synthetic/path')
  assert.equal(state.activities[activity.id]?.status, 'completed')
})
