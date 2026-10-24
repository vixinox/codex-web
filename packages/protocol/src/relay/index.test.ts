import test from 'node:test'
import assert from 'node:assert/strict'

import { RELAY_PROTOCOL_VERSION, encodeFrame, isRelayAttachFrame, parseFrame } from './index.js'

test('round trips a relay attachment frame', () => {
  const frame = {
    type: 'relay.attach' as const,
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    role: 'owner' as const,
    connectionId: 'connection-1',
  }
  const parsed = parseFrame(encodeFrame(frame))
  assert.equal(isRelayAttachFrame(parsed), true)
  assert.deepEqual(parsed, frame)
})

test('rejects unknown versions and obsolete HTTP/SSE tunnel frames', () => {
  assert.equal(parseFrame(JSON.stringify({ type: 'relay.attach', version: 99 })), null)
  assert.equal(
    parseFrame(
      JSON.stringify({
        type: 'http.request',
        version: RELAY_PROTOCOL_VERSION,
        requestId: 'r1',
        method: 'GET',
        path: '/api/me',
        headers: {},
      }),
    ),
    null,
  )
  assert.equal(
    parseFrame(JSON.stringify({ type: 'sse.event', version: RELAY_PROTOCOL_VERSION })),
    null,
  )
})
