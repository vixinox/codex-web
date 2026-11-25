import assert from 'node:assert/strict'
import test from 'node:test'

import { createOwnerEventServices, makeOwnerEventCursor } from './event-services.js'
import { EventHub } from '../codex/event-hub.js'
import type { OwnerMethodContext } from './session-runtime.js'

const ttlMs = 10 * 60 * 1000
const expired = { code: 'owner.events.subscription-expired' }

function fixture() {
  let now = 100
  let nextId = 0
  let unrefCount = 0
  const timers = new Map<number, () => void>()
  const schedule = ((callback: () => void) => {
    const id = ++nextId
    timers.set(id, callback)
    return {
      id,
      unref: () => {
        unrefCount += 1
      },
    } as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
  const clear = ((timer: ReturnType<typeof setTimeout>) => {
    timers.delete((timer as unknown as { id: number }).id)
  }) as typeof clearTimeout
  const events = new EventHub()
  const services = createOwnerEventServices(
    { events, assertThreadReadable: async () => undefined },
    { now: () => now, setTimeout: schedule, clearTimeout: clear },
  )
  const transport = {
    kind: 'local' as const,
    send: () => undefined,
    close: () => undefined,
    onMessage: () => () => undefined,
    onClose: () => () => undefined,
  }
  const context: OwnerMethodContext = {
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
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, callback] of [...timers]) {
      timers.delete(id)
      callback()
    }
  }
  const cursor = makeOwnerEventCursor('owner-a', 0)
  return { services, events, context, advance, cursor, timers, unrefs: () => unrefCount }
}

test('reclaims abandoned records after expiry with one unrefed timer and preserves a live stream', async () => {
  const f = fixture()
  const subscription = await f.services.eventsSubscribe(f.context, { scope: 'workspace' })
  const abort = new AbortController()
  const delivered: unknown[] = []
  const running = subscription.stream.run(async (event) => {
    delivered.push(event)
  }, abort.signal)
  try {
    assert.equal(f.timers.size, 1)
    assert.equal(f.unrefs(), 1)
    f.advance(ttlMs)
    assert.equal(f.timers.size, 0)
    await assert.rejects(
      f.services.eventsResume(f.context, {
        subscriptionId: subscription.result.subscriptionId,
        cursor: f.cursor,
      }),
      expired,
    )
    await f.events.publishDomain('owner-a', {
      type: 'workspace.changed',
      runtime: 'codex',
      createdAt: new Date().toISOString(),
      payload: {},
    })
    assert.equal(delivered.length, 1)
  } finally {
    abort.abort()
    await running
  }
})

test('stream cancellation retains the bound recovery record and invalid sessions cannot destroy it', async () => {
  const f = fixture()
  const subscription = await f.services.eventsSubscribe(f.context, { scope: 'workspace' })
  const abort = new AbortController()
  const running = subscription.stream.run(async () => undefined, abort.signal)
  abort.abort()
  await running
  const request = { subscriptionId: subscription.result.subscriptionId, cursor: f.cursor }
  for (const owner of [
    { ...f.context.owner!, sessionId: 'other-session' },
    { ...f.context.owner!, ownerId: 'other-owner' },
  ])
    await assert.rejects(f.services.eventsResume({ ...f.context, owner }, request), expired)
  const resumed = await f.services.eventsResume(f.context, request)
  assert.equal(resumed.result.subscriptionId, subscription.result.subscriptionId)
  assert.equal(f.timers.size, 1)
  f.advance(ttlMs)
  await assert.rejects(f.services.eventsResume(f.context, request), expired)
})

test('subscription capacity rejects new records without evicting valid recovery and is reclaimed at expiry', async () => {
  const f = fixture()
  const first = await f.services.eventsSubscribe(f.context, { scope: 'workspace' })
  for (let index = 1; index < 2048; index += 1)
    await f.services.eventsSubscribe(f.context, { scope: 'workspace' })
  assert.equal(f.timers.size, 1)
  await assert.rejects(f.services.eventsSubscribe(f.context, { scope: 'workspace' }), {
    code: 'owner.request.limit-exceeded',
    retryable: true,
  })
  const resumed = await f.services.eventsResume(f.context, {
    subscriptionId: first.result.subscriptionId,
    cursor: f.cursor,
  })
  assert.equal(resumed.result.subscriptionId, first.result.subscriptionId)
  f.advance(ttlMs)
  await assert.doesNotReject(f.services.eventsSubscribe(f.context, { scope: 'workspace' }))
  f.advance(ttlMs)
  assert.equal(f.timers.size, 0)
})
