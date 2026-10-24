import test from 'node:test'
import assert from 'node:assert/strict'

import { RELAY_PROTOCOL_VERSION } from '@codex-web/protocol/relay'

import { RelayRouter, type RelaySocket } from './relay-router.js'

function fakeSocket() {
  const messages: Array<string | ArrayBuffer | Uint8Array> = []
  const closed: Array<{ code?: number; reason?: string }> = []
  const socket: RelaySocket = {
    send: (data) => messages.push(data),
    close: (code, reason) => closed.push({ code, reason }),
  }
  return { socket, messages, closed }
}

test('forwards opaque frames only between matching owner and client attachments', () => {
  const router = new RelayRouter()
  const owner = fakeSocket()
  const client = fakeSocket()
  const ownerResult = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      connectionId: 'connection-1',
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
  const router = new RelayRouter()
  const ownerA = fakeSocket()
  const clientA = fakeSocket()
  const ownerB = fakeSocket()
  router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      connectionId: 'a',
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
    },
    clientA.socket,
  )
  const ownerBResult = router.attach(
    {
      type: 'relay.attach',
      version: RELAY_PROTOCOL_VERSION,
      nodeId: 'node-1',
      role: 'owner',
      connectionId: 'b',
    },
    ownerB.socket,
  )
  assert.equal(ownerBResult.ok, true)
  if (!ownerBResult.ok) return
  router.detach(ownerBResult.session.sessionId)
  assert.deepEqual(ownerB.closed.at(-1), { code: 4002, reason: 'peer_disconnected' })
  assert.deepEqual(clientA.closed.at(-1), { code: 4002, reason: 'replaced' })
})
