import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_ROUTE_ID_BYTES,
  RELAY_PROTOCOL_VERSION,
  encodeFrame,
  isHandshakeOkFrame,
  isRelayAttachFrame,
  isRelayBootstrapReferenceRegisterFrame,
  isRelayBootstrapReferenceUnregisterFrame,
  isRelayClientConnectedFrame,
  isRelayForwardFrame,
  parseFrame,
} from './index.js'

const ownerToken = 'relay-owner-token-that-is-at-least-32-characters'

function ownerAttachment(overrides: Record<string, unknown> = {}) {
  return {
    type: 'relay.attach' as const,
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    role: 'owner' as const,
    connectionId: 'connection-1',
    ownerToken,
    ownerPublicKey: '{"kty":"EC"}',
    ownerCode: '123456789',
    trustEpoch: 0,
    ...overrides,
  }
}

function clientAttachment(overrides: Record<string, unknown> = {}) {
  return {
    type: 'relay.attach' as const,
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    role: 'client' as const,
    connectionId: 'connection-1',
    clientToken: 'client-token',
    deviceId: 'device-1',
    trustEpoch: 0,
    ...overrides,
  }
}

test('round trips a relay attachment frame', () => {
  const frame = ownerAttachment()
  const parsed = parseFrame(encodeFrame(frame))
  assert.equal(isRelayAttachFrame(parsed), true)
  assert.deepEqual(parsed, frame)
})

test('requires an owner code with exactly nine ASCII digits', () => {
  for (const ownerCode of ['', '12345678', '1234567890', '１２３４５６７８９', '12345x789']) {
    assert.equal(
      isRelayAttachFrame(parseFrame(encodeFrame(ownerAttachment({ ownerCode })))),
      false,
      ownerCode,
    )
  }
})

test('requires a device binding on client attachments', () => {
  assert.equal(isRelayAttachFrame(parseFrame(encodeFrame(clientAttachment()))), true)
  assert.equal(
    isRelayAttachFrame(parseFrame(encodeFrame(clientAttachment({ deviceId: undefined })))),
    false,
  )
  assert.equal(
    isRelayAttachFrame(parseFrame(encodeFrame(clientAttachment({ deviceId: '' })))),
    false,
  )
  assert.equal(
    isRelayAttachFrame(
      parseFrame(encodeFrame(clientAttachment({ deviceId: 'd'.repeat(MAX_ROUTE_ID_BYTES + 1) }))),
    ),
    false,
  )
})

test('accepts login candidate attachments by owner code without an owner node or admission token', () => {
  const login = {
    type: 'relay.attach' as const,
    version: RELAY_PROTOCOL_VERSION,
    role: 'client' as const,
    admission: 'login' as const,
    connectionId: 'login-1',
    ownerCode: '123456789',
  }
  assert.deepEqual(parseFrame(encodeFrame(login)), login)
  assert.equal(isRelayAttachFrame(parseFrame(encodeFrame(login))), true)
  for (const ownerCode of ['', '12345678', '1234567890', '１２３４５６７８９']) {
    assert.equal(
      isRelayAttachFrame(parseFrame(encodeFrame({ ...login, ownerCode }))),
      false,
      ownerCode,
    )
  }
  assert.equal(
    isRelayAttachFrame(parseFrame(encodeFrame({ ...login, nodeId: 'node-1' } as never))),
    false,
  )
})

test('accepts reference-only bootstrap attachments and registration controls', () => {
  const attach = {
    type: 'relay.attach' as const,
    version: RELAY_PROTOCOL_VERSION,
    role: 'client' as const,
    admission: 'bootstrap_reference' as const,
    connectionId: 'bootstrap-1',
    reference: 'ref-123456789',
  }
  assert.deepEqual(parseFrame(encodeFrame(attach)), attach)
  assert.equal(isRelayAttachFrame(parseFrame(encodeFrame(attach))), true)
  assert.equal(isRelayAttachFrame(parseFrame(encodeFrame({ ...attach, reference: '' }))), false)

  const register = {
    type: 'relay.bootstrap.register' as const,
    version: RELAY_PROTOCOL_VERSION,
    reference: 'ref-123456789',
    expiresAt: Date.now() + 60_000,
  }
  const unregister = {
    type: 'relay.bootstrap.unregister' as const,
    version: RELAY_PROTOCOL_VERSION,
    reference: register.reference,
  }
  assert.equal(isRelayBootstrapReferenceRegisterFrame(parseFrame(encodeFrame(register))), true)
  assert.equal(isRelayBootstrapReferenceUnregisterFrame(parseFrame(encodeFrame(unregister))), true)
  assert.equal(
    isRelayBootstrapReferenceRegisterFrame(
      parseFrame(encodeFrame({ ...register, expiresAt: Date.now() - 1 })),
    ),
    false,
  )
})

test('validates paired and login candidate relay client-connected notifications', () => {
  const paired = {
    type: 'relay.client.connected' as const,
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    connectionId: 'connection-1',
    deviceId: 'device-1',
  }
  assert.equal(isRelayClientConnectedFrame(parseFrame(encodeFrame(paired))), true)
  assert.equal(
    isRelayClientConnectedFrame(
      parseFrame(
        encodeFrame({
          type: 'relay.client.connected',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: 'node-1',
          connectionId: 'login-1',
          admission: 'login',
          ownerCode: '123456789',
        }),
      ),
    ),
    true,
  )
  assert.equal(
    isRelayClientConnectedFrame(
      parseFrame(
        JSON.stringify({
          type: 'relay.client.connected',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: 'node-1',
          connectionId: 'legacy-1',
          admission: 'provisional',
        }),
      ),
    ),
    false,
  )
  assert.equal(
    isRelayClientConnectedFrame(
      parseFrame(
        encodeFrame({
          type: 'relay.client.connected',
          version: RELAY_PROTOCOL_VERSION,
          nodeId: 'node-1',
          connectionId: 'bootstrap-1',
          admission: 'bootstrap_reference',
          reference: 'ref-123456789',
          ownerPublicKey: '{"kty":"EC"}',
        }),
      ),
    ),
    true,
  )
})

test('binds routing identifiers to a bounded length', () => {
  assert.equal(
    isRelayAttachFrame(
      parseFrame(
        encodeFrame(ownerAttachment({ connectionId: 'c'.repeat(MAX_ROUTE_ID_BYTES + 1) })),
      ),
    ),
    false,
  )
  assert.equal(
    isRelayForwardFrame(
      parseFrame(
        encodeFrame({
          type: 'relay.forward',
          version: RELAY_PROTOCOL_VERSION,
          connectionId: 'c'.repeat(MAX_ROUTE_ID_BYTES + 1),
          payload: 'opaque',
        }),
      ),
    ),
    false,
  )
})

test('accepts a well-formed handshake confirmation and rejects missing bindings', () => {
  const frame: Record<string, unknown> = {
    type: 'handshake.ok' as const,
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    trustEpoch: 2,
    ownerPublicKey: '{"kty":"EC","crv":"P-256"}',
    clientPublicKey: '{"kty":"EC","crv":"P-256"}',
  }
  assert.equal(isHandshakeOkFrame(parseFrame(encodeFrame(frame as never))), true)
  assert.equal(
    isHandshakeOkFrame(parseFrame(encodeFrame({ ...frame, clientPublicKey: undefined } as never))),
    false,
  )
  assert.equal(
    isHandshakeOkFrame(parseFrame(encodeFrame({ ...frame, trustEpoch: '2' } as never))),
    false,
  )
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
