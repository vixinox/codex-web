import assert from 'node:assert/strict'
import test from 'node:test'
import { EnrollmentInvitationStore } from './enrollment-invitation-store.js'

const binding = {
  ownerId: 'owner-1',
  nodeId: 'node-1',
  trustEpoch: 4,
  issuer: 'owner-local' as const,
}

test('replaces an active invitation and binds its single redemption to the browser key', () => {
  let now = 10
  const store = new EnrollmentInvitationStore(() => now)
  const old = store.issue(binding)
  const current = store.issue(binding)
  assert.notEqual(current.reference, old.reference)
  assert.equal(store.consume(old.reference, { ...binding, clientPublicKey: 'key-a' }), false)
  assert.equal(store.consume(current.reference, { ...binding, clientPublicKey: 'key-a' }), true)
  assert.equal(store.consume(current.reference, { ...binding, clientPublicKey: 'key-a' }), false)
  assert.deepEqual(store.status(), {
    expiresAt: now + 5 * 60_000,
    consumed: true,
    issuer: 'owner-local',
  })
  now += 5 * 60_000
  assert.equal(store.status(), null)
})

test('rejects identity, epoch, and key mismatches without consuming the invitation', () => {
  const store = new EnrollmentInvitationStore(() => 10)
  const invitation = store.issue(binding)
  assert.equal(
    store.consume(invitation.reference, { ...binding, nodeId: 'other', clientPublicKey: 'key-a' }),
    false,
  )
  assert.equal(
    store.consume(invitation.reference, { ...binding, trustEpoch: 5, clientPublicKey: 'key-a' }),
    false,
  )
  assert.equal(store.consume(invitation.reference, { ...binding, clientPublicKey: 'key-a' }), true)
  assert.equal(store.consume(invitation.reference, { ...binding, clientPublicKey: 'key-b' }), false)
})

test('cancel and runtime invalidation discard active invitations', () => {
  const store = new EnrollmentInvitationStore(() => 10)
  store.issue(binding)
  assert.equal(store.cancel(), true)
  assert.equal(store.cancel(), false)
  const next = store.issue(binding)
  store.invalidate()
  assert.equal(store.consume(next.reference, { ...binding, clientPublicKey: 'key-a' }), false)
})
