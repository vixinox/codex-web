import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeviceManagement } from './device-management.js'
import type { OwnerMethodContext } from './session-runtime.js'

function fixture() {
  const peers = new Set<string>()
  const authorized = new Set<string>()
  const connected = new Set<string>()
  const sessions = new Set<string>()
  let sessionSequence = 0
  let reference: string | undefined
  const remote = {
    isConnected: () => true,
    hasEnrollmentReference: (value: string) => value === reference,
    registerEnrollmentReference: async (value: string) => {
      reference = value
    },
    unregisterEnrollmentReference: async () => {
      reference = undefined
    },
    listDevices: async () => [...peers].map((id) => ({ id })),
    async disconnectDevice(id?: string) {
      if (id) connected.delete(id)
      else connected.clear()
    },
    async revokeDevice(id: string) {
      connected.delete(id)
      return peers.delete(id)
    },
    async revokeAllDevices() {
      peers.clear()
      connected.clear()
    },
    createPairedClientToken: async (id: string) => `paired-${id}`,
    trust: {
      identity: async () => ({ nodeId: 'node', trustEpoch: 3, ownerPublicKey: 'owner-key' }),
      async trustPeerWithStatus(key: string) {
        const created = !peers.has(key)
        peers.add(key)
        return { deviceId: key, created }
      },
    },
  }
  const auth = {
    isDeviceAuthorized: async (id: string) => authorized.has(id),
    listActiveDeviceIds: async () => [...authorized],
    async registerDevice(id: string) {
      authorized.add(id)
    },
    async createSession(id: string) {
      const token = `session-${++sessionSequence}`
      sessions.add(token)
      return { sessionId: id, token, expiresAt: '2027-01-01T00:00:00Z' }
    },
    async logout(token: string) {
      sessions.delete(token)
    },
    async markDeviceRevoked(id: string) {
      authorized.delete(id)
    },
    async revokeAllDevices() {
      authorized.clear()
    },
  }
  const manager = createDeviceManagement(
    remote as never,
    auth as never,
    'owner',
    'https://app.test',
  )
  const candidate = (ref: string, key = 'browser') =>
    ({
      transport: {
        kind: 'relay',
        enrollmentCandidate: true,
        e2eeVerified: true,
        clientPublicKey: key,
        enrollmentReference: ref,
      },
      authenticate: async () => {
        connected.add(key)
      },
      unauthenticate: () => {
        connected.delete(key)
      },
    }) as unknown as OwnerMethodContext
  return {
    manager,
    auth,
    remote,
    sessions,
    peers,
    authorized,
    connected,
    candidate,
    disconnectRelay: () => {
      reference = undefined
    },
  }
}

test('Relay reconnection and cancellation invalidate outstanding invitations', async () => {
  const f = fixture()
  const first = await f.manager.issue('cli')
  f.disconnectRelay()
  await assert.rejects(
    f.manager.redeem(f.candidate(first.reference), { reference: first.reference }),
  )
  const second = await f.manager.issue('cli')
  assert.deepEqual(await f.manager.cancel(), { cancelled: true })
  await assert.rejects(
    f.manager.redeem(f.candidate(second.reference), { reference: second.reference }),
  )
  assert.deepEqual(await f.manager.status(), { active: false })
})

test('a single invitation admits one browser; removal clears device authorization and connections', async () => {
  const f = fixture()
  const invitation = await f.manager.issue('cli')
  const outcomes = await Promise.allSettled([
    f.manager.redeem(f.candidate(invitation.reference), { reference: invitation.reference }),
    f.manager.redeem(f.candidate(invitation.reference, 'second'), {
      reference: invitation.reference,
    }),
  ])
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1)
  assert.deepEqual(await f.manager.status(), { active: false })
  assert.equal((await f.manager.listDevices()).length, 1)
  await f.manager.revokeAllDevices()
  assert.deepEqual(await f.manager.listDevices(), [])
  assert.equal(f.authorized.size + f.connected.size + f.peers.size, 0)
  const newInvitation = await f.manager.issue('cli')
  const result = await f.manager.redeem(f.candidate(newInvitation.reference, 'replacement'), {
    reference: newInvitation.reference,
  })
  assert.equal(result.ownerPublicKey, 'owner-key')
})

test('failed enrollment compensates authorization and a later invitation can still be used', async () => {
  const f = fixture()
  const invitation = await f.manager.issue('cli')
  const createSession = f.auth.createSession
  f.auth.createSession = async () => {
    throw new Error('session persistence failed')
  }
  await assert.rejects(
    f.manager.redeem(f.candidate(invitation.reference), { reference: invitation.reference }),
  )
  assert.equal(f.authorized.size + f.connected.size + f.peers.size, 0)
  f.auth.createSession = createSession
  const replacement = await f.manager.issue('cli')
  await f.manager.redeem(f.candidate(replacement.reference), { reference: replacement.reference })
  await f.manager.revokeAllDevices()
})

test('new login grants reuse a browser device, stay single-use and require fresh approval after removal', async () => {
  const f = fixture()
  const login = async (reference: string) => f.manager.redeem(f.candidate(reference), { reference })
  const first = await login((await f.manager.issue('cli')).reference)
  const replaced = await f.manager.issue('cli')
  const next = await f.manager.issue('cli')
  await assert.rejects(login(replaced.reference))
  const second = await login(next.reference)
  assert.equal(second.deviceId, first.deviceId)
  assert.notEqual(second.sessionToken, first.sessionToken)
  assert.equal((await f.manager.listDevices()).length, 1)
  assert.equal(f.sessions.size, 2)
  await assert.rejects(login(next.reference))

  const outstanding = await f.manager.issue('cli')
  await f.manager.revokeDevice(first.deviceId)
  await assert.rejects(login(outstanding.reference))
  assert.deepEqual(await f.manager.listDevices(), [])
  await login((await f.manager.issue('cli')).reference)
  assert.equal((await f.manager.listDevices()).length, 1)
})

test('failed repeat login cleans only its new session and preserves the existing device', async () => {
  const f = fixture()
  const first = await f.manager.issue('cli')
  const device = await f.manager.redeem(f.candidate(first.reference), {
    reference: first.reference,
  })
  f.remote.createPairedClientToken = async () => {
    throw new Error('token signing failed')
  }
  const next = await f.manager.issue('cli')
  await assert.rejects(f.manager.redeem(f.candidate(next.reference), { reference: next.reference }))
  assert.deepEqual([...f.sessions], [device.sessionToken])
  assert.deepEqual([...f.authorized], [device.deviceId])
  assert.deepEqual([...f.peers], [device.deviceId])
  assert.equal((await f.manager.listDevices()).length, 1)
})

test('a removed device cannot issue a queued invitation and revocation invalidates an already issued one', async () => {
  const f = fixture()
  const invitation = await f.manager.issue('cli')
  const device = await f.manager.redeem(f.candidate(invitation.reference), {
    reference: invitation.reference,
  })
  const outstanding = await f.manager.issue('paired-device', device.deviceId)
  const removed = f.manager.revokeDevice(device.deviceId)
  const queued = f.manager.issue('paired-device', device.deviceId)
  await removed
  await assert.rejects(queued)
  await assert.rejects(
    f.manager.redeem(f.candidate(outstanding.reference, 'other'), {
      reference: outstanding.reference,
    }),
  )
  assert.deepEqual(await f.manager.listDevices(), [])
})

test('partial persistence failure disconnects access and removal can be retried', async () => {
  const f = fixture()
  const invitation = await f.manager.issue('cli')
  const device = await f.manager.redeem(f.candidate(invitation.reference), {
    reference: invitation.reference,
  })
  const revoke = f.auth.markDeviceRevoked
  f.auth.markDeviceRevoked = async () => {
    throw new Error('database unavailable')
  }
  await assert.rejects(f.manager.revokeDevice(device.deviceId), /database unavailable/)
  assert.equal(f.connected.size + f.peers.size, 0)
  assert.deepEqual(await f.manager.listDevices(), [])
  f.auth.markDeviceRevoked = revoke
  await f.manager.revokeDevice(device.deviceId)
  assert.equal(f.authorized.size, 0)
})
