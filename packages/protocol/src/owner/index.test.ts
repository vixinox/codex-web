import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_DOMAIN_EVENT_PAYLOAD_BYTES,
  OWNER_MAX_FRAME_BYTES,
  encodeOwnerFrame,
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
