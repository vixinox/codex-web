import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationId, EventIdentity } from '@codex-web/conversation'

import { createDomainEvent } from './domain-events.js'
import { EventHub } from './event-hub.js'

function publishFixture(hub: EventHub, userId: string, value: unknown) {
  const message = value as { method: string; params: { threadId?: string } }
  return hub.publishDomain(
    userId,
    createDomainEvent(
      `codex.${message.method}`,
      message.params,
      message.params.threadId ? { threadId: message.params.threadId } : {},
    ),
  )
}

function storedEvent(id: number, method: string, threadId: string) {
  return {
    id,
    message: {
      ...createDomainEvent(`codex.${method}`, { threadId }, { threadId }),
      eventId: id,
    },
  }
}

test('assigns one global sequence and stores a domain envelope before notifying listeners', () => {
  const hub = new EventHub()
  const received: Array<{ id: number; message: Record<string, unknown> }> = []
  hub.subscribe('user-a', undefined, 0, (event) => received.push(event))
  publishFixture(hub, 'user-a', { method: 'thread/closed', params: { threadId: 'thread-a' } })
  publishFixture(hub, 'user-a', { method: 'thread/closed', params: { threadId: 'thread-b' } })

  assert.deepEqual(
    received.map(({ id, message }) => ({
      id,
      eventId: message.eventId,
      type: message.type,
      threadId: message.threadId,
    })),
    [
      { id: 1, eventId: 1, type: 'codex.thread/closed', threadId: 'thread-a' },
      { id: 2, eventId: 2, type: 'codex.thread/closed', threadId: 'thread-b' },
    ],
  )
})

test('isolates users, filters threads, and replays after Last-Event-ID', () => {
  const hub = new EventHub()
  publishFixture(hub, 'user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  publishFixture(hub, 'user-b', { method: 'turn/started', params: { threadId: 'thread-a' } })
  publishFixture(hub, 'user-a', { method: 'turn/started', params: { threadId: 'thread-b' } })
  const received: number[] = []
  const unsubscribe = hub.subscribe('user-a', 'thread-a', 0, (event) => received.push(event.id))
  publishFixture(hub, 'user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  unsubscribe()
  assert.equal(received.length, 2)
  const replayed: number[] = []
  hub.subscribe('user-a', 'thread-a', received[0], (event) => replayed.push(event.id))
  assert.deepEqual(replayed, [received[1]])
})

test('does not deliver a replayed event twice when subscription is reentrant', () => {
  const hub = new EventHub()
  const received: number[] = []
  let subscribed = false
  hub.subscribe('user-a', 'thread-a', 0, (event) => {
    if (subscribed) return
    subscribed = true
    hub.subscribe('user-a', 'thread-a', 0, (replayed) => received.push(replayed.id))
    assert.equal(event.id, 1)
  })

  publishFixture(hub, 'user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  publishFixture(hub, 'user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })

  assert.deepEqual(received, [1, 2])
})

test('keeps live events after the remaining replay when a replay listener publishes', () => {
  const hub = new EventHub()
  publishFixture(hub, 'user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  publishFixture(hub, 'user-a', { method: 'item/started', params: { threadId: 'thread-a' } })
  const received: number[] = []
  hub.subscribe('user-a', 'thread-a', 0, (event) => {
    received.push(event.id)
    if (event.id === 1)
      publishFixture(hub, 'user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  })

  assert.deepEqual(received, [1, 2, 3])
})

test('reports the latest retained event id per user without advancing on other users events', () => {
  const hub = new EventHub()
  assert.equal(hub.latestEventId('user-a'), 0)
  publishFixture(hub, 'user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  assert.equal(hub.latestEventId('user-a'), 1)
  publishFixture(hub, 'user-b', { method: 'turn/started', params: { threadId: 'thread-b' } })
  assert.equal(hub.latestEventId('user-a'), 1)
  assert.equal(hub.latestEventId('user-a', 'thread-a'), 1)
  publishFixture(hub, 'user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  assert.equal(hub.latestEventId('user-a'), 3)
  assert.equal(hub.latestEventId('user-a', 'thread-b'), 0)
})

test('exports and restores a bounded event snapshot without reusing ids', () => {
  const first = new EventHub()
  publishFixture(first, 'user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  const snapshot = first.snapshot()
  const restored = new EventHub()
  restored.restore(snapshot)
  const ids: number[] = []
  restored.subscribe('user-a', undefined, 0, (event) => ids.push(event.id))
  publishFixture(restored, 'user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  assert.deepEqual(ids, [1, 2])
})

test('resets affected streams on write failure without poisoning other streams or later writes', async () => {
  const conversationId = 'thread-a' as ConversationId
  const saved: number[] = []
  let fail = true
  const hub = new EventHub({
    append: async (_userId, event) => {
      if (fail) {
        fail = false
        throw new Error('database unavailable')
      }
      saved.push(event.id)
    },
  })
  const delivered: number[] = []
  const otherDelivered: number[] = []
  const resets: string[] = []
  const stopThread = await hub.subscribeFrom(
    'user-a',
    conversationId,
    0,
    (event) => delivered.push(event.id),
    () => resets.push('thread'),
  )
  const stopWorkspace = await hub.subscribeFrom(
    'user-a',
    undefined,
    0,
    (event) => delivered.push(event.id),
    () => resets.push('workspace'),
  )
  const stopOther = await hub.subscribeFrom(
    'user-a',
    'thread-b',
    0,
    (event) => otherDelivered.push(event.id),
    () => resets.push('other'),
  )
  const publish = (sourceEventId: string, target = conversationId) =>
    hub.publishConversationChange('user-a', target, {
      type: 'conversation.updated',
      conversationId: target,
      status: 'active',
      identity: {
        sourceId: 'test-adapter' as EventIdentity['sourceId'],
        sourceEventId: sourceEventId as EventIdentity['sourceEventId'],
        receivedAt: '2026-01-01T00:00:00.000Z',
      },
    })
  await publish('first')
  assert.deepEqual(delivered, [])
  assert.deepEqual(resets, ['thread', 'workspace'])
  await assert.rejects(hub.flush(), /database unavailable/)
  await publish('second')
  await publish('other', 'thread-b' as ConversationId)
  await hub.flush()
  assert.deepEqual(saved, [2, 3])
  assert.deepEqual(delivered, [])
  assert.deepEqual(otherDelivered, [3])
  assert.equal(await hub.isCursorExpired('user-a', conversationId, 0), true)
  assert.equal(await hub.isCursorExpired('user-a', 'thread-b', 0), false)
  await hub.subscribeFrom(
    'user-a',
    conversationId,
    0,
    (event) => delivered.push(event.id),
    () => resets.push('resume'),
  )
  assert.deepEqual(resets, ['thread', 'workspace', 'resume'])
  const stopRecovered = await hub.subscribeFrom('user-a', conversationId, 2, (event) =>
    delivered.push(event.id),
  )
  await publish('after-snapshot')
  assert.deepEqual(delivered, [4])
  for (const stop of [stopThread, stopWorkspace, stopOther, stopRecovered]) stop()
})

test('rejects a snapshot cut after a failed tail write without a later append', async () => {
  const conversationId = 'thread-a' as ConversationId
  const hub = new EventHub({
    append: async (_userId, event) => {
      if (event.id === 2) throw new Error('database unavailable')
    },
  })
  const publish = (sourceEventId: string) =>
    hub.publishConversationChange('user-a', conversationId, {
      type: 'conversation.updated',
      conversationId,
      status: 'active',
      identity: {
        sourceId: 'test-adapter' as EventIdentity['sourceId'],
        sourceEventId: sourceEventId as EventIdentity['sourceEventId'],
        receivedAt: '2026-01-01T00:00:00.000Z',
      },
    })
  await publish('committed')
  const { sequence } = await hub.captureThreadSnapshot('user-a', conversationId)
  assert.equal(sequence, 1)
  const delivered: number[] = []
  let resets = 0
  const unsubscribe = await hub.subscribeFrom(
    'user-a',
    conversationId,
    sequence,
    (event) => delivered.push(event.id),
    () => resets++,
  )
  try {
    const failedWrite = publish('failed-tail')
    await assert.rejects(hub.captureThreadSnapshot('user-a', conversationId))
    await failedWrite
    assert.equal(hub.latestEventId('user-a', conversationId), sequence)
    assert.deepEqual(delivered, [])
    assert.equal(resets, 1)
    await assert.rejects(hub.flush(), /database unavailable/)
    await assert.rejects(hub.captureThreadSnapshot('user-a', conversationId))
  } finally {
    unsubscribe()
  }
})

test('delivers non-thread events live without writing them to the store', async () => {
  const saved: number[] = []
  const hub = new EventHub({
    append: async (_userId, event) => saved.push(event.id),
  })
  const delivered: number[] = []
  hub.subscribe('user-a', undefined, 0, (event) => delivered.push(event.id))
  await publishFixture(hub, 'user-a', { method: 'skills/updated', params: {} })
  assert.deepEqual(delivered, [1])
  assert.deepEqual(saved, [])
})

test('merges persisted and in-memory history for one thread without leaking others', async () => {
  const hub = new EventHub({
    append: async () => {},
    loadThread: async (_userId, threadId) => {
      const all = [
        storedEvent(1, 'turn/started', 'thread-a'),
        storedEvent(3, 'turn/completed', 'thread-a'),
        storedEvent(7, 'turn/started', 'thread-b'),
      ]
      return all.filter((event) => event.message.threadId === threadId)
    },
  })
  hub.restore({ nextId: 6, events: {} })
  publishFixture(hub, 'user-a', { method: 'item/started', params: { threadId: 'thread-a' } })
  const history = await hub.threadHistory('user-a', 'thread-a')
  assert.deepEqual(
    history.map((event) => event.id),
    [1, 3, 6],
  )
})

test('dedupes restored in-memory events that also exist in the store', async () => {
  const hub = new EventHub({
    append: async () => {},
    loadThread: async () => [storedEvent(2, 'turn/started', 'thread-a')],
  })
  hub.restore({
    nextId: 3,
    events: {
      'user-a': [
        storedEvent(2, 'turn/started', 'thread-a'),
        storedEvent(1, 'turn/started', 'thread-a'),
      ],
    },
  })
  const history = await hub.threadHistory('user-a', 'thread-a')
  assert.deepEqual(
    history.map((event) => event.id),
    [1, 2],
  )
})

test('rejects oversized changes explicitly and marks the stream incomplete', async () => {
  const hub = new EventHub()
  let gaps = 0
  const delivered: unknown[] = []
  await hub.subscribeFrom(
    'owner',
    'thread-a',
    0,
    (event) => delivered.push(event),
    () => gaps++,
  )
  await assert.rejects(
    hub.publishConversationChange('owner', 'thread-a', {
      type: 'conversation.updated',
      conversationId: 'thread-a' as ConversationId,
      title: 'x'.repeat(128_001),
      identity: {
        sourceId: 'fixture' as EventIdentity['sourceId'],
        sourceEventId: 'large' as EventIdentity['sourceEventId'],
        receivedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
    /oversized/u,
  )
  assert.equal(gaps, 1)
  assert.deepEqual(delivered, [])
  await assert.rejects(hub.captureThreadSnapshot('owner', 'thread-a'), /incomplete/u)
  await assert.rejects(hub.flush(), /oversized/u)
})
