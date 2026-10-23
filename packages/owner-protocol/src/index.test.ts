import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OWNER_MAX_FRAME_BYTES,
  OWNER_PROTOCOL_VERSION,
  encodeOwnerFrame,
  parseOwnerFrame,
} from './index.js'

test('round trips versioned hello and request frames', () => {
  const hello = {
    type: 'hello' as const,
    version: OWNER_PROTOCOL_VERSION,
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

test('rejects malformed JSON, unsupported versions, unknown frames, and missing fields', () => {
  assert.deepEqual(parseOwnerFrame('{'), {
    ok: false,
    error: { code: 'INVALID_JSON', message: 'Frame is not valid JSON.' },
  })
  assert.equal(parseOwnerFrame(JSON.stringify({ type: 'hello', version: 2 })).ok, false)
  assert.equal(parseOwnerFrame(JSON.stringify({ type: 'unknown' })).ok, false)
  assert.equal(
    parseOwnerFrame(JSON.stringify({ type: 'request', method: 'threads.read' })).ok,
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
