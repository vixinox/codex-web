import assert from 'node:assert/strict'
import test from 'node:test'

import { LoginQrCapabilityStore } from './login-qr-capability-store.js'

test('replacing an active login QR invalidates the previous capability', () => {
  const store = new LoginQrCapabilityStore(() => 1_000)
  const first = store.issue('owner-1', 'owner-node', 4)
  assert.equal(store.status().state, 'active')
  const second = store.issue('owner-1', 'owner-node', 4)

  assert.notEqual(first.capability, second.capability)
  assert.equal(store.consume(first.capability, 'owner-node', 4), null)
  assert.deepEqual(store.consume(second.capability, 'owner-node', 4), {
    ownerId: 'owner-1',
    nodeId: 'owner-node',
    trustEpoch: 4,
  })
  assert.deepEqual(store.status(), { state: 'consumed' })
})

test('cancellation invalidates the active capability and reports whether one existed', () => {
  const store = new LoginQrCapabilityStore(() => 1_000)
  const grant = store.issue('owner-1', 'owner-node', 4)

  assert.equal(store.cancel(), true)
  assert.equal(store.consume(grant.capability, 'owner-node', 4), null)
  assert.equal(store.cancel(), false)
  assert.deepEqual(store.status(), { state: 'cancelled' })
})

test('expired, wrong-node, and stale-epoch capabilities cannot be consumed', () => {
  let now = 1_000
  const store = new LoginQrCapabilityStore(() => now)
  const grant = store.issue('owner-1', 'owner-node', 4)

  assert.equal(grant.expiresAt, now + 5 * 60 * 1_000)
  assert.equal(store.consume(grant.capability, 'other-node', 4), null)
  assert.equal(store.consume(grant.capability, 'owner-node', 5), null)
  now = grant.expiresAt
  assert.equal(store.consume(grant.capability, 'owner-node', 4), null)
  assert.deepEqual(store.status(), { state: 'expired' })
})

test('consumption is atomic and only the first caller receives the grant', async () => {
  const store = new LoginQrCapabilityStore(() => 1_000)
  const grant = store.issue('owner-1', 'owner-node', 4)

  const results = await Promise.all([
    Promise.resolve().then(() => store.consume(grant.capability, 'owner-node', 4)),
    Promise.resolve().then(() => store.consume(grant.capability, 'owner-node', 4)),
  ])

  assert.equal(results.filter(Boolean).length, 1)
})

test('a new store after restart has no active capability', () => {
  const beforeRestart = new LoginQrCapabilityStore(() => 1_000)
  const grant = beforeRestart.issue('owner-1', 'owner-node', 4)
  const afterRestart = new LoginQrCapabilityStore(() => 1_000)

  assert.equal(afterRestart.consume(grant.capability, 'owner-node', 4), null)
  assert.deepEqual(afterRestart.status(), { state: 'none' })
  beforeRestart.invalidate()
  assert.deepEqual(beforeRestart.status(), { state: 'restarted' })
})
