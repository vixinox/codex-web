import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adaptCodexMessage,
  createDomainEvent,
  MAX_EXTENSION_PAYLOAD_BYTES,
  projectDomainEvent,
} from './domain-events.js'

const codexEventFixture = [
  {
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', items: [] } },
  },
  {
    method: 'item/started',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        id: 'command-1',
        type: 'commandExecution',
        status: 'inProgress',
        command: 'pnpm test',
      },
    },
  },
  {
    method: 'item/commandExecution/outputDelta',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'command-1', delta: 'passed' },
  },
  {
    method: 'item/commandExecution/requestApproval',
    id: 'approval-1',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'command-1',
      requestId: 41,
    },
  },
  {
    method: 'thread/tokenUsage/updated',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      tokenUsage: {
        modelContextWindow: 1000,
        last: { inputTokens: 2, outputTokens: 3, reasoningOutputTokens: 0, totalTokens: 5 },
        total: { inputTokens: 20, outputTokens: 30, reasoningOutputTokens: 0, totalTokens: 50 },
      },
    },
  },
  {
    method: 'future/notification',
    params: {
      threadId: 'thread-1',
      cwd: 'C:/Users/owner/private',
      detail: { apiKey: 'secret', label: 'retained' },
    },
  },
  {
    method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } },
  },
]

test('adapts a documented Codex notification into a versioned domain event', () => {
  const result = adaptCodexMessage(
    {
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: 'hello',
      },
    },
    '2026-01-01T00:00:00.000Z',
  )
  assert.equal(result.kind, 'event')
  if (result.kind !== 'event') return
  assert.deepEqual(result.event, {
    schemaVersion: 1,
    type: 'codex.item/agentMessage/delta',
    runtime: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    payload: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'hello' },
  })
})

test('adapts interleaved lifecycle, command, approval, usage, and extension fixtures in order', () => {
  const results = codexEventFixture.map((message) =>
    adaptCodexMessage(message, '2026-01-01T00:00:00.000Z'),
  )
  assert.deepEqual(
    results.map((result) => result.kind),
    ['event', 'event', 'event', 'event', 'event', 'extension', 'event'],
  )
  const events = results.flatMap((result) => (result.kind === 'invalid' ? [] : [result.event]))
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'codex.turn/started',
      'codex.item/started',
      'codex.item/commandExecution/outputDelta',
      'codex.item/commandExecution/requestApproval',
      'codex.thread/tokenUsage/updated',
      'runtime.extension',
      'codex.turn/completed',
    ],
  )
  assert.equal(events[3]?.requestId, 41)
  assert.equal(events[5]?.threadId, 'thread-1')
  assert.deepEqual(events[5]?.payload.params, {
    threadId: 'thread-1',
    cwd: '[redacted]',
    detail: { apiKey: '[redacted]', label: 'retained' },
  })
})

test('keeps unknown valid runtime messages as bounded extension events', () => {
  const result = adaptCodexMessage({
    method: 'future/notification',
    params: { token: 'secret', value: 'visible' },
  })
  assert.equal(result.kind, 'extension')
  if (result.kind !== 'extension') return
  assert.deepEqual(result.event.payload, {
    method: 'future/notification',
    params: { token: '[redacted]', value: 'visible' },
  })
})

test('redacts nested secrets and bounds extension payloads by UTF-8 bytes', () => {
  const nested = adaptCodexMessage({
    method: 'future/notification',
    params: {
      nested: { authorization: 'Bearer secret', value: '保留' },
      cwd: 'C:/Users/owner/project',
    },
  })
  assert.equal(nested.kind, 'extension')
  if (nested.kind !== 'extension') return
  assert.deepEqual(nested.event.payload.params, {
    nested: { authorization: '[redacted]', value: '保留' },
    cwd: '[redacted]',
  })

  const result = adaptCodexMessage({
    method: 'future/notification',
    params: {
      nested: { authorization: 'Bearer secret' },
      huge: '😀'.repeat(MAX_EXTENSION_PAYLOAD_BYTES),
    },
  })
  assert.equal(result.kind, 'extension')
  if (result.kind !== 'extension') return
  const encoded = JSON.stringify(result.event.payload)
  assert.ok(Buffer.byteLength(encoded, 'utf8') <= MAX_EXTENSION_PAYLOAD_BYTES)
  assert.equal(encoded.includes('Bearer secret'), false)
  assert.equal(result.event.payload.truncated, true)
})

test('turns malformed messages into diagnostics and assigns stable ids at projection', () => {
  const result = adaptCodexMessage({ method: 'error', params: [] })
  assert.equal(result.kind, 'invalid')
  const projected = projectDomainEvent({
    ...createDomainEvent('runtime.diagnostic', { code: 'INVALID_MESSAGE' }),
    eventId: 9,
  })
  assert.equal(projected.eventId, 9)
  assert.equal(projected.schemaVersion, 1)
})
