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
import { log } from '../logger.js'
import { domainEvent, owner } from '../db/schema.js'

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
    await database.db.insert(domainEvent).values({
      id: 5,
      ownerId: 'owner-events',
      threadId: 'thread-a',
      type: 'codex.thread/closed',
      payload: {
        eventId: 5,
        type: 'codex.thread/closed',
        runtime: 'invalid',
        threadId: 'thread-a',
        createdAt: '2026-01-01T00:00:00.000Z',
        payload: { threadId: 'thread-a' },
      },
    })

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
      (await store.loadAfter('owner-events', 0, 'thread-a')).events.map((event) => event.id),
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
    assert.equal(restored.snapshot().nextId, 6)
  } finally {
    driver?.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('scans past rejected records across full pages and preserves replay/live order', async (context) => {
  const warnings = context.mock.method(log, 'warn', () => undefined)
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-event-pages-'))
  let driver: ReturnType<typeof createDatabase>['driver'] | undefined
  try {
    prepareOwnerDatabase(config(dataRoot))
    const database = createDatabase(config(dataRoot))
    driver = database.driver
    database.db.insert(owner).values({ id: 'owner-pages' }).run()
    const insert = driver.prepare(
      'INSERT INTO domain_events (id,owner_id,thread_id,type,payload,created_at) VALUES (?,?,?,?,?,?)',
    )
    // First page entirely invalid; second page invalid at its beginning, middle and end.
    const rejected = new Set([...Array.from({ length: 500 }, (_, i) => i + 1), 501, 750, 1000])
    driver.transaction(() => {
      for (let id = 1; id <= 1100; id++) {
        const message = {
          ...createDomainEvent(
            'codex.thread/closed',
            { threadId: 'thread-a' },
            { threadId: 'thread-a' },
          ),
          eventId: id,
        }
        insert.run(
          id,
          'owner-pages',
          'thread-a',
          message.type,
          JSON.stringify(rejected.has(id) ? {} : message),
          Math.floor(Date.now() / 1000),
        )
      }
    })()
    const store = new SqliteEventStore(database.db)
    const first = await store.loadAfter('owner-pages', 0, 'thread-a')
    assert.equal(first.events.length, 0)
    assert.equal(first.scannedThrough, 500)
    assert.equal(first.hasMore, true)
    const hub = new EventHub(store)
    await hub.restoreFrom(store)
    const received: number[] = []
    let liveWrite: Promise<void> | undefined
    const stop = await hub.subscribeFrom('owner-pages', 'thread-a', 0, (event) => {
      received.push(event.id)
      if (event.id === 502)
        liveWrite = hub.publish('owner-pages', {
          method: 'thread/closed',
          params: { threadId: 'thread-a' },
        })
    })
    await liveWrite
    assert.deepEqual(
      received,
      Array.from({ length: 1101 }, (_, i) => i + 1).filter((id) => !rejected.has(id)),
    )
    stop()
    await hub.publish('owner-pages', { method: 'thread/closed', params: { threadId: 'thread-a' } })
    assert.equal(received.at(-1), 1101)
    assert.ok(warnings.mock.callCount() >= rejected.size)
  } finally {
    driver?.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
