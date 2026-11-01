import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDomainEvent } from './domain-events.js'
import { EventHub } from './event-hub.js'
import { SqliteEventStore } from './event-store.js'
import type { ServerConfig } from '../config.js'
import { createDatabase, prepareOwnerDatabase } from '../database.js'
import { owner } from '../db/schema.js'

function config(dataRoot: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3000,
    trustedOrigins: ['http://localhost:5173'],
    dataRoot,
    maxActiveTasksPerUser: 2,
    credentialEncryptionKey: 'test-key',
    allowedOutboundSchemes: ['https'],
    allowedOutboundHosts: ['api.example.com'],
  }
}

test('persists domain envelopes, retains each thread independently, and restores replay history', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-domain-events-'))
  let driver: ReturnType<typeof createDatabase>['driver'] | undefined
  try {
    prepareOwnerDatabase(config(dataRoot))
    const database = createDatabase(config(dataRoot))
    driver = database.driver
    database.db.insert(owner).values({ id: 'owner-events' }).run()
    const store = new SqliteEventStore(database.db)
    for (const [id, threadId] of [
      [1, 'thread-a'],
      [2, 'thread-b'],
      [3, 'thread-a'],
      [4, 'thread-a'],
    ] as const) {
      const input = createDomainEvent('codex.thread/closed', { threadId }, { threadId })
      await store.append('owner-events', {
        id,
        message: { ...input, eventId: id },
      })
    }
    await store.retainPerThread(2)

    const threadA = await store.loadThread('owner-events', 'thread-a')
    assert.deepEqual(
      threadA.map((event) => event.id),
      [3, 4],
    )
    assert.deepEqual(
      threadA.map((event) => event.message.eventId),
      [3, 4],
    )
    assert.deepEqual(
      (await store.loadAfter('owner-events', 0, 'thread-a')).map((event) => event.id),
      [3, 4],
    )

    const restored = new EventHub()
    restored.restore(await store.load())
    const history = await restored.threadHistory('owner-events', 'thread-a')
    assert.deepEqual(
      history.map((event) => event.message.type),
      ['codex.thread/closed', 'codex.thread/closed'],
    )
    assert.equal(restored.latestEventId('owner-events'), 4)
  } finally {
    driver?.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
