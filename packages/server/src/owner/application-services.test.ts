import assert from 'node:assert/strict'
import test from 'node:test'

import { createDomainEvent } from '../codex/domain-events.js'
import { parseOwnerStreamEvent } from '@codex-web/protocol/owner'
import { createOwnerApplicationServices } from './application-services.js'
import type { OwnerMethodContext, OwnerTransport } from './session-runtime.js'

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
