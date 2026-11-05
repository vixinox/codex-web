import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createDomainEvent } from '../codex/domain-events.js'
import { createDatabase, prepareOwnerDatabase } from '../database.js'
import type { ServerConfig } from '../config.js'
import { owner } from '../db/schema.js'
import { parseOwnerStreamEvent } from '@codex-web/protocol/owner'
import { createOwnerApplicationServices } from './application-services.js'
import {
  OwnerMethodError,
  type OwnerMethodContext,
  type OwnerTransport,
} from './session-runtime.js'

function testConfig(dataRoot: string): ServerConfig {
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

test('streams a domain event envelope through Owner WS events.subscribe', async () => {
  const event = {
    ...createDomainEvent('codex.thread/closed', { threadId: 'thread-a' }, { threadId: 'thread-a' }),
    eventId: 1,
  }
  const services = createOwnerApplicationServices(
    {
      workspace: { getOnlyOwnerId: async () => 'owner-a' } as never,
      codex: {
        events: {
          latestEventId: () => 0,
          isCursorExpired: async () => false,
          subscribeFrom: async (
            _ownerId: string,
            _threadId: string | undefined,
            _afterId: number,
            listener: (stored: { id: number; message: typeof event }) => void,
          ) => {
            listener({ id: event.eventId, message: event })
            return () => undefined
          },
        },
      } as never,
    },
    { trustedOrigins: [] },
  )
  const transport: OwnerTransport = {
    kind: 'local',
    send: () => undefined,
    close: () => undefined,
    onMessage: () => () => undefined,
    onClose: () => () => undefined,
  }
  const context = {
    owner: {
      ownerId: 'owner-a',
      sessionId: 'session-a',
      clientId: 'client-a',
      connectionId: 'connection-a',
      transport: { kind: 'local' },
    },
    connectionId: 'connection-a',
    transport,
    signal: new AbortController().signal,
    requestId: 'request-a',
    authenticate: () => undefined,
    unauthenticate: () => undefined,
  } as OwnerMethodContext
  const result = await services.eventsSubscribe(context, { scope: 'workspace' })
  assert.ok('stream' in result)
  const streamed: unknown[] = []
  const abort = new AbortController()
  const running = result.stream.run(async (value) => streamed.push(value), abort.signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  abort.abort()
  await running

  assert.equal(streamed.length, 1)
  assert.deepEqual((streamed[0] as { event: unknown }).event, event)
  assert.equal((streamed[0] as { cursor: { sequence: number } }).cursor.sequence, event.eventId)
  assert.equal(parseOwnerStreamEvent(streamed[0]).ok, true)
  const meta = result.stream.meta as {
    subscriptionId: string
    cursor: { epoch: string; sequence: number }
  }
  for (const cursor of [
    { epoch: 'previous-process', sequence: 0 },
    { epoch: meta.cursor.epoch, sequence: 100 },
  ]) {
    const reset = await services.eventsSubscribe(context, { scope: 'workspace', cursor })
    assert.ok('stream' in reset)
    const messages: unknown[] = []
    await reset.stream.run(async (value) => {
      messages.push(value)
    }, new AbortController().signal)
    assert.deepEqual(messages, [
      {
        method: 'events.reset',
        params: {
          cursor: meta.cursor,
          reason: cursor.epoch === meta.cursor.epoch ? 'cursor_gap' : 'epoch_changed',
        },
      },
    ])
  }
  const resumed = await services.eventsResume(context, {
    subscriptionId: meta.subscriptionId,
    cursor: meta.cursor,
  })
  assert.ok('stream' in resumed)
  const resumedEvents: unknown[] = []
  const resumeAbort = new AbortController()
  const resumedRun = resumed.stream.run(async (value) => {
    resumedEvents.push(value)
  }, resumeAbort.signal)
  await new Promise((resolve) => setTimeout(resolve, 0))
  resumeAbort.abort()
  await resumedRun
  assert.deepEqual(resumedEvents, streamed)
})

test('reports PASSKEY_REQUIRED when no local credential is registered', async () => {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'codex-owner-passkey-options-'))
  let database: ReturnType<typeof createDatabase> | undefined
  try {
    prepareOwnerDatabase(testConfig(dataRoot))
    database = createDatabase(testConfig(dataRoot))
    database.db.insert(owner).values({ id: 'owner-passkey-options' }).run()
    const services = createOwnerApplicationServices(
      {
        workspace: { getOnlyOwnerId: async () => 'owner-passkey-options' } as never,
        codex: {} as never,
        ownerId: 'owner-passkey-options',
        database: database.db,
      },
      { trustedOrigins: ['http://localhost:5173'] },
    )
    const transport: OwnerTransport = {
      kind: 'local',
      origin: 'http://localhost:5173',
      send: () => undefined,
      close: () => undefined,
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
    }
    const context = {
      owner: null,
      connectionId: 'connection-passkey-options',
      transport,
      signal: new AbortController().signal,
      requestId: 'request-passkey-options',
      authenticate: () => undefined,
      unauthenticate: () => undefined,
    } as OwnerMethodContext

    await assert.rejects(
      services.passkeyAuthenticationOptions(context),
      (error: unknown) => error instanceof OwnerMethodError && error.code === 'PASSKEY_REQUIRED',
    )
  } finally {
    database?.driver.close()
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
