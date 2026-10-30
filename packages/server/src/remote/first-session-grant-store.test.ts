import assert from 'node:assert/strict'
import test from 'node:test'
import { FirstSessionGrantStore } from './first-session-grant-store.js'

test('first-session grant is single use and binds the first verified E2EE key', () => {
  let now = 1_000
  const store = new FirstSessionGrantStore(() => now)
  const issued = store.issue({
    ownerId: 'owner-1',
    nodeId: 'node-1',
    trustEpoch: 4,
    remoteOrigin: 'https://codex.vixinox.com',
  })
  const binding = {
    ownerId: 'owner-1',
    nodeId: 'node-1',
    trustEpoch: 4,
    remoteOrigin: 'https://codex.vixinox.com' as const,
    clientPublicKey: 'first-client-key',
  }

  assert.equal(store.consume(issued.grant, { ...binding, nodeId: 'other-node' }), false)
  assert.equal(store.consume(issued.grant, binding), true)
  assert.equal(store.consume(issued.grant, binding), false)
  assert.equal(store.consume(issued.grant, { ...binding, clientPublicKey: 'second-key' }), false)

  const rotated = store.issue(binding)
  now += 5 * 60_000
  assert.equal(store.consume(rotated.grant, binding), false)
})

test('invalidating first-session grants removes the current bootstrap capability', () => {
  const store = new FirstSessionGrantStore(() => 1_000)
  const issued = store.issue({
    ownerId: 'owner-1',
    nodeId: 'node-1',
    trustEpoch: 0,
    remoteOrigin: 'https://codex.vixinox.com',
  })
  store.invalidate()
  assert.equal(
    store.consume(issued.grant, {
      ownerId: 'owner-1',
      nodeId: 'node-1',
      trustEpoch: 0,
      remoteOrigin: 'https://codex.vixinox.com',
      clientPublicKey: 'client-key',
    }),
    false,
  )
})
