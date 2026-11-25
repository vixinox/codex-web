import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'

import type {
  ConversationChange,
  ConversationId,
  SourceEventId,
  SourceId,
} from '@codex-web/conversation'
import type { DomainEventEnvelope } from '@codex-web/protocol/owner'

import { openEventStoreTestDatabase } from './event-store-test-fixture.js'
import { conversationEvent, owner } from '../db/schema.js'
import { log } from '../logger.js'
import { EventHub } from './event-hub.js'
import { SqliteEventStore } from './event-store.js'

const ownerId = 'owner-events'
const createdAt = '2026-01-01T00:00:00.000Z'

function fixture(context: TestContext) {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-conversation-events-'))
  const { db, driver } = openEventStoreTestDatabase(path.join(dataRoot, 'owner.sqlite'))
  context.after(() => {
    driver.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })
  db.insert(owner).values({ id: ownerId }).run()
  return { db, driver, store: new SqliteEventStore(db) }
}

function event(id: number, conversationId = 'thread-a', applicationSequence = id) {
  const change: ConversationChange = {
    type: 'conversation.updated',
    conversationId: conversationId as ConversationId,
    status: 'active',
    identity: {
      sourceId: 'synthetic-store-test' as SourceId,
      sourceEventId: `source-${id}` as SourceEventId,
      receivedAt: createdAt,
      applicationSequence,
    },
  }
  const message = {
    eventId: id,
    type: 'conversation.change',
    runtime: 'codex',
    threadId: conversationId,
    createdAt,
    payload: { change },
  } satisfies DomainEventEnvelope
  return { id, message }
}

test('stores only typed changes, retains each conversation, and reconstructs replay envelopes', async (context) => {
  const { db, store } = fixture(context)
  const first = event(1)
  const other = event(2, 'thread-b')
  const earlier = event(3)
  const latest = event(4)
  for (const entry of [first, other, earlier, latest]) await store.append(ownerId, entry)
  await store.retainPerThread(2)

  assert.deepEqual(
    db.select().from(conversationEvent).orderBy(conversationEvent.id).all(),
    [other, earlier, latest].map(({ id, message }) => ({
      id,
      ownerId,
      conversationId: message.threadId,
      change: message.payload.change,
      createdAt,
    })),
  )
  assert.deepEqual(await store.loadThread(ownerId, 'thread-a', 3), [earlier])
  assert.deepEqual(await store.loadThread(ownerId, 'thread-b'), [other])
  assert.deepEqual((await store.loadAfter(ownerId, 0, 'thread-a')).events, [earlier, latest])
  const restored = await new SqliteEventStore(db).load()
  assert.deepEqual(restored, { nextId: 5, events: { [ownerId]: [other, earlier, latest] } })
})

test('rejects append with a mismatched application sequence without persisting a row', async (context) => {
  const { db, store } = fixture(context)
  await assert.rejects(store.append(ownerId, event(1, 'thread-a', 2)))
  assert.deepEqual(db.select().from(conversationEvent).all(), [])
})

test('skips invalid persisted changes without reusing their sequence on restore', async (context) => {
  const warnings = context.mock.method(log, 'warn', () => undefined)
  const { driver, store } = fixture(context)
  const valid = event(1)
  await store.append(ownerId, valid)
  const insert = driver.prepare(
    'INSERT INTO conversation_events (id, owner_id, conversation_id, change, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  const invalidSequence = event(2, 'thread-a', 1).message.payload.change
  const wrongConversation = event(3, 'thread-b').message.payload.change
  const oldEnvelope = { ...event(4).message, type: 'codex.thread/closed' }
  for (const [id, invalid] of [
    [2, invalidSequence],
    [3, wrongConversation],
    [4, oldEnvelope],
  ] as const) {
    insert.run(id, ownerId, 'thread-a', JSON.stringify(invalid), createdAt)
  }
  assert.deepEqual(await store.load(), { nextId: 5, events: { [ownerId]: [valid] } })
  assert.deepEqual(await store.loadThread(ownerId, 'thread-a'), [valid])
  assert.equal(warnings.mock.callCount(), 2)
})

test('paginates valid changes without crossing the replay cut', async (context) => {
  context.mock.method(log, 'warn', () => undefined)
  const { driver, store } = fixture(context)
  const insert = driver.prepare(
    'INSERT INTO conversation_events (id, owner_id, conversation_id, change, created_at) VALUES (?, ?, ?, ?, ?)',
  )
  driver.transaction(() => {
    for (let id = 1; id <= 1002; id++) {
      const change = event(id).message.payload.change
      insert.run(id, ownerId, 'thread-a', JSON.stringify(change), createdAt)
    }
  })()

  const first = await store.loadAfter(ownerId, 0, 'thread-a')
  assert.deepEqual(first, {
    events: Array.from({ length: 500 }, (_, offset) => event(1 + offset)),
    scannedThrough: 500,
    hasMore: true,
  })
  const second = await store.loadAfter(ownerId, first.scannedThrough, 'thread-a')
  assert.deepEqual(second, {
    events: Array.from({ length: 500 }, (_, offset) => event(501 + offset)),
    scannedThrough: 1000,
    hasMore: true,
  })
  const last = await store.loadAfter(ownerId, second.scannedThrough, 'thread-a', 1001)
  assert.deepEqual(last, {
    events: [event(1001)],
    scannedThrough: 1001,
    hasMore: false,
  })
})

test('captures a cold thread from SQLite and accepts its snapshot cursor', async (context) => {
  const { store } = fixture(context)
  const first = event(1)
  await store.append(ownerId, first)
  for (let id = 2; id <= 501; id++) await store.append(ownerId, event(id, 'thread-b'))
  const hub = new EventHub(store)
  await hub.restoreFrom(store)
  assert.equal(hub.latestEventId(ownerId, 'thread-a'), 0)

  const { history, sequence } = await hub.captureThreadSnapshot(ownerId, 'thread-a')
  assert.deepEqual(history, [first])
  assert.equal(sequence, first.id)
  assert.equal(await hub.isCursorAhead(ownerId, 'thread-a', sequence), false)
  assert.equal(await hub.isCursorAhead(ownerId, 'thread-a', 502), true)
  const delivered: number[] = []
  let resets = 0
  const unsubscribe = await hub.subscribeFrom(
    ownerId,
    'thread-a',
    sequence,
    (entry) => delivered.push(entry.id),
    () => resets++,
  )
  try {
    assert.deepEqual(delivered, [])
    await hub.publishConversationChange(ownerId, 'thread-a', event(502).message.payload.change)
    assert.deepEqual(delivered, [502])
    assert.equal(resets, 0)
  } finally {
    unsubscribe()
  }
})

test('a malformed SQLite row stops replay before later valid changes', async (context) => {
  context.mock.method(log, 'warn', () => undefined)
  const { driver, store } = fixture(context)
  await store.append(ownerId, event(1))
  driver
    .prepare(
      'INSERT INTO conversation_events (id, owner_id, conversation_id, change, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(2, ownerId, 'thread-a', '{', createdAt)
  await store.append(ownerId, event(3))
  await store.append(ownerId, event(4, 'thread-b'))

  assert.deepEqual(await store.loadAfter(ownerId, 0, 'thread-a'), {
    events: [event(1)],
    scannedThrough: 1,
    hasMore: false,
    gapAt: 2,
  })
  const hub = new EventHub(store)
  await hub.restoreFrom(store)
  for (const scope of ['thread-a', undefined]) {
    const delivered: number[] = []
    let resets = 0
    await hub.subscribeFrom(
      ownerId,
      scope,
      0,
      (entry) => delivered.push(entry.id),
      () => resets++,
    )
    assert.deepEqual(delivered, [1])
    assert.equal(resets, 1)
  }
  await assert.rejects(hub.captureThreadSnapshot(ownerId, 'thread-a'))
})

test('rejects a snapshot cut at a corrupt SQLite tail with no later valid row', async (context) => {
  context.mock.method(log, 'warn', () => undefined)
  const { driver, store } = fixture(context)
  const first = event(1)
  await store.append(ownerId, first)
  driver
    .prepare(
      'INSERT INTO conversation_events (id, owner_id, conversation_id, change, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(2, ownerId, 'thread-a', '{', createdAt)

  const hub = new EventHub(store)
  await hub.restoreFrom(store)
  assert.equal(hub.latestEventId(ownerId, 'thread-a'), first.id)
  await assert.rejects(hub.captureThreadSnapshot(ownerId, 'thread-a'))

  const delivered: number[] = []
  let resets = 0
  const unsubscribe = await hub.subscribeFrom(
    ownerId,
    'thread-a',
    first.id,
    (entry) => delivered.push(entry.id),
    () => resets++,
  )
  unsubscribe()
  assert.deepEqual(delivered, [])
  assert.equal(resets, 1)
})
