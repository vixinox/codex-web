import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyChange,
  createConversationSnapshot,
  createConversationState,
  type ConversationId,
  type EventIdentity,
} from '@codex-web/conversation'
import { isConversationChange, parseOwnerStreamEvent } from '@codex-web/protocol/owner'
import type { ServerConfig } from '../config.js'
import { createDatabase, prepareOwnerDatabase } from '../database.js'
import { conversationEvent, owner } from '../db/schema.js'
import { adaptCodexNotification } from './conversation-adapter.js'
import { EventHub } from './event-hub.js'
import { SqliteEventStore } from './event-store.js'

test('replays typed Conversation changes through the Owner cursor after reopening SQLite', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-conversation-delivery-'))
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3000,
    trustedOrigins: [],
    dataRoot,
    credentialEncryptionKey: 'test-key',
  }
  let driver: ReturnType<typeof createDatabase>['driver'] | undefined
  try {
    prepareOwnerDatabase(config)
    const database = createDatabase(config)
    driver = database.driver
    database.db.insert(owner).values({ id: 'owner-conversation' }).run()
    const hub = new EventHub(new SqliteEventStore(database.db))
    const threadId = 'thread-conversation' as ConversationId
    const identity: EventIdentity = {
      sourceId: 'test-adapter' as EventIdentity['sourceId'],
      sourceEventId: 'test-change' as EventIdentity['sourceEventId'],
      receivedAt: '2026-01-01T00:00:00.000Z',
    }
    await hub.publishConversationChange('owner-conversation', threadId, {
      type: 'conversation.updated',
      conversationId: threadId,
      identity,
      title: 'Reopened conversation',
    })
    const turnId = 'turn-conversation' as import('@codex-web/conversation').TurnId
    await hub.publishConversationChange('owner-conversation', threadId, {
      type: 'turn.upserted',
      identity: { ...identity, sourceEventId: 'test-start' as EventIdentity['sourceEventId'] },
      turn: { id: turnId, status: 'inProgress', messageIds: [], activityIds: [] },
    })
    await hub.publishConversationChange('owner-conversation', threadId, {
      type: 'turn.statusChanged',
      identity: { ...identity, sourceEventId: 'test-finish' as EventIdentity['sourceEventId'] },
      turnId,
      status: 'failed',
    })
    await hub.publishConversationChange('owner-conversation', threadId, {
      type: 'turn.statusChanged',
      identity: { ...identity, sourceEventId: 'test-late' as EventIdentity['sourceEventId'] },
      turnId,
      status: 'inProgress',
    })
    await hub.flush()
    driver.close()
    driver = undefined

    const reopened = createDatabase(config)
    driver = reopened.driver
    const store = new SqliteEventStore(reopened.db)
    const restored = new EventHub(store)
    await restored.restoreFrom(store)
    const history = await restored.threadHistory('owner-conversation', threadId)
    let replayed = createConversationState(createConversationSnapshot(threadId))
    for (const entry of history) {
      const change = entry.message.payload.change
      assert.ok(isConversationChange(change))
      replayed = applyChange(replayed, change)
    }
    assert.equal(replayed.turns[turnId]?.status, 'failed')
    assert.equal(history.length, 4)
    const [entry] = history
    assert.ok(entry)
    const parsed = parseOwnerStreamEvent({
      cursor: { epoch: 'new-process', sequence: entry.id },
      event: entry.message,
    })
    assert.ok(parsed.ok)
    const change = parsed.value.event.payload.change
    assert.ok(isConversationChange(change))
    const state = createConversationState(createConversationSnapshot(threadId))
    const updated = applyChange(state, change)
    assert.equal(updated.title, 'Reopened conversation')
    assert.strictEqual(applyChange(updated, change), updated)

    const publish = async (method: string, params: Record<string, unknown>, eventId: string) => {
      const changes = adaptCodexNotification(
        method,
        { threadId, turnId, ...params },
        {
          ...identity,
          sourceEventId: eventId as EventIdentity['sourceEventId'],
        },
      )
      for (const change of changes) {
        await restored.publishConversationChange('owner-conversation', threadId, change)
      }
    }
    const itemId = 'security-fixture'
    await publish(
      'item/agentMessage/delta',
      {
        itemId,
        delta: 'to',
        nested: { secret: 'nested-fixture-secret' },
      },
      'security-first',
    )
    await publish(
      'item/agentMessage/delta',
      { itemId, delta: 'ken=fixture-private-secret C:' },
      'security-second',
    )
    await publish(
      'item/agentMessage/delta',
      { itemId, delta: '/private-fixture/config' },
      'security-third',
    )
    assert.doesNotMatch(
      JSON.stringify(reopened.db.select().from(conversationEvent).all()),
      /nested-fixture-secret/u,
    )
    await publish(
      'item/completed',
      { item: { id: itemId, type: 'agentMessage', text: '' } },
      'security-completion',
    )
    await restored.flush()
    const delivered: unknown[] = []
    const unsubscribe = await restored.subscribeFrom('owner-conversation', threadId, 4, (event) => {
      const frame = parseOwnerStreamEvent({
        cursor: { epoch: 'new-process', sequence: event.id },
        event: event.message,
      })
      assert.ok(frame.ok)
      delivered.push(frame.value)
    })
    unsubscribe()
    assert.ok(delivered.length > 0)
    const historyAfter = await restored.threadHistory('owner-conversation', threadId)
    let after = createConversationState(createConversationSnapshot(threadId))
    for (const entry of historyAfter) {
      const change = entry.message.payload.change
      assert.ok(isConversationChange(change))
      after = applyChange(after, change)
    }
    assert.deepEqual(after.messages[itemId]?.parts, [
      {
        id: `${itemId}:text:0`,
        type: 'text',
        text: 'token=fixture-private-secret C:/private-fixture/config',
      },
    ])
    const persisted = reopened.db.select().from(conversationEvent).all()
    for (const projection of [persisted, delivered]) {
      const serialized = JSON.stringify(projection)
      assert.match(serialized, /fixture-private-secret/u)
      assert.match(serialized, /private-fixture/u)
      assert.doesNotMatch(serialized, /nested-fixture-secret/u)
    }
  } finally {
    driver?.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
