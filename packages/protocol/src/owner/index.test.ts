import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_DOMAIN_EVENT_PAYLOAD_BYTES,
  OWNER_MAX_FRAME_BYTES,
  encodeOwnerFrame,
  isConversationSnapshot,
  parseDomainEventEnvelope,
  parseOwnerEventStreamMessage,
  parseOwnerFrame,
  parseOwnerStreamEvent,
} from './index.js'

const validEvent = {
  eventId: 7,
  type: 'codex.item/agentMessage/delta',
  runtime: 'codex',
  threadId: 'thread-1',
  turnId: 'turn-1',
  itemId: 'item-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  payload: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'hello' },
}

test('validates Conversation changes before accepting their Owner envelope', () => {
  const change = {
    type: 'conversation.updated',
    conversationId: 'thread-1',
    status: 'active',
    identity: { sourceId: 'adapter', sourceEventId: 'event-1', receivedAt: validEvent.createdAt },
  }
  const event = { ...validEvent, type: 'conversation.change', payload: { change } }
  assert.equal(parseDomainEventEnvelope(event).ok, true)
  for (const invalid of [
    { ...change, conversationId: 'another-thread' },
    { ...change, status: 'unrecognized' },
    { ...change, identity: { ...change.identity, rawParams: {} } },
    { ...change, type: 'unknown' },
  ]) {
    assert.equal(parseDomainEventEnvelope({ ...event, payload: { change: invalid } }).ok, false)
  }
  assert.equal(parseDomainEventEnvelope({ ...event, payload: { change, raw: {} } }).ok, false)
})

test('validates nested Conversation snapshot members and their map identities', () => {
  const turn = { id: 'turn-1', status: 'inProgress', messageIds: [], activityIds: [] }
  const snapshot = {
    id: 'thread-1',
    status: 'active',
    watermark: 7,
    turns: { 'turn-1': turn },
    messages: {},
    activities: {},
    interactions: {},
    agentLinks: {},
    diagnostics: [],
  }
  assert.equal(isConversationSnapshot(snapshot), true)
  assert.equal(isConversationSnapshot({ ...snapshot, watermark: -1 }), false)
  assert.equal(isConversationSnapshot({ ...snapshot, turns: { 'wrong-key': turn } }), false)
  assert.equal(
    isConversationSnapshot({ ...snapshot, turns: { 'turn-1': { ...turn, cwd: 'private' } } }),
    false,
  )
})

test('round trips hello without a version and request frames', () => {
  const hello = {
    type: 'hello' as const,

    clientId: 'client-1',
    capabilities: ['threads', 'events'],
    sessionToken: 'opaque-token',
  }
  const request = {
    type: 'request' as const,
    requestId: 'request-1',
    method: 'threads.read',
    params: { threadId: 'thread-1' },
  }

  assert.deepEqual(parseOwnerFrame(encodeOwnerFrame(hello)), { ok: true, frame: hello })
  assert.deepEqual(parseOwnerFrame(encodeOwnerFrame(request)), { ok: true, frame: request })
})

test('rejects malformed JSON, unsupported fields, unknown frames, and missing fields', () => {
  assert.deepEqual(parseOwnerFrame('{'), {
    ok: false,
    error: { code: 'INVALID_JSON', message: 'Frame is not valid JSON.' },
  })
  assert.equal(parseOwnerFrame(JSON.stringify({ type: 'hello' })).ok, false)
  assert.equal(
    parseOwnerFrame(
      JSON.stringify({ type: 'hello', unexpected: true, clientId: 'c1', capabilities: [] }),
    ).ok,
    false,
  )
  assert.equal(parseOwnerFrame(JSON.stringify({ type: 'unknown' })).ok, false)
  assert.equal(
    parseOwnerFrame(JSON.stringify({ type: 'request', method: 'threads.read' })).ok,
    false,
  )
})

test('requires owner identity only on authenticated ready frames', () => {
  const ready = {
    type: 'ready',
    connectionId: 'connection-1',
    authenticated: true,
    ownerId: 'owner-1',
    capabilities: [],
  }
  assert.deepEqual(parseOwnerFrame(JSON.stringify(ready)), { ok: true, frame: ready })
  assert.equal(parseOwnerFrame(JSON.stringify({ ...ready, authenticated: false })).ok, false)
  assert.equal(parseOwnerFrame(JSON.stringify({ ...ready, ownerId: undefined })).ok, false)
  const unauthenticated = { ...ready, authenticated: false }
  delete (unauthenticated as Partial<typeof ready>).ownerId
  assert.deepEqual(parseOwnerFrame(JSON.stringify(unauthenticated)), {
    ok: true,
    frame: unauthenticated,
  })
})

test('parses only complete domain event envelopes', () => {
  assert.deepEqual(parseDomainEventEnvelope(validEvent), { ok: true, event: validEvent })
  for (const event of [
    { ...validEvent, unexpected: true },
    { ...validEvent, eventId: 0 },
    { ...validEvent, type: '' },
    { ...validEvent, runtime: 'other' },
    { ...validEvent, createdAt: 'not-a-date' },
    { ...validEvent, threadId: '' },
    { ...validEvent, payload: [] },
    { ...validEvent, payload: { data: 'x'.repeat(MAX_DOMAIN_EVENT_PAYLOAD_BYTES) } },
  ]) {
    assert.equal(parseDomainEventEnvelope(event).ok, false)
  }
  assert.deepEqual(parseDomainEventEnvelope({ ...validEvent, unexpected: true }), {
    ok: false,
    error: {
      code: 'INVALID_EVENT_ENVELOPE',
      message: 'Owner event envelope is invalid.',
    },
  })
})

test('validates stream cursors against event identity', () => {
  const stream = { cursor: { epoch: 'epoch-1', sequence: 7 }, event: validEvent }
  assert.deepEqual(parseOwnerStreamEvent(stream), { ok: true, value: stream })
  assert.deepEqual(
    parseOwnerStreamEvent({ ...stream, cursor: { epoch: 'epoch-1', sequence: 8 } }),
    {
      ok: false,
      error: {
        code: 'EVENT_CURSOR_MISMATCH',
        message: 'Owner event cursor does not match its event identity.',
      },
    },
  )
  assert.equal(parseOwnerStreamEvent({ ...stream, cursor: { epoch: '', sequence: 7 } }).ok, false)
})

test('validates Owner stream.event payloads as domain or reset events', () => {
  const frame = {
    type: 'stream.event' as const,
    streamId: 'stream-1',
    event: { cursor: { epoch: 'epoch-1', sequence: 7 }, event: validEvent },
  }
  assert.deepEqual(parseOwnerFrame(encodeOwnerFrame(frame)).ok, true)
  assert.deepEqual(
    parseOwnerFrame(
      JSON.stringify({
        ...frame,
        event: { cursor: { epoch: 'epoch-1', sequence: 7 }, event: { method: 'thread/closed' } },
      }),
    ),
    {
      ok: false,
      error: {
        code: 'INVALID_EVENT_ENVELOPE',
        message: 'Owner event envelope is invalid.',
      },
    },
  )
  assert.equal(
    parseOwnerFrame(
      encodeOwnerFrame({
        type: 'stream.event',
        streamId: 'stream-1',
        event: {
          method: 'events.reset',
          params: { cursor: { epoch: 'epoch-2', sequence: 0 }, reason: 'cursor_gap' },
        },
      }),
    ).ok,
    true,
  )
  assert.equal(
    parseOwnerEventStreamMessage({
      method: 'events.reset',
      params: { cursor: { epoch: 'epoch-2', sequence: 0 }, reason: 'cursor_gap', secret: 'no' },
    }).ok,
    false,
  )
})

test('rejects non-text and over-limit frames', () => {
  assert.equal(parseOwnerFrame(new Uint8Array([123])).ok, false)
  assert.equal(parseOwnerFrame(' '.repeat(OWNER_MAX_FRAME_BYTES + 1)).ok, false)
})

test('validates mutually exclusive response outcomes and single cancellation target', () => {
  assert.equal(
    parseOwnerFrame(
      JSON.stringify({ type: 'response', requestId: 'r1', result: {}, error: { code: 'X' } }),
    ).ok,
    false,
  )
  assert.equal(parseOwnerFrame(JSON.stringify({ type: 'cancel' })).ok, false)
  assert.equal(
    parseOwnerFrame(JSON.stringify({ type: 'cancel', requestId: 'r1', streamId: 's1' })).ok,
    false,
  )
  assert.equal(parseOwnerFrame(JSON.stringify({ type: 'response', requestId: 'r1' })).ok, false)
})

test('response errors use safe Owner DTOs and reject Relay or malformed errors', () => {
  const parseError = (error: unknown) =>
    parseOwnerFrame(JSON.stringify({ type: 'response', requestId: 'r1', error }))
  const valid = {
    code: 'owner.future.unknown-reason',
    retryable: true,
    params: { attempts: 2, available: false },
    message: 'The operation could not be completed.',
  }
  assert.deepEqual(parseError(valid), {
    ok: true,
    frame: { type: 'response', requestId: 'r1', error: valid },
  })
  for (const error of [
    { code: 'relay.attach.unauthorized', retryable: false },
    { code: 'owner.invalid code', retryable: false },
    { code: 'owner.request.failed', retryable: false, extra: true },
    { code: 'owner.request.failed', retryable: false, params: { secret: 'private' } },
    { code: 'owner.request.failed', retryable: 'no' },
  ]) {
    assert.equal(parseError(error).ok, false)
  }
})

test('frame parser issues stay separate from business DTOs and never echo input', () => {
  const parsed = parseOwnerFrame('{"type":"request","params":{"token":"never-echo"}')
  assert.equal(parsed.ok, false)
  if (!parsed.ok) {
    assert.equal(parsed.error.code, 'INVALID_JSON')
    assert.equal(parsed.error.message.includes('never-echo'), false)
  }
})

test('accepts detailed Owner errors while rejecting arbitrary error objects', () => {
  const error = {
    code: 'owner.runtime.unavailable',
    retryable: true,
    message: 'token=synthetic C:/workspace',
    details: '/synthetic/path',
  }
  const parsed = parseOwnerFrame(JSON.stringify({ type: 'response', requestId: 'detail', error }))
  assert.equal(parsed.ok, true)
  const invalid = parseOwnerFrame(
    JSON.stringify({
      type: 'response',
      requestId: 'detail',
      error: { ...error, stack: 'private' },
    }),
  )
  assert.equal(invalid.ok, false)
})
