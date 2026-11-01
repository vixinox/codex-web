import assert from 'node:assert/strict'
import test from 'node:test'

import { createDomainEvent } from './domain-events.js'
import { EventHub } from './event-hub.js'

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
  hub.publish('user-a', { method: 'thread/closed', params: { threadId: 'thread-a' } })
  hub.publish('user-a', { method: 'thread/closed', params: { threadId: 'thread-b' } })

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
  hub.publish('user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  hub.publish('user-b', { method: 'turn/started', params: { threadId: 'thread-a' } })
  hub.publish('user-a', { method: 'turn/started', params: { threadId: 'thread-b' } })
  const received: number[] = []
  const unsubscribe = hub.subscribe('user-a', 'thread-a', 0, (event) => received.push(event.id))
  hub.publish('user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
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

  hub.publish('user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  hub.publish('user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })

  assert.deepEqual(received, [1, 2])
})

test('keeps live events after the remaining replay when a replay listener publishes', () => {
  const hub = new EventHub()
  hub.publish('user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  hub.publish('user-a', { method: 'item/started', params: { threadId: 'thread-a' } })
  const received: number[] = []
  hub.subscribe('user-a', 'thread-a', 0, (event) => {
    received.push(event.id)
    if (event.id === 1)
      hub.publish('user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  })

  assert.deepEqual(received, [1, 2, 3])
})

test('reports the latest retained event id per user without advancing on other users events', () => {
  const hub = new EventHub()
  assert.equal(hub.latestEventId('user-a'), 0)
  hub.publish('user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  assert.equal(hub.latestEventId('user-a'), 1)
  hub.publish('user-b', { method: 'turn/started', params: { threadId: 'thread-b' } })
  assert.equal(hub.latestEventId('user-a'), 1)
  assert.equal(hub.latestEventId('user-a', 'thread-a'), 1)
  hub.publish('user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  assert.equal(hub.latestEventId('user-a'), 3)
  assert.equal(hub.latestEventId('user-a', 'thread-b'), 0)
})

test('derives an isolated runtime status for a thread from retained events', () => {
  const hub = new EventHub()
  hub.publish('user-a', {
    method: 'turn/started',
    params: { threadId: 'thread-a', turn: { id: 'turn-a', status: 'inProgress' } },
  })
  hub.publish('user-b', {
    method: 'turn/started',
    params: { threadId: 'thread-a', turn: { id: 'other-turn', status: 'inProgress' } },
  })
  assert.deepEqual(hub.threadRuntimeStatus('user-a', 'thread-a'), {
    status: 'inProgress',
    activeTurnId: 'turn-a',
  })
  hub.publish('user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  assert.deepEqual(hub.threadRuntimeStatus('user-a', 'thread-a'), {
    status: 'completed',
    activeTurnId: null,
  })
})

test('exports and restores a bounded event snapshot without reusing ids', () => {
  const first = new EventHub()
  first.publish('user-a', { method: 'turn/started', params: { threadId: 'thread-a' } })
  const snapshot = first.snapshot()
  const restored = new EventHub()
  restored.restore(snapshot)
  const ids: number[] = []
  restored.subscribe('user-a', undefined, 0, (event) => ids.push(event.id))
  restored.publish('user-a', { method: 'turn/completed', params: { threadId: 'thread-a' } })
  assert.deepEqual(ids, [1, 2])
})

test('persists published events and reports write failures without poisoning later writes', async () => {
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
  hub.publish('user-a', { method: 'turn/started' })
  await assert.rejects(hub.flush(), /database unavailable/)
  hub.publish('user-a', { method: 'turn/completed' })
  await hub.flush()
  assert.deepEqual(saved, [2])
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
  hub.publish('user-a', { method: 'item/started', params: { threadId: 'thread-a' } })
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
