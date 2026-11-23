import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyChange,
  createConversationState,
  type EventIdentity,
  type SourceId,
} from '@codex-web/conversation'
import { isConversationChange } from '@codex-web/protocol/owner'
import { adaptCodexNotification, adaptCodexSnapshot } from './conversation-adapter.js'

const identity: EventIdentity = {
  sourceId: 'codex-app-server' as SourceId,
  sourceEventId: 'evt-1' as EventIdentity['sourceEventId'],
  receivedAt: '2026-01-01T00:00:01.000Z',
  occurredAt: '2026-01-01T00:00:00.000Z',
}

test('projects official item lifecycle timestamps from the notification, not receipt time', () => {
  const stream = activityStream()
  const item = { id: 'reply', type: 'agentMessage', text: 'Ready', phase: 'final_answer' }
  stream.send('item/started', { item, startedAtMs: Date.parse('2026-01-01T00:00:02.000Z') })
  stream.send('item/completed', { item, completedAtMs: Date.parse('2026-01-01T00:00:03.000Z') })
  const message = stream.state.messages.reply
  assert.equal(message?.createdAt, '2026-01-01T00:00:02.000Z')
  assert.equal(message?.completedAt, '2026-01-01T00:00:03.000Z')
  assert.equal(message?.phase, 'final_answer')
  assert.equal(message?.status, 'completed')
})

test('replaces plan and diff and accepts usage without an optional context window', () => {
  const stream = activityStream()
  stream.send('turn/plan/updated', {
    plan: [{ step: 'Check', status: 'pending' }],
    explanation: 'Initial',
  })
  stream.send('turn/plan/updated', {
    plan: [{ step: 'Check', status: 'completed' }],
    explanation: null,
  })
  stream.send('turn/diff/updated', { diff: '+initial' })
  stream.send('turn/diff/updated', { diff: '' })
  const usage = {
    inputTokens: 4,
    cachedInputTokens: 2,
    outputTokens: 1,
    reasoningOutputTokens: 0,
    totalTokens: 5,
  }
  stream.send('thread/tokenUsage/updated', {
    tokenUsage: { last: usage, total: { ...usage, cacheWriteInputTokens: 1 } },
  })
  assert.deepEqual(stream.state.turns['turn-1']?.plan, {
    steps: [{ step: 'Check', status: 'completed' }],
  })
  assert.equal(stream.state.turns['turn-1']?.diff, '')
  assert.deepEqual(stream.state.tokenUsage, {
    last: usage,
    total: { ...usage, cacheWriteInputTokens: 1 },
    modelContextWindow: null,
  })
  stream.send('thread/archived', {})
  assert.equal(stream.state.status, 'archived')
})

test('distinguishes ignored raw reasoning from unsupported and malformed notifications', () => {
  const stream = activityStream()
  assert.deepEqual(
    stream.send('item/reasoning/textDelta', {
      itemId: 'reason',
      contentIndex: 0,
      delta: 'synthetic-private-fixture',
    }),
    [],
  )
  for (const [method, params, code] of [
    [
      'thread/realtime/closed',
      { reason: 'synthetic-private-fixture' },
      'UNSUPPORTED_CONVERSATION_EVENT',
    ],
    [
      'turn/plan/updated',
      { plan: [{ step: 'synthetic-private-fixture', status: 'invalid' }] },
      'INVALID_TURN_PLAN',
    ],
    ['turn/diff/updated', { diff: { raw: 'synthetic-private-fixture' } }, 'INVALID_TURN_DIFF'],
    [
      'thread/tokenUsage/updated',
      { tokenUsage: { raw: 'synthetic-private-fixture' } },
      'INVALID_TOKEN_USAGE',
    ],
    ['item/completed', { item: { raw: 'synthetic-private-fixture' } }, 'INVALID_ITEM_LIFECYCLE'],
  ] as const) {
    const changes = stream.send(method, params)
    assert.equal(changes.length, 1)
    const [change] = changes
    assert.ok(change?.type === 'diagnostic', method)
    assert.equal(change.diagnostic.code, code)
    assert.deepEqual(change.diagnostic.identity, change.identity)
    assert.doesNotMatch(JSON.stringify(change), /synthetic-private-fixture/u)
  }
  assert.deepEqual(stream.state.activities, {})
})

test('maps a Codex thread snapshot into safe Conversation entities', () => {
  const snapshot = adaptCodexSnapshot(
    {
      id: 'thread-1',
      cwd: 'C:/private/workspace',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'message-1',
              type: 'agentMessage',
              status: 'completed',
              content: [{ type: 'text', text: 'Visible reply' }],
            },
            {
              id: 'command-1',
              type: 'commandExecution',
              command: 'pnpm test',
              status: 'completed',
            },
          ],
        },
      ],
    },
    9,
  )

  assert.equal(snapshot?.watermark, 9)
  assert.equal(snapshot?.messages['message-1']?.parts[0]?.type, 'text')
  assert.equal(snapshot?.activities['command-1']?.kind, 'commandExecution')
  assert.equal(JSON.stringify(snapshot).includes('private/workspace'), false)
})

test('maps streaming messages and pending interactions to typed changes', () => {
  const delta = adaptCodexNotification(
    'item/agentMessage/delta',
    { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'hello' },
    identity,
  )
  assert.deepEqual(
    delta.map((change) => change.type),
    ['message.upserted', 'message.textDelta'],
  )
  assert.equal(new Set(delta.map((change) => change.identity.sourceEventId)).size, 2)
  assert.ok(
    delta.every((change) => /^codex:[0-9a-f]{64}:\d+$/u.test(change.identity.sourceEventId)),
  )
  assert.ok(isConversationChange(delta[0]))

  const approval = adaptCodexNotification(
    'item/commandExecution/requestApproval',
    { threadId: 'thread-1', turnId: 'turn-1', requestId: 45 },
    identity,
  )
  assert.equal(approval[0]?.type, 'interaction.opened')
  if (approval[0]?.type === 'interaction.opened') {
    assert.equal(approval[0].interaction.kind, 'approval')
    assert.equal(approval[0].interaction.status, 'pending')
    assert.equal(approval[0].interaction.requestCorrelation, undefined)
  }
})

test('preserves the complete upstream turn failure for the owner transcript', () => {
  const [change] = adaptCodexNotification(
    'turn/failed',
    {
      threadId: 'thread-1',
      turn: {
        id: 'turn-1',
        status: 'failed',
        error: {
          message: 'Provider request failed',
          codexErrorInfo: { type: 'HttpConnectionFailed', httpStatusCode: 502 },
          additionalDetails: 'upstream body: temporary overload',
        },
      },
    },
    identity,
  )
  assert.ok(change?.type === 'turn.upserted')
  assert.equal(change.turn.failure?.message, 'Provider request failed')
  assert.match(change.turn.failure?.details ?? '', /temporary overload/u)
  assert.match(change.turn.failure?.details ?? '', /httpStatusCode/u)
})

test('maps file approvals using only identifiers and supported decisions', () => {
  const params = {
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'file-1',
    requestId: 'interaction-fixture',
    startedAtMs: 1_767_225_600_000,
    reason: 'private-fixture',
    grantRoot: null,
  }
  const method = 'item/fileChange/requestApproval'
  const [opened] = adaptCodexNotification(method, params, identity)
  assert.ok(opened?.type === 'interaction.opened')
  assert.equal(opened.interaction.activityId, 'file-1')
  assert.equal(opened.interaction.turnId, 'turn-1')
  assert.equal(opened.interaction.requestCorrelation, undefined)
  assert.equal(
    opened.interaction.details?.kind === 'approval' ? opened.interaction.details.reason : undefined,
    'private-fixture',
  )
  assert.ok(opened.interaction.details?.kind === 'approval')
  assert.deepEqual(
    opened.interaction.details.choices.map(({ id }) => id),
    ['accept', 'acceptForSession', 'decline', 'cancel'],
  )
  assert.match(JSON.stringify(opened), /private-fixture/u)
  const [rejected] = adaptCodexNotification(
    method,
    { ...params, grantRoot: 'C:/private-fixture' },
    identity,
  )
  assert.equal(rejected?.type, 'diagnostic')
  assert.doesNotMatch(JSON.stringify(rejected), /private-fixture/u)
})

test('unknown methods become bounded diagnostics without copying raw params', () => {
  const changes = adaptCodexNotification(
    'item/newSensitiveFeature',
    { threadId: 'thread-1', secret: 'do-not-store' },
    identity,
  )
  assert.equal(changes[0]?.type, 'diagnostic')
  assert.equal(JSON.stringify(changes).includes('do-not-store'), false)
})

function activityStream() {
  const snapshot = adaptCodexSnapshot({ id: 'thread-1', turns: [] }, 0)
  assert.ok(snapshot)
  let state = createConversationState(snapshot)
  let index = 0
  return {
    get state() {
      return state
    },
    send(method: string, params: Record<string, unknown>) {
      const changes = adaptCodexNotification(
        method,
        { threadId: 'thread-1', turnId: 'turn-1', ...params },
        {
          ...identity,
          sourceEventId: `activity-${index++}` as EventIdentity['sourceEventId'],
        },
      )
      for (const change of changes) {
        assert.ok(isConversationChange(change))
        state = applyChange(state, change)
      }
      return changes
    },
  }
}

test('appends interleaved command and file output without resetting existing details', () => {
  const stream = activityStream()
  stream.send('item/commandExecution/outputDelta', { itemId: 'command', delta: 'first\n' })
  stream.send('item/fileChange/outputDelta', { itemId: 'file', delta: 'applying\n' })
  stream.send('item/started', {
    item: {
      id: 'command',
      type: 'commandExecution',
      status: 'inProgress',
      command: 'pnpm test',
      aggregatedOutput: '',
    },
  })
  stream.send('item/commandExecution/outputDelta', {
    itemId: 'command',
    delta: 'token=synthetic-secret\n',
  })
  stream.send('item/fileChange/outputDelta', { itemId: 'file', delta: 'done' })
  assert.equal(stream.state.activities.command?.output, 'first\ntoken=synthetic-secret\n')
  assert.equal(stream.state.activities.command?.command, 'pnpm test')
  assert.equal(stream.state.activities.file?.output, 'applying\ndone')
  assert.deepEqual(stream.state.turns['turn-1']?.itemOrder, [
    { type: 'activity', id: 'command' },
    { type: 'activity', id: 'file' },
  ])
  stream.send('item/completed', {
    item: {
      id: 'command',
      type: 'commandExecution',
      status: 'completed',
      aggregatedOutput: 'canonical',
    },
  })
  stream.send('item/commandExecution/outputDelta', { itemId: 'command', delta: 'late' })
  assert.equal(stream.state.activities.command?.output, 'canonical')
  assert.equal(stream.state.activities.command?.status, 'completed')
})

test('replaces projected file patches without clearing streamed output', () => {
  const stream = activityStream()
  stream.send('item/fileChange/outputDelta', { itemId: 'file', delta: 'applying' })
  stream.send('item/fileChange/patchUpdated', {
    itemId: 'file',
    changes: [{ path: 'old.ts', kind: { type: 'add' }, diff: '+old' }],
  })
  const changes = stream.send('item/fileChange/patchUpdated', {
    itemId: 'file',
    changes: [
      {
        path: 'C:/private-fixture/new.ts',
        kind: { type: 'update', move_path: 'src/moved.ts' },
        diff: '+token=synthetic-secret',
        extra: 'raw-fixture',
      },
    ],
  })
  assert.deepEqual(stream.state.activities.file?.changes, [
    {
      path: 'C:/private-fixture/new.ts',
      kind: 'update',
      movePath: 'src/moved.ts',
      diff: '+token=synthetic-secret',
    },
  ])
  assert.match(JSON.stringify(changes), /private-fixture/u)
  assert.match(JSON.stringify(changes), /synthetic-secret/u)
  assert.doesNotMatch(JSON.stringify(changes), /raw-fixture/u)
  assert.equal(stream.state.activities.file?.output, 'applying')
  assert.equal(
    stream.send('item/fileChange/patchUpdated', { itemId: 'file', changes: [{}] })[0]?.type,
    'diagnostic',
  )
  assert.equal(stream.state.activities.file?.changes?.length, 1)
  stream.send('item/fileChange/patchUpdated', { itemId: 'file', changes: [] })
  assert.deepEqual(stream.state.activities.file?.changes, [])
})

test('streams plan text and the first public reasoning summary, then uses completed summaries', () => {
  const stream = activityStream()
  stream.send('item/plan/delta', { itemId: 'plan', delta: 'Check ' })
  stream.send('item/plan/delta', { itemId: 'plan', delta: 'results' })
  stream.send('item/reasoning/summaryPartAdded', { itemId: 'reasoning', summaryIndex: 0 })
  stream.send('item/reasoning/summaryTextDelta', {
    itemId: 'reasoning',
    summaryIndex: 0,
    delta: 'Public ',
  })
  stream.send('item/reasoning/summaryTextDelta', {
    itemId: 'reasoning',
    summaryIndex: 0,
    delta: 'summary',
  })
  assert.deepEqual(
    stream.send('item/reasoning/summaryTextDelta', {
      itemId: 'reasoning',
      summaryIndex: 1,
      delta: 'Second section',
    }),
    [],
  )
  assert.deepEqual(
    stream.send('item/reasoning/textDelta', {
      itemId: 'reasoning',
      contentIndex: 0,
      delta: 'private-fixture',
    }),
    [],
  )
  assert.equal(stream.state.activities.plan?.output, 'Check results')
  assert.equal(stream.state.activities.reasoning?.output, 'Public summary')
  stream.send('item/completed', {
    item: {
      id: 'reasoning',
      type: 'reasoning',
      summary: ['Public summary', 'Second section'],
      content: ['private-fixture'],
    },
  })
  assert.equal(stream.state.activities.reasoning?.output, 'Public summary\nSecond section')
  assert.doesNotMatch(JSON.stringify(stream.state.activities), /private-fixture/u)
  assert.equal(
    stream.send('item/reasoning/summaryTextDelta', {
      itemId: 'reasoning',
      summaryIndex: -1,
      delta: 'invalid',
    })[0]?.type,
    'diagnostic',
  )
})
