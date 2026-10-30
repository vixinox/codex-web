import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { RELAY_PROTOCOL_VERSION, type RelayAttachFrame } from '@codex-web/protocol/relay'

import { RelayRouter, type RelaySocket } from './relay-router.js'

const ownerToken = 'relay-owner-token-that-is-at-least-32-characters'
const createRouter = () => new RelayRouter({ ownerToken })
const signedToken = (
  role: 'owner' | 'client',
  nodeId = 'node-1',
  trustEpoch = 0,
  deviceId?: string,
) => {
  const encoded = Buffer.from(
    JSON.stringify({
      nodeId,
      trustEpoch,
      role,
      ...(deviceId ? { deviceId } : {}),
      expiresAt: Date.now() + 60_000,
    }),
  ).toString('base64url')
  const signature = createHmac('sha256', ownerToken).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

const ownerAttach = (
  overrides: Partial<Extract<RelayAttachFrame, { role: 'owner' }>> = {},
  nodeId = 'node-1',
  trustEpoch = 0,
): RelayAttachFrame => ({
  type: 'relay.attach',
  version: RELAY_PROTOCOL_VERSION,
  nodeId,
  role: 'owner',
  ownerCode: '123456789',
  connectionId: 'owner',
  ownerPublicKey: 'owner-public-key',
  ownerToken: signedToken('owner', nodeId, trustEpoch),
  trustEpoch,
  ...overrides,
})

const clientAttach = (
  overrides: Partial<Extract<RelayAttachFrame, { role: 'client'; admission?: undefined }>> = {},
  nodeId = 'node-1',
  trustEpoch = 0,
  deviceId = 'device-1',
): RelayAttachFrame => ({
  type: 'relay.attach',
  version: RELAY_PROTOCOL_VERSION,
  nodeId,
  role: 'client',
  connectionId: 'client',
  clientToken: signedToken('client', nodeId, trustEpoch, deviceId),
  deviceId,
  trustEpoch,
  ...overrides,
})

function fakeSocket() {
  const messages: Array<string | ArrayBuffer | Uint8Array> = []
  const closed: Array<{ code?: number; reason?: string }> = []
  let bufferedBytes = 0
  const socket: RelaySocket = {
    send: (data) => messages.push(data),
    close: (code, reason) => closed.push({ code, reason }),
    bufferedAmount: () => bufferedBytes,
  }
  return { socket, messages, closed, setBufferedBytes: (value: number) => (bufferedBytes = value) }
}

test('forwards opaque frames only between matching owner and client attachments', () => {
  const router = createRouter()
  const owner = fakeSocket()
  const client = fakeSocket()
  const ownerResult = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'connection-1',
      ownerToken: signedToken('owner'),
      trustEpoch: 0,
    },
    owner.socket,
  )
  const clientResult = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'client',
      connectionId: 'connection-1',
      clientToken: signedToken('client', 'node-1', 0, 'device-1'),
      deviceId: 'device-1',
      trustEpoch: 0,
    },
    client.socket,
  )
  assert.equal(ownerResult.ok, true)
  assert.equal(clientResult.ok, true)
  if (!ownerResult.ok || !clientResult.ok) return
  const ownerFrame = JSON.stringify({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId: 'connection-1',
    payload: 'ciphertext',
  })
  assert.equal(router.forward(ownerResult.session.sessionId, ownerFrame), true)
  assert.equal(client.messages.at(-1), ownerFrame)
  const clientFrame = JSON.stringify({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId: 'connection-1',
    payload: 'opaque-response',
  })
  assert.equal(router.forwardFromClient(clientResult.session.sessionId, clientFrame), true)
  assert.equal(owner.messages.at(-1), clientFrame)
})

test('separates connection ids and closes a peer when its counterpart disconnects', () => {
  const router = createRouter()
  const ownerA = fakeSocket()
  const clientA = fakeSocket()
  const ownerB = fakeSocket()
  router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'a',
      ownerToken: signedToken('owner'),
      trustEpoch: 0,
    },
    ownerA.socket,
  )
  router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'client',
      connectionId: 'a',
      clientToken: signedToken('client', 'node-1', 0, 'device-1'),
      deviceId: 'device-1',
      trustEpoch: 0,
    },
    clientA.socket,
  )
  const ownerBResult = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'b',
      ownerToken: signedToken('owner'),
      trustEpoch: 0,
    },
    ownerB.socket,
  )
  assert.equal(ownerBResult.ok, true)
  if (!ownerBResult.ok) return
  router.detach(ownerBResult.session.sessionId)
  assert.deepEqual(ownerB.closed.at(-1), { code: 4002, reason: 'peer_disconnected' })
  assert.deepEqual(clientA.closed.at(-1), { code: 4002, reason: 'replaced' })
})

test('rejects owner impersonation and enforces per-node client capacity', () => {
  const router = new RelayRouter({ ownerToken, maxClientsPerNode: 1 })
  const forgedOwner = fakeSocket()
  const rejected = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'owner',
      ownerToken: 'wrong-owner-token-that-is-long-enough',
      trustEpoch: 0,
    },
    forgedOwner.socket,
  )
  assert.deepEqual(rejected, { ok: false, reason: 'unauthorized' })

  const owner = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'owner',
      ownerToken: signedToken('owner'),
      trustEpoch: 0,
    },
    fakeSocket().socket,
  )
  assert.equal(owner.ok, true)
  const client = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'client',
      connectionId: 'client-1',
      clientToken: signedToken('client', 'node-1', 0, 'device-1'),
      deviceId: 'device-1',
      trustEpoch: 0,
    },
    fakeSocket().socket,
  )
  assert.equal(client.ok, true)
  const excess = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'client',
      connectionId: 'client-2',
      clientToken: signedToken('client', 'node-1', 0, 'device-1'),
      deviceId: 'device-1',
      trustEpoch: 0,
    },
    fakeSocket().socket,
  )
  assert.deepEqual(excess, { ok: false, reason: 'capacity' })
})

test('rejects client tokens for another node, role, or trust epoch', () => {
  const router = createRouter()
  const owner = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'owner',
      ownerToken: signedToken('owner', 'node-1', 4),
      trustEpoch: 4,
    },
    fakeSocket().socket,
  )
  assert.equal(owner.ok, true)
  const rejected = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'client',
      connectionId: 'client',
      clientToken: signedToken('client', 'node-1', 3, 'device-1'),
      deviceId: 'device-1',
      trustEpoch: 4,
    },
    fakeSocket().socket,
  )
  assert.deepEqual(rejected, { ok: false, reason: 'unauthorized' })
})

test('rejects forwarding above the per-connection message rate', () => {
  const router = new RelayRouter({ ownerToken, messagesPerSecond: 1 })
  const owner = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'owner',
      ownerToken: signedToken('owner'),
      trustEpoch: 0,
    },
    fakeSocket().socket,
  )
  const client = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'client',
      connectionId: 'client',
      clientToken: signedToken('client', 'node-1', 0, 'device-1'),
      deviceId: 'device-1',
      trustEpoch: 0,
    },
    fakeSocket().socket,
  )
  assert.equal(owner.ok, true)
  assert.equal(client.ok, true)
  if (!owner.ok) return
  const frame = JSON.stringify({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId: 'client',
    payload: 'opaque',
  })
  assert.equal(router.forward(owner.session.sessionId, frame), true)
  assert.equal(router.forward(owner.session.sessionId, frame), false)
})

test('closes a slow peer without dropping the healthy endpoint', () => {
  const router = new RelayRouter({ ownerToken, maxQueuedBytes: 16 })
  const owner = fakeSocket()
  const client = fakeSocket()
  const ownerResult = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      ownerCode: '123456789',
      ownerPublicKey: 'owner-public-key',
      connectionId: 'owner',
      ownerToken: signedToken('owner'),
      trustEpoch: 0,
    },
    owner.socket,
  )
  const clientResult = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'client',
      connectionId: 'client',
      clientToken: signedToken('client', 'node-1', 0, 'device-1'),
      deviceId: 'device-1',
      trustEpoch: 0,
    },
    client.socket,
  )
  assert.equal(ownerResult.ok, true)
  assert.equal(clientResult.ok, true)
  if (!ownerResult.ok) return
  client.setBufferedBytes(17)
  const frame = JSON.stringify({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId: 'client',
    payload: 'opaque',
  })
  assert.equal(router.forward(ownerResult.session.sessionId, frame), true)
  assert.deepEqual(client.closed.at(-1), { code: 4002, reason: 'slow_consumer' })
  assert.equal(router.connectionCount(), 1)
  assert.equal(owner.closed.length, 0)
})

test('rejects a client attach without a device id as an invalid attachment', () => {
  const router = createRouter()
  const owner = fakeSocket()
  router.attach(ownerAttach(), owner.socket)
  const anonymous = fakeSocket()
  const result = router.attach(clientAttach({ deviceId: undefined }), anonymous.socket)
  assert.deepEqual(result, { ok: false, reason: 'invalid_attachment' })
  assert.deepEqual(anonymous.closed, [])
  assert.equal(router.connectionCount(), 1)
})

test('rejects an empty device id when the router is called without protocol parsing', () => {
  const router = createRouter()
  router.attach(ownerAttach(), fakeSocket().socket)
  const result = router.attach(clientAttach({ deviceId: '' }), fakeSocket().socket)
  assert.deepEqual(result, { ok: false, reason: 'invalid_attachment' })
  assert.equal(router.connectionCount(), 1)
})

test('rejects a client attach whose device id differs from the token claim', () => {
  const router = createRouter()
  const owner = fakeSocket()
  router.attach(ownerAttach(), owner.socket)
  const impersonated = fakeSocket()
  const result = router.attach(
    clientAttach({
      deviceId: 'device-2',
      clientToken: signedToken('client', 'node-1', 0, 'device-1'),
    }),
    impersonated.socket,
  )
  assert.deepEqual(result, { ok: false, reason: 'unauthorized' })
  assert.deepEqual(impersonated.closed, [])
  assert.equal(router.connectionCount(), 1)
  assert.equal(owner.messages.length, 0)
})

test('rejects a client token without a device claim', () => {
  const router = createRouter()
  const owner = fakeSocket()
  router.attach(ownerAttach(), owner.socket)
  const client = fakeSocket()
  const result = router.attach(
    clientAttach({ clientToken: signedToken('client', 'node-1', 0) }),
    client.socket,
  )
  assert.deepEqual(result, { ok: false, reason: 'unauthorized' })
  assert.equal(router.connectionCount(), 1)
})

test('closes each socket exactly once when removeSession runs more than once', () => {
  const router = createRouter()
  const owner = fakeSocket()
  const client = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  const clientResult = router.attach(clientAttach(), client.socket)
  assert.equal(ownerResult.ok, true)
  assert.equal(clientResult.ok, true)
  if (!ownerResult.ok || !clientResult.ok) return
  const clientId = clientResult.session.sessionId

  router.detach(clientId)
  router.detach(clientId)
  assert.deepEqual(client.closed, [{ code: 4002, reason: 'peer_disconnected' }])
  assert.equal(owner.closed.length, 0)
  assert.equal(router.getSession(clientId), undefined)

  router.detach(ownerResult.session.sessionId)
  router.detach(ownerResult.session.sessionId)
  assert.deepEqual(owner.closed, [{ code: 4002, reason: 'peer_disconnected' }])
  assert.equal(router.connectionCount(), 0)

  const returningClient = fakeSocket()
  const returningOwner = fakeSocket()
  const returning = router.attach(clientAttach(), returningClient.socket)
  assert.equal(returning.ok, false)
  if (!returning.ok) assert.equal(returning.reason, 'unauthorized')
  assert.equal(router.connectionCount(), 0)
  const reconnectedOwner = router.attach(ownerAttach(), returningOwner.socket)
  assert.equal(reconnectedOwner.ok, true)
  assert.equal(router.connectionCount(), 1)
})

test('detaching a replaced session leaves the replacement alive and closes it once', () => {
  const router = createRouter()
  const owner = fakeSocket()
  const original = fakeSocket()
  const replacement = fakeSocket()
  router.attach(ownerAttach(), owner.socket)
  const originalResult = router.attach(clientAttach(), original.socket)
  const replacementResult = router.attach(clientAttach(), replacement.socket)
  assert.equal(originalResult.ok, true)
  assert.equal(replacementResult.ok, true)
  if (!originalResult.ok || !replacementResult.ok) return

  assert.deepEqual(original.closed, [{ code: 4002, reason: 'replaced' }])
  assert.deepEqual(replacement.closed, [])
  assert.notEqual(originalResult.session.sessionId, replacementResult.session.sessionId)

  router.detach(originalResult.session.sessionId)
  router.detach(originalResult.session.sessionId)
  assert.deepEqual(original.closed, [{ code: 4002, reason: 'replaced' }])
  assert.equal(router.getSession(replacementResult.session.sessionId), replacementResult.session)
  assert.equal(router.connectionCount(), 2)

  router.detach(replacementResult.session.sessionId)
  router.detach(replacementResult.session.sessionId)
  assert.deepEqual(replacement.closed, [{ code: 4002, reason: 'peer_disconnected' }])
  assert.equal(router.connectionCount(), 1)
})

test('keeps owner codes unique among online nodes and releases the mapping on detach', () => {
  const router = createRouter()
  const owner1 = router.attach(
    ownerAttach({ ownerCode: '111111111' }, 'node-1'),
    fakeSocket().socket,
  )
  assert.equal(owner1.ok, true)
  assert.deepEqual(router.resolveOwnerCode('111111111'), {
    online: true,
    nodeId: 'node-1',
    trustEpoch: 0,
  })
  assert.deepEqual(
    router.attach(ownerAttach({ ownerCode: '111111111' }, 'node-2'), fakeSocket().socket),
    { ok: false, reason: 'owner_code_conflict' },
  )
  assert.deepEqual(
    router.attach(ownerAttach({ ownerCode: '222222222' }, 'node-2'), fakeSocket().socket).ok,
    true,
  )
  assert.deepEqual(router.resolveOwnerCode('222222222'), {
    online: true,
    nodeId: 'node-2',
    trustEpoch: 0,
  })
  if (!owner1.ok) return
  router.detach(owner1.session.sessionId)
  assert.deepEqual(router.resolveOwnerCode('111111111'), { online: false })
})

test('owner code changes and stale owner detach do not remove the active mapping', () => {
  const router = createRouter()
  const first = router.attach(ownerAttach({ ownerCode: '111111111' }), fakeSocket().socket)
  const second = router.attach(ownerAttach({ ownerCode: '222222222' }), fakeSocket().socket)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) return
  assert.deepEqual(router.resolveOwnerCode('111111111'), { online: false })
  assert.deepEqual(router.resolveOwnerCode('222222222'), {
    online: true,
    nodeId: 'node-1',
    trustEpoch: 0,
  })
  router.detach(first.session.sessionId)
  assert.deepEqual(router.resolveOwnerCode('222222222'), {
    online: true,
    nodeId: 'node-1',
    trustEpoch: 0,
  })
})

test('attaches login candidates by online owner code and applies normal node limits', () => {
  const router = new RelayRouter({ ownerToken, maxClientsPerNode: 1 })
  const owner = fakeSocket()
  router.attach(ownerAttach({ ownerCode: '123456789' }), owner.socket)
  const candidate = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      role: 'client',
      admission: 'login',
      connectionId: 'login-1',
      ownerCode: '123456789',
    },
    fakeSocket().socket,
  )
  assert.equal(candidate.ok, true)
  assert.deepEqual(JSON.parse(String(owner.messages.at(-1))), {
    type: 'relay.client.connected',
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    connectionId: 'login-1',
    admission: 'login',
    ownerCode: '123456789',
  })
  const overflow = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      role: 'client',
      admission: 'login',
      connectionId: 'login-2',
      ownerCode: '123456789',
    },
    fakeSocket().socket,
  )
  assert.deepEqual(overflow, { ok: false, reason: 'capacity' })
  const offline = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      role: 'client',
      admission: 'login',
      connectionId: 'login-3',
      ownerCode: '999999999',
    },
    fakeSocket().socket,
  )
  assert.deepEqual(offline, { ok: false, reason: 'unauthorized' })
})

test('routes bootstrap references through an owner registration and clears them on unregister', () => {
  const router = createRouter()
  const owner = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  assert.equal(ownerResult.ok, true)
  if (!ownerResult.ok) return

  const reference = 'ref-bootstrap-1'
  assert.equal(
    router.registerBootstrapReference(ownerResult.session.sessionId, {
      type: 'relay.bootstrap.register',
      version: RELAY_PROTOCOL_VERSION,
      reference,
      expiresAt: Date.now() + 60_000,
    }),
    true,
  )
  assert.deepEqual(router.resolveBootstrapReference(reference), {
    online: true,
    nodeId: 'node-1',
    trustEpoch: 0,
  })

  const client = fakeSocket()
  const candidate = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      role: 'client',
      admission: 'bootstrap_reference',
      connectionId: 'bootstrap-1',
      reference,
    },
    client.socket,
  )
  assert.equal(candidate.ok, true)
  assert.deepEqual(JSON.parse(String(owner.messages.at(-1))), {
    type: 'relay.client.connected',
    version: RELAY_PROTOCOL_VERSION,
    nodeId: 'node-1',
    connectionId: 'bootstrap-1',
    admission: 'bootstrap_reference',
    reference,
    ownerPublicKey: 'owner-public-key',
  })

  assert.equal(router.unregisterBootstrapReference(ownerResult.session.sessionId, reference), true)
  assert.deepEqual(router.resolveBootstrapReference(reference), { online: false })
  const rejected = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      role: 'client',
      admission: 'bootstrap_reference',
      connectionId: 'bootstrap-2',
      reference,
    },
    fakeSocket().socket,
  )
  assert.deepEqual(rejected, { ok: false, reason: 'unauthorized' })
})

test('replaces and expires bootstrap references, and owner detach removes them', async () => {
  const router = createRouter()
  const owner = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  assert.equal(ownerResult.ok, true)
  if (!ownerResult.ok) return

  assert.equal(
    router.registerBootstrapReference(ownerResult.session.sessionId, {
      type: 'relay.bootstrap.register',
      version: RELAY_PROTOCOL_VERSION,
      reference: 'ref-old',
      expiresAt: Date.now() + 60_000,
    }),
    true,
  )
  assert.equal(
    router.registerBootstrapReference(ownerResult.session.sessionId, {
      type: 'relay.bootstrap.register',
      version: RELAY_PROTOCOL_VERSION,
      reference: 'ref-new',
      expiresAt: Date.now() + 60_000,
    }),
    true,
  )
  assert.deepEqual(router.resolveBootstrapReference('ref-old'), { online: false })
  assert.equal(
    router.registerBootstrapReference(ownerResult.session.sessionId, {
      type: 'relay.bootstrap.register',
      version: RELAY_PROTOCOL_VERSION,
      reference: 'ref-expiring',
      expiresAt: Date.now() + 2,
    }),
    true,
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(router.resolveBootstrapReference('ref-expiring'), { online: false })

  router.detach(ownerResult.session.sessionId)
  assert.deepEqual(router.resolveBootstrapReference('ref-new'), { online: false })
})

test('allows replacing a routing slot at the global connection limit', () => {
  const router = new RelayRouter({ ownerToken, maxConnections: 2 })
  const owner = fakeSocket()
  const firstClient = fakeSocket()
  const replacement = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  const firstClientResult = router.attach(clientAttach(), firstClient.socket)
  assert.equal(ownerResult.ok, true)
  assert.equal(firstClientResult.ok, true)
  if (!ownerResult.ok || !firstClientResult.ok) return
  assert.equal(router.connectionCount(), 2)

  const replacementResult = router.attach(clientAttach(), replacement.socket)
  assert.equal(replacementResult.ok, true)
  if (!replacementResult.ok) return
  assert.deepEqual(firstClient.closed, [{ code: 4002, reason: 'replaced' }])
  assert.deepEqual(replacement.closed, [])
  assert.equal(router.connectionCount(), 2)
  assert.equal(router.getSession(firstClientResult.session.sessionId), undefined)
  assert.equal(router.getSession(replacementResult.session.sessionId), replacementResult.session)
})

test('closes a peer whose buffered bytes plus the current frame exceed the queue cap', () => {
  const frame = JSON.stringify({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId: 'client',
    payload: 'x'.repeat(64),
  })
  const frameBytes = Buffer.byteLength(frame, 'utf8')
  const router = new RelayRouter({ ownerToken, maxQueuedBytes: frameBytes })
  const owner = fakeSocket()
  const client = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  const clientResult = router.attach(clientAttach(), client.socket)
  assert.equal(ownerResult.ok, true)
  assert.equal(clientResult.ok, true)
  if (!ownerResult.ok || !clientResult.ok) return

  // The peer sits one byte below the cap. Only counting the current frame's bytes makes
  // `frameBytes - 1 + frameBytes` overflow; ignoring them would have delivered this frame.
  client.setBufferedBytes(frameBytes - 1)
  assert.equal(router.forward(ownerResult.session.sessionId, frame), true)
  assert.deepEqual(client.closed, [{ code: 4002, reason: 'slow_consumer' }])
  assert.equal(router.getSession(clientResult.session.sessionId), undefined)
  assert.equal(router.connectionCount(), 1)
  assert.equal(owner.closed.length, 0)
})

test('delivers a frame that exactly fits the queue cap without closing the peer', () => {
  const frame = JSON.stringify({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId: 'client',
    payload: 'x'.repeat(64),
  })
  const frameBytes = Buffer.byteLength(frame, 'utf8')
  const router = new RelayRouter({ ownerToken, maxQueuedBytes: frameBytes })
  const owner = fakeSocket()
  const client = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  const clientResult = router.attach(clientAttach(), client.socket)
  assert.equal(ownerResult.ok, true)
  assert.equal(clientResult.ok, true)
  if (!ownerResult.ok || !clientResult.ok) return

  client.setBufferedBytes(0)
  assert.equal(router.forward(ownerResult.session.sessionId, frame), true)
  assert.deepEqual(client.closed, [])
  assert.equal(client.messages.at(-1), frame)
  assert.equal(router.getSession(clientResult.session.sessionId), clientResult.session)
  assert.equal(router.connectionCount(), 2)

  client.setBufferedBytes(1)
  assert.equal(router.forward(ownerResult.session.sessionId, frame), true)
  assert.deepEqual(client.closed, [{ code: 4002, reason: 'slow_consumer' }])
  assert.equal(router.connectionCount(), 1)
  assert.equal(client.messages.length, 1)
})

test('enforces the queue cap before forwarding owner close frames', () => {
  const frame = JSON.stringify({
    type: 'relay.forward',
    version: RELAY_PROTOCOL_VERSION,
    connectionId: 'client',
    payload: JSON.stringify({
      type: 'connection.close',
      version: RELAY_PROTOCOL_VERSION,
      code: 'reset',
    }),
  })
  const frameBytes = Buffer.byteLength(frame, 'utf8')
  const router = new RelayRouter({ ownerToken, maxQueuedBytes: frameBytes })
  const owner = fakeSocket()
  const client = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  const clientResult = router.attach(clientAttach(), client.socket)
  assert.equal(ownerResult.ok, true)
  assert.equal(clientResult.ok, true)
  if (!ownerResult.ok || !clientResult.ok) return

  client.setBufferedBytes(1)
  assert.equal(router.forward(ownerResult.session.sessionId, frame), true)
  assert.deepEqual(client.closed, [{ code: 4002, reason: 'slow_consumer' }])
  assert.equal(router.getSession(clientResult.session.sessionId), undefined)
  assert.equal(router.getSession(ownerResult.session.sessionId), ownerResult.session)
  assert.equal(router.connectionCount(), 1)
})

test('closes exactly one slot and is a no-op when the session is already gone', () => {
  const router = createRouter()
  const owner = fakeSocket()
  const client = fakeSocket()
  const other = fakeSocket()
  const ownerResult = router.attach(ownerAttach(), owner.socket)
  const clientResult = router.attach(clientAttach(), client.socket)
  const otherResult = router.attach(
    clientAttach({ connectionId: 'client-2' }, 'node-1', 0, 'device-2'),
    other.socket,
  )
  assert.equal(ownerResult.ok, true)
  assert.equal(clientResult.ok, true)
  assert.equal(otherResult.ok, true)
  if (!ownerResult.ok || !clientResult.ok || !otherResult.ok) return

  assert.equal(router.close(clientResult.session.sessionId, 'device_revoked'), true)
  assert.deepEqual(client.closed, [{ code: 4002, reason: 'device_revoked' }])
  assert.deepEqual(other.closed, [])
  assert.equal(router.connectionCount(), 2)
  assert.deepEqual(
    owner.messages.map((message) => JSON.parse(String(message)).type),
    ['relay.client.connected', 'relay.client.connected', 'relay.client.disconnected'],
  )

  assert.equal(router.close(clientResult.session.sessionId, 'device_revoked'), false)
  assert.deepEqual(client.closed, [{ code: 4002, reason: 'device_revoked' }])
  assert.equal(router.connectionCount(), 2)
  assert.equal(owner.messages.length, 3)

  assert.equal(router.close(ownerResult.session.sessionId, 'owner_shutdown'), true)
  assert.deepEqual(owner.closed, [{ code: 4002, reason: 'owner_shutdown' }])
  assert.deepEqual(other.closed, [{ code: 4002, reason: 'owner_shutdown' }])
  assert.equal(router.connectionCount(), 0)
  assert.equal(router.close(ownerResult.session.sessionId, 'owner_shutdown'), false)
  assert.deepEqual(owner.closed, [{ code: 4002, reason: 'owner_shutdown' }])
})
